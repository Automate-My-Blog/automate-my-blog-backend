-- =====================================================
-- Migration 20: Email System with LLM Content Generation
-- =====================================================
-- This migration creates the complete email infrastructure for:
-- - Email logging and audit trail
-- - LLM prompt templates for dynamic content generation
-- - Lead nurture queue for automated campaigns
-- - Email preferences and unsubscribe management
-- =====================================================

-- =====================================================
-- Part 1: Email Logs Table
-- =====================================================
-- Comprehensive audit trail for all emails sent
-- Tracks delivery, open, and click events via SendGrid webhooks

CREATE TABLE IF NOT EXISTS email_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    email_type VARCHAR(100) NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500),
    sendgrid_message_id VARCHAR(100),
    status VARCHAR(50) DEFAULT 'pending',
    context_data JSONB,
    generated_content JSONB,
    error_message TEXT,
    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    opened_at TIMESTAMP,
    clicked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for email_logs
CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_email_type ON email_logs(email_type);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON email_logs(sent_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON email_logs(recipient_email);
CREATE INDEX IF NOT EXISTS idx_email_logs_sendgrid_id ON email_logs(sendgrid_message_id);

COMMENT ON TABLE email_logs IS 'Comprehensive log of all emails sent with LLM generation context and delivery tracking';
COMMENT ON COLUMN email_logs.email_type IS 'Type of email: referral_invitation, low_credit_warning, etc.';
COMMENT ON COLUMN email_logs.status IS 'Status: pending, sent, delivered, opened, bounced, failed';
COMMENT ON COLUMN email_logs.context_data IS 'Full context passed to LLM for debugging and auditing';
COMMENT ON COLUMN email_logs.generated_content IS 'LLM output (subject, body, CTA) for quality auditing';

-- =====================================================
-- Part 2: Email Templates Table (LLM Prompt Library)
-- =====================================================
-- Stores system prompts and user prompt templates for each email type
-- Enables dynamic email generation without hardcoded templates

CREATE TABLE IF NOT EXISTS email_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email_type VARCHAR(100) UNIQUE NOT NULL,
    category VARCHAR(50) NOT NULL,
    system_prompt TEXT NOT NULL,
    user_prompt_template TEXT NOT NULL,
    temperature DECIMAL(3,2) DEFAULT 0.7,
    max_tokens INTEGER DEFAULT 1000,
    required_context_fields JSONB,
    example_output JSONB,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for email_templates
CREATE INDEX IF NOT EXISTS idx_email_templates_email_type ON email_templates(email_type);
CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);
CREATE INDEX IF NOT EXISTS idx_email_templates_active ON email_templates(active);

COMMENT ON TABLE email_templates IS 'LLM prompt templates for each email type with GPT-4o generation parameters';
COMMENT ON COLUMN email_templates.email_type IS 'Unique identifier: referral_invitation, low_credit_warning, etc.';
COMMENT ON COLUMN email_templates.category IS 'transactional, engagement, reengagement, lead_nurture, admin, billing, referral';
COMMENT ON COLUMN email_templates.system_prompt IS 'GPT-4o system prompt defining the email expert persona';
COMMENT ON COLUMN email_templates.user_prompt_template IS 'Handlebars-style template with {{variables}} for context interpolation';
COMMENT ON COLUMN email_templates.temperature IS 'GPT-4o temperature (0.3-0.7): lower = deterministic, higher = creative';
COMMENT ON COLUMN email_templates.max_tokens IS 'Maximum tokens for LLM response (800-1200 typical)';
COMMENT ON COLUMN email_templates.required_context_fields IS 'Array of required data fields: ["user.firstName", "organization.businessType"]';

-- =====================================================
-- Part 3: Lead Nurture Queue Table
-- =====================================================
-- Scheduled lead nurture emails based on lead scoring
-- Enables automated campaigns for high/warm/cold leads

CREATE TABLE IF NOT EXISTS lead_nurture_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID REFERENCES website_leads(id) ON DELETE CASCADE,
    email_type VARCHAR(100) NOT NULL,
    scheduled_for TIMESTAMP NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    priority INTEGER DEFAULT 50,
    context_snapshot JSONB,
    sent_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for lead_nurture_queue
CREATE INDEX IF NOT EXISTS idx_lead_nurture_scheduled ON lead_nurture_queue(scheduled_for, status);
CREATE INDEX IF NOT EXISTS idx_lead_nurture_lead_id ON lead_nurture_queue(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_nurture_priority ON lead_nurture_queue(priority DESC);
CREATE INDEX IF NOT EXISTS idx_lead_nurture_status ON lead_nurture_queue(status);

COMMENT ON TABLE lead_nurture_queue IS 'Scheduled lead nurture emails based on scoring (high/warm/cold)';
COMMENT ON COLUMN lead_nurture_queue.email_type IS 'high_lead_score_followup, warm_lead_nurture, cold_lead_reactivation';
COMMENT ON COLUMN lead_nurture_queue.scheduled_for IS 'When to send the email (processed by scheduled job)';
COMMENT ON COLUMN lead_nurture_queue.status IS 'pending, sent, cancelled';
COMMENT ON COLUMN lead_nurture_queue.priority IS 'Higher number = more urgent (high score leads get priority)';
COMMENT ON COLUMN lead_nurture_queue.context_snapshot IS 'Lead data at queue time for consistent messaging';

-- =====================================================
-- Part 4: Schema Additions to Existing Tables
-- =====================================================

-- Add email preferences and unsubscribe management to users table
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_preferences JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS unsubscribed_from JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS last_email_sent_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS total_emails_sent INTEGER DEFAULT 0;

COMMENT ON COLUMN users.email_preferences IS 'User email frequency preferences: {"marketing": true, "product_updates": true, "weekly_digest": false}';
COMMENT ON COLUMN users.unsubscribed_from IS 'Array of email types user unsubscribed from: ["marketing", "reengagement"]';
COMMENT ON COLUMN users.last_email_sent_at IS 'Timestamp of last email sent (for rate limiting and spam prevention)';
COMMENT ON COLUMN users.total_emails_sent IS 'Total number of emails sent to this user (for analytics)';

-- Add credit expiration warning tracking to user_credits table
ALTER TABLE user_credits
    ADD COLUMN IF NOT EXISTS expiration_warning_sent_at TIMESTAMP;

COMMENT ON COLUMN user_credits.expiration_warning_sent_at IS 'Timestamp when 7-day expiration warning was sent (prevents duplicate warnings)';

-- =====================================================
-- Part 5: Initial Seed Data - Core Email Templates
-- =====================================================
-- Seed 5 core email types with LLM prompts
-- Additional templates can be added via admin interface

-- 1. Referral Invitation Email
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'referral_invitation',
    'referral',
    'You are an email marketing expert who writes warm, personal invitation emails. Your goal is to make the recipient feel valued and excited about joining through their friend''s referral.',
    'Write a referral invitation email with these details:

INVITER: {{inviterName}} ({{inviterEmail}})
RECIPIENT: {{email}}
INVITE CODE: {{inviteCode}}
INVITE URL: {{inviteUrl}}

The email should:
1. Be warm and personal (from {{inviterName}}, not the company)
2. Explain what AutoBlog is in 1-2 sentences
3. Mention that both the inviter and recipient get 1 free blog post ($15 value)
4. Include a clear call-to-action button
5. Keep it under 150 words

Return JSON:
{
  "subject": "string - warm, personal subject line mentioning {{inviterName}}",
  "preheader": "string - preview text that extends the subject",
  "bodyHtml": "string - HTML email body with simple styling",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Accept Invitation",
    "url": "{{inviteUrl}}"
  }
}',
    0.7,
    800,
    '["inviterName", "email", "inviteCode", "inviteUrl"]'::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 2. Welcome Email
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'welcome_email',
    'transactional',
    'You are an email marketing expert who writes welcoming, helpful onboarding emails. Your goal is to make new users feel excited about getting started and guide them to their first success.',
    'Write a welcome email for a new user:

USER: {{firstName}} {{lastName}}
EMAIL: {{email}}
BUSINESS TYPE: {{businessType}}
PLAN: {{planTier}}

The email should:
1. Welcome them warmly and congratulate them on joining
2. Explain the next steps to get started (website analysis → audience selection → content generation)
3. Highlight 2-3 key features they can use right away
4. Include a clear "Get Started" CTA
5. Keep it under 120 words

Return JSON:
{
  "subject": "string - exciting, welcoming subject line",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Get Started",
    "url": "https://automatemyblog.com/dashboard"
  }
}',
    0.7,
    700,
    '["firstName", "lastName", "email", "planTier"]'::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 3. Low Credit Warning
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'low_credit_warning',
    'engagement',
    'You are an email marketing expert who writes helpful, non-pushy reminder emails. Your goal is to inform users about their credit status while providing a seamless upgrade path.',
    'Write a low credit warning email for:

USER: {{firstName}} {{lastName}}
CURRENT PLAN: {{planTier}}
AVAILABLE CREDITS: {{availableCredits}}
BUSINESS TYPE: {{businessType}}
RECENT POSTS: {{weeklyStats.postsGenerated}} in the last 7 days

The email should:
1. Be friendly and helpful (not salesy or pushy)
2. Clearly state how many credits remain
3. Suggest appropriate plan upgrade based on their usage
4. Highlight value of subscription vs pay-per-use ($5/post vs $15/post)
5. Keep it under 120 words

Return JSON:
{
  "subject": "string - clear, direct subject about credit status",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "View Plans",
    "url": "{{upgradeUrl}}"
  }
}',
    0.6,
    700,
    '["firstName", "availableCredits", "planTier", "upgradeUrl"]'::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 4. Subscription Confirmation
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'subscription_confirmation',
    'billing',
    'You are an email marketing expert who writes clear, reassuring transactional emails. Your goal is to confirm the subscription details and make users feel confident about their purchase.',
    'Write a subscription confirmation email for:

USER: {{firstName}} {{lastName}}
PLAN: {{subscription.plan_name}}
AMOUNT: ${{subscription.amount}}/month
NEXT BILLING: {{subscription.current_period_end}}
CREDITS INCLUDED: {{subscription.credits_included}} blog posts per month

The email should:
1. Confirm the subscription with clear details
2. Explain what they get (credits, features)
3. Mention the next billing date
4. Include a "View Dashboard" CTA
5. Keep it under 100 words

Return JSON:
{
  "subject": "string - confirmation subject with plan name",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "View Dashboard",
    "url": "https://automatemyblog.com/dashboard"
  }
}',
    0.5,
    600,
    '["firstName", "subscription"]'::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 5. High Lead Score Follow-up
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'high_lead_score_followup',
    'lead_nurture',
    'You are a sales expert who writes personalized, consultative follow-up emails to high-value leads. Your goal is to start a conversation, not push a hard sale.',
    'Write a high-value lead follow-up email for:

LEAD SCORE: {{leadScore}}/100
BUSINESS SIZE: {{estimatedCompanySize}}
INDUSTRY FIT: {{industryFitScore}}/100
URGENCY: {{urgencyScore}}/100
LEAD SOURCE: {{leadSource}}
WEBSITE: {{websiteUrl}}

The email should:
1. Reference their specific business context (size, industry)
2. Acknowledge their interest/activity that triggered high score
3. Offer a quick 15-min consultation call (not a sales pitch)
4. Provide immediate value (tips, insights)
5. Sound human and consultative, not automated
6. Keep it under 150 words

Return JSON:
{
  "subject": "string - personalized, referencing their business context",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Schedule a Quick Call",
    "url": "https://calendly.com/automyblog/15min"
  }
}',
    0.7,
    900,
    '["leadScore", "estimatedCompanySize", "industryFitScore", "urgencyScore", "leadSource"]'::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- =====================================================
-- Migration Complete
-- =====================================================

-- Verify tables were created
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_logs') THEN
        RAISE NOTICE '✅ email_logs table created successfully';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_templates') THEN
        RAISE NOTICE '✅ email_templates table created successfully';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_nurture_queue') THEN
        RAISE NOTICE '✅ lead_nurture_queue table created successfully';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email_preferences') THEN
        RAISE NOTICE '✅ users.email_preferences column added successfully';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_credits' AND column_name = 'expiration_warning_sent_at') THEN
        RAISE NOTICE '✅ user_credits.expiration_warning_sent_at column added successfully';
    END IF;

    RAISE NOTICE '✅ Migration 20: Email System completed successfully';
    RAISE NOTICE '📧 Created 3 tables: email_logs, email_templates, lead_nurture_queue';
    RAISE NOTICE '📧 Added columns to users and user_credits tables';
    RAISE NOTICE '📧 Seeded 5 core email templates with LLM prompts';
END $$;
