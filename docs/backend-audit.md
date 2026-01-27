# AutomateMyBlog Backend Audit

**Date:** January 26, 2026  
**Auditor:** Sam Hill

## TL;DR

The backend is a Node.js/Express app running on Vercel that generates AI blog content. It works, but there are some gaps: no email service (SendGrid), analytics events aren't being tracked automatically, and there's no recommendation system despite having the data for it. The architecture is solid overall, but there are reliability concerns around error handling and background jobs.

---

## Architecture Overview

The stack is pretty straightforward: Node.js with Express 5, deployed on Vercel as serverless functions. Database is PostgreSQL with connection pooling. No dedicated queue system - they're using Vercel's `waitUntil()` for background work, which could be problematic (more on that later).

**Tech Stack:**
- Node.js (ES modules) + Express 5.2.1
- PostgreSQL database
- Vercel serverless deployment
- External services: OpenAI (GPT-4o), Stripe, Puppeteer/Playwright for scraping, Grok API for tweets, QuickChart/DALL-E for images

**Main Entry Points:**

The API is organized into routes under `/routes/`. Key ones:
- `/api/v1/enhanced-blog-generation/*` - Where the magic happens (content generation)
- `/api/v1/analysis/*` - Website scraping and analysis
- `/api/v1/analytics/*` - Analytics endpoints (superadmin only right now)
- `/api/v1/posts/*`, `/api/v1/organizations/*`, `/api/v1/stripe/*` - Standard CRUD stuff

Services live in `/services/` and handle the business logic. The big one is `enhanced-blog-generation.js` which orchestrates everything. There's also a web scraper with multiple fallbacks (Puppeteer → Playwright → Browserless → Cheerio), which is smart - scraping is unreliable.

---

## How Content Generation Works

Tracing through the code, here's the flow from user input to published blog post:

**Step 1: Input Collection**
User either provides a website URL or manually enters brand voice, CTAs, audience info. The website analysis route (`POST /api/v1/analysis/analyze-website`) hits the web scraper service, which tries Puppeteer first, then falls back to Playwright, then Browserless.io, and finally Cheerio if all else fails. Smart approach - scraping is flaky.

**Step 2: Load Organization Context**
Before generating, the system loads everything it knows about the organization: CTAs from their website, internal links, brand voice analysis, and any manual inputs. This happens in `getOrganizationContext()` which queries a bunch of tables. The context gets fed into the generation prompt.

**Step 3: Generate Content**
The `generateCompleteEnhancedBlog()` function builds a massive prompt (seriously, like 2000+ lines) with all that context, then calls OpenAI GPT-4o with 7000 max tokens. The prompt includes instructions for highlight boxes, image placeholders, tweet placeholders - it's comprehensive but also kind of unwieldy.

**Step 4: Async Enrichment**
After the initial generation, images and tweets get added asynchronously. Images are generated via QuickChart or DALL-E, tweets come from the Grok API. This uses Vercel's `waitUntil()` to keep the function alive, which works but isn't ideal (no retries if it fails).

**Step 5: Save to Database**
Everything gets saved to the `blog_posts` table with metadata, SEO predictions, generation costs, etc.

**Step 6: Publish/Export**
User can change status from `draft` to `published` and export in Markdown, HTML, or JSON formats.

Key files if you want to dig in:
- Entry point: `routes/enhanced-blog-generation.js:42` (the `/generate` endpoint)
- Main service: `services/enhanced-blog-generation.js:1882`
- OpenAI wrapper: `services/openai.js:410`

---

## Database Schema

The schema is pretty comprehensive. Here's what's in there:

**Users & Organizations:** Standard multi-tenant setup with `users`, `organizations`, and `organization_members` for RBAC. Users have plan tiers (free, pay_as_you_go, starter, pro).

**Content Tables:** `projects` represent websites/brands, `blog_posts` store the generated content with version history, `content_topics` have engagement scores, and `content_strategies` are SEO templates per project.

**Billing:** Stripe integration with `subscriptions`, `pay_per_use_charges` ($15 per generation), `user_credits` for free credits and referral rewards, and `billing_cycles` for monthly periods.

**Analytics:** There's a `user_activity_events` table for event tracking, `generation_history` logs AI calls with costs, `user_sessions` for session tracking, and `daily_metrics` (though this looks partially implemented).

**Lead Generation:** Tables for `website_leads` (anonymous visitor tracking), `conversion_tracking` (funnel steps), and `lead_scoring` (automated 0-100 scores).

**Referrals:** `user_invites` and `referral_rewards` - they give $15 value per referral which is tracked here.

The schema looks solid overall. The analytics tables exist but aren't being used to their full potential (more on that below).

---

## Tech Debt & Issues I Found

Here are the main problems I spotted while going through the code:

**1. No Queue System**
They're using Vercel's `waitUntil()` for background work (images, tweets). This works but has no retry mechanism and can timeout. If image generation fails, it just fails silently. Should probably use a proper queue like Bull/BullMQ.

**2. Massive Prompt Building**
The `buildEnhancedPrompt()` function creates 2000+ line prompts. It's comprehensive but also hard to maintain and probably wastes tokens. The prompt building logic is in `services/enhanced-blog-generation.js` starting around line 1059.

**3. Inconsistent Error Handling**
Some services throw errors, others return `{success: false}`. There's no centralized retry logic for external API calls. The web scraper has good fallbacks, but other services don't.

**4. Database Connection Pooling**
Production uses a single connection (`max: 1`) to avoid pool conflicts, and there are 30-second timeouts which suggests the database might be slow. This is in `services/database.js`.

**5. Auth Fallback to Memory**
If the database is unavailable, auth falls back to in-memory storage. This breaks session adoption and causes foreign key violations. Found in `services/auth-database.js`.

**6. No Idempotency Keys**
Stripe webhooks and some API calls don't use idempotency keys, so duplicate processing is possible.

**7. JSON Parsing Issues**
There's a `safeParse()` helper in `routes/analysis.js` but it's not used consistently everywhere. Corrupted JSON could crash things.

**8. Hardcoded Timeouts**
30s for images, 60s for Grok API - no exponential backoff. If something's slow, it just fails.

**9. Analytics Not Automatic**
The analytics service exists but events are only tracked manually via API calls. Key actions like signup, generation, publish aren't automatically tracked. This is a big gap.

**10. No OpenAI Rate Limiting**
Express has rate limiting but it doesn't cover OpenAI quota. Could hit 429 errors or cost overruns.

---

## Reliability Concerns

**Rate Limits & Quotas:** OpenAI has no rate limiting wrapper (429 errors possible), Grok API has a 60s timeout with no retries, Stripe webhooks are verified but lack idempotency keys, and the database uses a single connection which could bottleneck.

**Retry Logic:** Mostly missing. The web scraper has a good fallback chain, and image generation falls back from DALL-E to QuickChart, but there's no retry mechanism for failed API calls.

**Idempotency:** Stripe webhooks don't store idempotency keys, blog generation has no deduplication, and the credit expiration job could run multiple times.

**Error Handling:** It's inconsistent - some places throw errors, others return `{success: false}`. On the plus side, tweets and images fail gracefully (content still gets generated). Database errors are logged extensively but there's no alerting.

**Secrets & Config:** JWT secrets fall back to a hardcoded dev secret if not set (yikes). Database URL supports both `DATABASE_URL` and individual params, but there's no validation that required env vars are set at startup.

**Logging & Monitoring:** Just console.log everywhere - no structured logging. No error tracking service (Sentry, Rollbar). There's a basic `/health` endpoint and the analytics service exists, but no dashboards or alerting set up.

---

## Security Overview

**Authentication:** JWT-based with 7-day expiry. Protected routes use `authService.authMiddleware()`. There's also optional session ID support for anonymous users.

**RBAC:** User roles are `user`, `admin`, `super_admin`. Organization roles are `owner`, `admin`, `member`, `viewer`. Analytics endpoints are superadmin-only which is good.

**Data Access:** Multi-tenant with `organization_id` filtering, and most operations check `user_id`. That said, I'd want to audit all queries to make sure they're properly filtering - didn't do a full security audit here.

**PII:** Emails stored in plain text, passwords are bcrypt hashed (good). Sensitive data like billing and analysis results are stored as JSONB without encryption, which might be fine depending on compliance requirements.

**Webhooks:** Stripe webhooks verify signatures properly via `stripe.webhooks.constructEvent()`.

---

## What I'd Fix First

If I were taking over this backend, here's what I'd prioritize:

**1. Analytics Spine + Event Tracking**
The analytics service exists but it's only being used manually. Critical actions like signup, first generation, publish, and payment should be automatically tracked. Right now you can't measure activation or retention properly, and the recommendation engine (which already has the data) can't work without this.

I'd add event tracking middleware that automatically logs key actions. The `user_activity_events` table is already there, just needs to be populated automatically. Start with 10-20 core events.

**2. SendGrid Integration**
There's no email service. I found a `TODO: Send email invitation here` comment in the referral code. You need transactional emails for onboarding, "your draft is ready" notifications, weekly summaries, etc. This is blocking growth.

Add SendGrid, create email templates, and set up event-driven triggers. Should be straightforward.

**3. Recommendation Engine**
The analytics service already has a `getUserOpportunities()` method that identifies upgrade candidates, churn risks, etc. This data just needs to be exposed as a recommendation API with proper prioritization. The hard work is done, just needs to be surfaced.

**4. Reliability Improvements**
Add retry logic with exponential backoff for external APIs, implement idempotency keys for Stripe webhooks, add structured logging (Winston) and error tracking (Sentry), and consider a proper queue system instead of `waitUntil()`. The current system works but will break under scale - background job failures are silent and API errors aren't retried.

---

## What I Couldn't Figure Out

Some things I couldn't confirm from the code:
- Production database performance (are queries slow? connection limits?)
- OpenAI API quota limits and current usage
- Exact Vercel function timeout limits (assumed 60s based on code comments)
- Whether image URLs expire or are permanent
- Current error rates and what users actually see when things fail

**Assumptions I'm making:**
- Vercel serverless deployment (saw `@vercel/functions` imports)
- PostgreSQL database (probably Neon, Supabase, or RDS)
- No email service exists (searched for SendGrid/Resend/SES, found nothing)
- Analytics events table exists but is underutilized

---

## Next Steps

I've written up a detailed implementation plan in `docs/analytics-and-growth-plan.md` that covers:
- Analytics spine MVP (can be done in a week)
- SendGrid integration
- Recommendation engine
- SEO strategy by audience
- Week-by-week execution roadmap

The plan is actionable with specific file paths and code examples.
