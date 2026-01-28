# Analytics & Growth Implementation Plan

This is the execution plan for adding analytics tracking, SendGrid email marketing, a recommendation engine, and SEO strategy support.

---

## A) Analytics Spine (Week 1 MVP)

### Events to Track

We need to automatically track 10-20 core events. Here's what I'd start with:

**User Lifecycle:**
1. `signup` - User registers account
2. `email_verified` - User verifies email
3. `first_login` - User logs in for first time
4. `connect_site` - User connects/analyzes first website
5. `organization_created` - User creates organization

**Content Pipeline:**
6. `scrape_started` - Website analysis begins
7. `scrape_completed` - Website analysis finishes
8. `analysis_completed` - Business analysis data saved
9. `draft_generated` - Blog post generated (first time)
10. `draft_edited` - User edits generated draft
11. `published` - Blog post published
12. `content_exported` - User exports content (markdown/HTML)

**Feature Usage:**
13. `seo_strategy_selected` - User selects SEO strategy
14. `visual_content_generated` - Image/chart generated
15. `tweet_enriched` - Tweet added to post
16. `recommendation_clicked` - User clicks recommendation
17. `recommendation_dismissed` - User dismisses recommendation

**Marketing & Revenue:**
18. `email_sent` - Transactional email sent (onboarding, etc.)
19. `payment_success` - First payment completed
20. `subscription_started` - User upgrades to paid plan

### How to Implement

The analytics service already exists (`services/analytics.js`) and there's a `user_activity_events` table. Right now events are only tracked manually via API calls. We should enhance the existing system (no new dependencies needed) by adding automatic event tracking middleware.

Here's how:

1. **Create Event Tracking Middleware** (`middleware/analytics.js`):
```javascript
import analyticsService from '../services/analytics.js';

export function trackEventMiddleware(eventType, getEventData) {
  return async (req, res, next) => {
    // Track event after response
    const originalSend = res.json;
    res.json = function(data) {
      if (res.statusCode < 400) { // Only track successful requests
        const eventData = getEventData ? getEventData(req, data) : {};
        analyticsService.trackEvent(
          req.user?.userId,
          req.headers['x-session-id'],
          eventType,
          eventData,
          { pageUrl: req.url }
        ).catch(err => console.error('Analytics tracking failed:', err));
      }
      return originalSend.call(this, data);
    };
    next();
  };
}
```

2. **Add Automatic Tracking to Key Endpoints:**

**File: `routes/enhanced-blog-generation.js`**
```javascript
// After line 167 (successful generation)
await analyticsService.trackEvent(
  userId,
  req.headers['x-session-id'],
  'draft_generated',
  {
    organizationId,
    postId: savedPost?.id,
    wordCount: result.content?.split(' ').length,
    hasImages: result._hasImagePlaceholders,
    seoScore: result.qualityPrediction?.expectedSEOScore
  }
);
```

**File: `routes/posts.js`** (publish endpoint)
```javascript
// When status changes to 'published'
await analyticsService.trackEvent(
  userId,
  req.headers['x-session-id'],
  'published',
  { postId, organizationId, wordCount }
);
```

**File: `services/auth-database.js`** (registration)
```javascript
// After successful registration (line ~150)
await analyticsService.trackEvent(
  newUser.id,
  null,
  'signup',
  { email, hasOrganization: !!organizationId }
);
```

**File: `routes/analysis.js`** (website analysis)
```javascript
// After successful analysis (in adopt-session or analyze endpoint)
await analyticsService.trackEvent(
  userId,
  sessionId,
  'scrape_completed',
  { websiteUrl, organizationId, hasCTAs, hasInternalLinks }
);
```

3. **Event Properties Schema:**

Store in `user_activity_events.event_data` JSONB:
```typescript
{
  // Common
  organizationId?: string;
  projectId?: string;
  postId?: string;
  
  // Generation-specific
  wordCount?: number;
  seoScore?: number;
  hasImages?: boolean;
  tokensUsed?: number;
  
  // Analysis-specific
  websiteUrl?: string;
  hasCTAs?: boolean;
  hasInternalLinks?: boolean;
  
  // Revenue-specific
  amount?: number;
  planName?: string;
}
```

### Dashboard Metrics

Once we're tracking events, we can calculate:

**Activation:** Time-to-first-publish (how long from signup to first publish), activation rate (% who publish within 7 days). Query would be something like `SELECT AVG(EXTRACT(EPOCH FROM (published_at - signup_at))/86400) FROM ...`

**Pipeline Performance:** Scrape success rate, generation success rate, publish rate. Just divide completed events by started events.

**Error Tracking:** Track `error_occurred` events with error type, endpoint, user_id. Calculate error rate by endpoint.

**Retention:** DAU/MAU ratio - active users in last 30 days divided by total users. Can query `user_activity_events` for login/generation/publish events.

To implement, add these queries to `services/analytics.js::getComprehensiveMetrics()` and create a `GET /api/v1/analytics/dashboard` endpoint (superadmin only).

---

## B) SendGrid Integration

### Current State

There's no email service. I found a `TODO: Send email invitation here` comment in `services/referrals.js` at line 96. No transactional email capability at all.

### How to Add It

**1. Install SendGrid SDK:**
```bash
npm install @sendgrid/mail
```

**2. Create Email Service** (`services/email.js`):
```javascript
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export class EmailService {
  async sendEmail({ to, templateId, dynamicTemplateData, subject, html }) {
    try {
      const msg = {
        to,
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@automatemyblog.com',
        templateId, // SendGrid dynamic template ID
        dynamicTemplateData,
        // OR use html if no template
        subject,
        html
      };
      
      await sgMail.send(msg);
      
      // Track email event
      await analyticsService.trackEvent(
        null, // No user_id for system emails
        null,
        'email_sent',
        { to, templateId, subject }
      );
      
      return { success: true };
    } catch (error) {
      console.error('SendGrid error:', error);
      // Don't throw - email failure shouldn't break app
      return { success: false, error: error.message };
    }
  }
  
  // Specific email methods
  async sendOnboardingEmail(userId, userEmail, firstName) {
    return this.sendEmail({
      to: userEmail,
      templateId: 'd-onboarding-welcome', // Create in SendGrid
      dynamicTemplateData: {
        firstName,
        dashboardUrl: 'https://automatemyblog.com/dashboard'
      }
    });
  }
  
  async sendDraftReadyEmail(userId, userEmail, postTitle, postId) {
    return this.sendEmail({
      to: userEmail,
      templateId: 'd-draft-ready',
      dynamicTemplateData: {
        postTitle,
        editUrl: `https://automatemyblog.com/posts/${postId}/edit`
      }
    });
  }
  
  async sendWeeklySummary(userId, userEmail, stats) {
    return this.sendEmail({
      to: userEmail,
      templateId: 'd-weekly-summary',
      dynamicTemplateData: {
        postsGenerated: stats.postsGenerated,
        postsPublished: stats.postsPublished,
        seoAvgScore: stats.avgSEOScore
      }
    });
  }
}
```

**3. Email Templates**

Two options:

**Option A: SendGrid Dynamic Templates** (recommended for MVP)
Create templates in SendGrid dashboard, store template IDs in env vars. Easy to edit without code changes, supports A/B testing. Downside is you need SendGrid account setup.

**Option B: In-Repo Templates**
Store HTML templates in `templates/emails/`, use Handlebars for variables. Version controlled, no external dependency. But requires code deploy for template changes.

I'd start with Option A for speed, can migrate to Option B later if needed.

**4. Event-Driven Triggers:**

**File: `services/auth-database.js`** (after registration)
```javascript
// After line 150 (user created)
emailService.sendOnboardingEmail(newUser.id, email, firstName)
  .catch(err => console.error('Onboarding email failed:', err));
```

**File: `routes/enhanced-blog-generation.js`** (after generation)
```javascript
// After line 96 (post saved)
if (savedPost && options.sendNotifications !== false) {
  emailService.sendDraftReadyEmail(userId, userEmail, result.title, savedPost.id)
    .catch(err => console.error('Draft ready email failed:', err));
}
```

**File: `jobs/weeklySummary.js`** (new cron job)
```javascript
// Run weekly, query analytics for each active user
const stats = await analyticsService.getUserStats(userId, '7d');
await emailService.sendWeeklySummary(userId, userEmail, stats);
```

**5. Safety Features**

**Unsubscribe Support:** Add an `email_preferences` table:
```sql
CREATE TABLE email_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  onboarding_emails BOOLEAN DEFAULT TRUE,
  draft_ready_emails BOOLEAN DEFAULT TRUE,
  weekly_summaries BOOLEAN DEFAULT TRUE,
  marketing_emails BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Rate Limits:** SendGrid free tier is 100 emails/day. Track emails sent per day and queue if over limit. Add this check in `services/email.js`.

**Retries:** SendGrid SDK has built-in retries, which is nice. But we should also add idempotency - store `email_id` in a `sent_emails` table to prevent duplicates.

**Idempotency Keys:**
```javascript
// Generate idempotency key
const idempotencyKey = `email_${userId}_${templateId}_${Date.now()}`;
// Check if already sent (within last hour)
const alreadySent = await db.query(
  'SELECT id FROM sent_emails WHERE idempotency_key = $1 AND sent_at > NOW() - INTERVAL \'1 hour\'',
  [idempotencyKey]
);
if (alreadySent.rows.length > 0) return { success: true, skipped: true };
```

**6. Implementation Steps:**

1. Install SendGrid: `npm install @sendgrid/mail`
2. Add env vars: `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`
3. Create `services/email.js` with EmailService class
4. Create email preferences table migration
5. Add email triggers to registration, generation, publish flows
6. Create SendGrid templates (or use HTML in code for MVP)
7. Test with real emails (use test mode first)

**Files to Modify:**
- `services/email.js` (new file)
- `services/auth-database.js:150` (add onboarding email)
- `routes/enhanced-blog-generation.js:96` (add draft ready email)
- `database/XX_email_preferences.sql` (new migration)
- `jobs/weeklySummary.js` (new file)

---

## C) Recommendation Board

### Current State

The analytics service already has a `getUserOpportunities()` method at `services/analytics.js:870`. It returns 5 opportunity types: out_of_credits, unused_referral, active_free_user, churn_risk, upsell_to_pro. But it's not exposed as an API or in the UI - the data exists, it just needs to be surfaced.

### Building the Engine

**1. Schema**

Two approaches:

**Option A: Compute-on-Read** (recommended for MVP)
Compute recommendations on-demand from existing data, cache in Redis or memory for 5-10 minutes. Pros: No schema changes, always fresh data. Cons: Slower queries, no recommendation history.

**Option B: Recommendations Table**
```sql
CREATE TABLE recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id),
  recommendation_type VARCHAR(50) NOT NULL,
  priority INTEGER DEFAULT 0, -- 1=high, 2=medium, 3=low
  title VARCHAR(255) NOT NULL,
  description TEXT,
  action_url VARCHAR(500),
  action_text VARCHAR(100),
  reason TEXT, -- Why this recommendation
  metadata JSONB, -- Additional context
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'dismissed', 'completed')),
  dismissed_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP -- Auto-expire old recommendations
);

CREATE INDEX idx_recommendations_user_status ON recommendations(user_id, status);
CREATE INDEX idx_recommendations_org_status ON recommendations(organization_id, status);
```

I'd start with Option A (compute-on-read) and migrate to Option B if we hit performance issues.

**2. Recommendation Engine** (`services/recommendations.js`):
```javascript
import analyticsService from './analytics.js';
import db from './database.js';

export class RecommendationService {
  async getRecommendations(userId, organizationId = null) {
    // Get user opportunities from analytics
    const opportunities = await analyticsService.getUserOpportunities();
    const userOpps = opportunities.filter(o => o.user_id === userId);
    
    // Get content state
    const contentState = await this.getContentState(userId, organizationId);
    
    // Get errors (from analytics events)
    const recentErrors = await this.getRecentErrors(userId);
    
    // Generate recommendations
    const recommendations = [];
    
    // From opportunities
    userOpps.forEach(opp => {
      recommendations.push({
        type: opp.opportunity_type,
        priority: this.getPriority(opp.opportunity_type),
        title: this.getTitle(opp.opportunity_type),
        description: opp.opportunity_reason,
        actionUrl: this.getActionUrl(opp.opportunity_type, userId),
        actionText: this.getActionText(opp.opportunity_type),
        reason: opp.recommended_action,
        metadata: { opportunityId: opp.id }
      });
    });
    
    // From content state
    if (contentState.hasDrafts && !contentState.hasPublished) {
      recommendations.push({
        type: 'publish_draft',
        priority: 2,
        title: 'Publish your first post',
        description: `You have ${contentState.draftCount} draft(s) ready to publish`,
        actionUrl: `/posts/${contentState.latestDraftId}/edit`,
        actionText: 'Review & Publish',
        reason: 'Publishing increases engagement and SEO value'
      });
    }
    
    // From errors
    if (recentErrors.length > 0) {
      recommendations.push({
        type: 'fix_errors',
        priority: 1,
        title: 'Fix recent errors',
        description: `${recentErrors.length} error(s) in last 24 hours`,
        actionUrl: '/dashboard/errors',
        actionText: 'View Errors',
        reason: 'Resolving errors improves content quality'
      });
    }
    
    // From SEO strategy
    if (organizationId) {
      const seoStrategy = await this.getSEOStrategy(organizationId);
      if (!seoStrategy) {
        recommendations.push({
          type: 'select_seo_strategy',
          priority: 2,
          title: 'Select SEO strategy',
          description: 'Choose a strategy to optimize your content',
          actionUrl: `/organizations/${organizationId}/seo-strategy`,
          actionText: 'Select Strategy',
          reason: 'SEO strategy improves content discoverability'
        });
      }
    }
    
    // Sort by priority, return top 10
    return recommendations
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 10);
  }
  
  getPriority(type) {
    const priorities = {
      'out_of_credits': 1,
      'churn_risk': 1,
      'fix_errors': 1,
      'active_free_user': 2,
      'upsell_to_pro': 2,
      'publish_draft': 2,
      'select_seo_strategy': 2,
      'unused_referral': 3
    };
    return priorities[type] || 3;
  }
  
  async getContentState(userId, organizationId) {
    const result = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'draft') as draft_count,
        COUNT(*) FILTER (WHERE status = 'published') as published_count,
        MAX(id) FILTER (WHERE status = 'draft') as latest_draft_id
      FROM blog_posts
      WHERE user_id = $1
        AND (organization_id = $2 OR $2 IS NULL)
    `, [userId, organizationId]);
    
    return {
      hasDrafts: parseInt(result.rows[0].draft_count) > 0,
      hasPublished: parseInt(result.rows[0].published_count) > 0,
      draftCount: parseInt(result.rows[0].draft_count),
      latestDraftId: result.rows[0].latest_draft_id
    };
  }
  
  async getRecentErrors(userId) {
    const result = await db.query(`
      SELECT event_type, event_data, timestamp
      FROM user_activity_events
      WHERE user_id = $1
        AND event_type = 'error_occurred'
        AND timestamp > NOW() - INTERVAL '24 hours'
      ORDER BY timestamp DESC
      LIMIT 10
    `, [userId]);
    
    return result.rows;
  }
  
  async getSEOStrategy(organizationId) {
    const result = await db.query(`
      SELECT seo_strategy FROM organizations
      WHERE id = $1
    `, [organizationId]);
    
    return result.rows[0]?.seo_strategy || null;
  }
}
```

**3. API Endpoints** (`routes/recommendations.js`):
```javascript
import express from 'express';
import recommendationService from '../services/recommendations.js';
import db from '../services/database.js';

const router = express.Router();

// GET /api/v1/recommendations
router.get('/', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const userId = req.user.userId;
    const organizationId = req.query.organizationId || null;
    
    const recommendations = await recommendationService.getRecommendations(userId, organizationId);
    
    res.json({
      success: true,
      recommendations,
      count: recommendations.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/recommendations/:id/dismiss
router.post('/:id/dismiss', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    // If using table, update status
    // If compute-on-read, track dismissal in analytics
    await analyticsService.trackEvent(
      req.user.userId,
      req.headers['x-session-id'],
      'recommendation_dismissed',
      { recommendationId: req.params.id, recommendationType: req.body.type }
    );
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/recommendations/:id/complete
router.post('/:id/complete', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    await analyticsService.trackEvent(
      req.user.userId,
      req.headers['x-session-id'],
      'recommendation_clicked',
      { recommendationId: req.params.id, recommendationType: req.body.type }
    );
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

**4. Prioritization**

Simple rule-based approach for MVP:
- **Priority 1 (High):** Revenue blockers (out_of_credits, churn_risk), errors
- **Priority 2 (Medium):** Engagement opportunities (publish_draft, select_seo_strategy, upsell)
- **Priority 3 (Low):** Growth hacks (unused_referral)

Sort by priority first, then created date (newest first), then type.

**5. Implementation Steps:**

1. Create `services/recommendations.js`
2. Create `routes/recommendations.js`
3. Add route to `index.js`: `app.use('/api/v1/recommendations', recommendationRoutes)`
4. Track recommendation clicks/dismissals in analytics
5. (Optional) Create recommendations table if performance issues

**Files:**
- `services/recommendations.js` (new)
- `routes/recommendations.js` (new)
- `index.js` (add route)

---

## D) SEO Strategy by Audience

### Current State

The `content_strategies` table exists with `goal`, `voice`, `template` fields. The `organizations` table has `blog_generation_settings` JSONB that might contain SEO settings. But there's no explicit "SEO strategy per audience segment" feature.

### How to Add It

**1. Schema**

Two options:

**Option A: Extend Existing Tables**
```sql
-- Add to organizations table
ALTER TABLE organizations 
ADD COLUMN seo_strategy JSONB DEFAULT '{}';

-- Example structure:
-- {
--   "default_strategy": "comprehensive",
--   "audience_strategies": {
--     "b2b_decision_makers": {
--       "strategy": "authority_building",
--       "focus_keywords": ["enterprise", "solution", "ROI"],
--       "content_length": "deep",
--       "cta_style": "demo_request"
--     },
--     "end_users": {
--       "strategy": "how_to_guides",
--       "focus_keywords": ["tutorial", "step-by-step"],
--       "content_length": "standard",
--       "cta_style": "sign_up"
--     }
--   }
-- }
```

**Option B: New Table (If More Complex)**
```sql
CREATE TABLE seo_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  audience_segment VARCHAR(100) NOT NULL, -- 'b2b_decision_makers', 'end_users', 'default'
  strategy_name VARCHAR(100) NOT NULL, -- 'authority_building', 'how_to_guides', 'comprehensive'
  focus_keywords JSONB,
  content_length VARCHAR(20),
  cta_style VARCHAR(50),
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

I'd start with Option A (JSONB in organizations) and migrate to Option B if we need more complexity.

**2. Identify Audience Analysis Location:**

**Current:** Audience data stored in:
- `projects.target_audience` (TEXT)
- `organizations` (via website analysis)
- `user_manual_inputs` (input_type = 'target_audience')

**Enhancement:** Create audience segmentation service:
```javascript
// services/audience-segmentation.js
export class AudienceSegmentationService {
  async getAudienceSegment(organizationId) {
    // Check manual input first
    const manual = await db.query(`
      SELECT input_data FROM user_manual_inputs
      WHERE organization_id = $1 AND input_type = 'target_audience'
    `, [organizationId]);
    
    if (manual.rows.length > 0) {
      const audience = JSON.parse(manual.rows[0].input_data);
      return this.classifySegment(audience);
    }
    
    // Fallback to website analysis
    const org = await db.query(`
      SELECT business_analysis FROM organizations WHERE id = $1
    `, [organizationId]);
    
    if (org.rows[0]?.business_analysis) {
      return this.classifySegment(org.rows[0].business_analysis);
    }
    
    return 'default';
  }
  
  classifySegment(audienceData) {
    // Simple rule-based classification
    const text = JSON.stringify(audienceData).toLowerCase();
    
    if (text.includes('decision') || text.includes('executive') || text.includes('c-suite')) {
      return 'b2b_decision_makers';
    }
    if (text.includes('end user') || text.includes('consumer')) {
      return 'end_users';
    }
    if (text.includes('technical') || text.includes('developer')) {
      return 'technical_audience';
    }
    
    return 'default';
  }
}
```

**3. SEO Strategy Selection:**

**File: `services/enhanced-blog-generation.js`** (modify `buildEnhancedPrompt`)
```javascript
// After line 1196 (SEO instructions)
const audienceSegment = await audienceSegmentationService.getAudienceSegment(organizationId);
const seoStrategy = organizationContext.settings.seo_strategy?.[audienceSegment] || 
                    organizationContext.settings.seo_strategy?.default ||
                    'comprehensive';

// Adjust SEO instructions based on strategy
const seoInstructions = this.buildSEOInstructions(seoStrategy, seoTarget, hasInternalLinks, hasCTAs);
```

**4. Store Strategy Per Project:**

When generating content, store selected strategy:
```javascript
// In saveEnhancedBlogPost
await db.query(`
  UPDATE blog_posts
  SET seo_strategy = $1
  WHERE id = $2
`, [seoStrategy, postId]);
```

**5. Implementation Steps:**

1. Add `seo_strategy` JSONB column to `organizations` table
2. Create `services/audience-segmentation.js`
3. Modify `services/enhanced-blog-generation.js::buildEnhancedPrompt()` to use audience-specific strategy
4. Add UI endpoint: `GET /api/v1/organizations/:id/seo-strategy`
5. Add update endpoint: `PUT /api/v1/organizations/:id/seo-strategy`

**Files:**
- `database/XX_add_seo_strategy.sql` (migration)
- `services/audience-segmentation.js` (new)
- `services/enhanced-blog-generation.js:1196` (modify)
- `routes/organizations.js` (add SEO strategy endpoints)

---

## E) Execution Roadmap

### MVP

**Analytics Events**
- Create `middleware/analytics.js` with tracking middleware
- Add automatic tracking to signup, login, draft_generated, published, scrape_completed
- Test in dev and verify events show up in `user_activity_events` table

**SendGrid Integration**
- Install `@sendgrid/mail`
- Create `services/email.js` with EmailService class
- Create onboarding email template (SendGrid or HTML)
- Add onboarding email trigger to registration flow
- Test email delivery

**Dashboard Metrics**
- Add activation metrics query to `services/analytics.js`
- Create `GET /api/v1/analytics/dashboard` endpoint
- Test metrics calculation

### Recommendations + SEO Strategy

**Recommendation Engine**
- Create `services/recommendations.js`
- Create `routes/recommendations.js`
- Implement compute-on-read recommendations
- Add dismiss/complete endpoints
- Test with real user data

**SEO Strategy by Audience**
- Add `seo_strategy` JSONB column to organizations table
- Create `services/audience-segmentation.js`
- Modify blog generation to use audience-specific strategy
- Add SEO strategy API endpoints

**Testing & Documentation**
- End-to-end test: signup → generate → publish → recommendations
- Document API endpoints
- Create migration scripts

### Follow-Up Improvements

**Monitoring & Error Tracking:**
- [ ] Add Winston/Pino for structured logging
- [ ] Integrate Sentry for error tracking
- [ ] Set up alerts for high error rates

**Email Enhancements:**
- [ ] Add draft ready email
- [ ] Create weekly summary cron job
- [ ] Add email preferences table and unsubscribe support
- [ ] Implement rate limiting for SendGrid

**Recommendation Improvements:**
- [ ] Add recommendations table if performance issues
- [ ] Implement caching (Redis or memory)
- [ ] Add A/B testing for recommendation prioritization

**Queue System (If Needed):**
- [ ] Evaluate Bull/BullMQ for background jobs
- [ ] Migrate image generation to queue
- [ ] Migrate tweet enrichment to queue
- [ ] Add retry logic with exponential backoff

**Performance:**
- [ ] Add database indexes for analytics queries
- [ ] Optimize recommendation computation
- [ ] Cache frequently accessed data

---

## Risks & Unknowns

**Things I couldn't confirm:**
1. Production database performance - don't know query performance or connection limits. Mitigation: Add query logging, monitor slow queries.
2. Vercel function limits - exact timeout and memory limits unknown. Mitigation: Test with realistic payloads, monitor function duration.
3. SendGrid quota - current usage unknown. Mitigation: Start with free tier, add rate limiting.
4. Analytics table size - don't know current `user_activity_events` table size or growth rate. Mitigation: Add table partitioning if > 1M rows, archive old events.

**Assumptions:**
- Vercel serverless (assuming 60s timeout based on code)
- PostgreSQL database (probably Neon, Supabase, or RDS)
- SendGrid free tier sufficient for MVP
- Analytics events table can handle 10K+ events/day

**New Dependencies:**
- `@sendgrid/mail` (only new one needed for MVP)

---

## Success Metrics

**Analytics:** 100% of signups tracked, 90%+ of content generations tracked, dashboard loads in < 2 seconds.

**Email:** 95%+ delivery rate, < 1% bounce rate, onboarding email open rate > 30%.

**Recommendations:** Average 3-5 recommendations per active user, 20%+ click-through rate, load in < 500ms.

**SEO Strategy:** 80%+ of organizations have SEO strategy configured, audience segmentation accuracy > 70%.

---

## Next Steps After MVP

1. A/B testing framework for recommendation prioritization and email subject lines
2. Advanced analytics: cohort analysis, retention funnels, revenue attribution
3. Marketing automation: drip campaigns, behavioral triggers, lead scoring
4. Queue system: migrate to Bull/BullMQ for reliability
5. Caching layer: Redis for recommendations and analytics aggregations
