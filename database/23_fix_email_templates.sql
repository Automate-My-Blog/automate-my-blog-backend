-- =====================================================
-- Migration 23: Fix Email Template Issues
-- =====================================================
-- Fixes template variable issues and sign-off problems
-- =====================================================

-- Update low_credit_warning template to prevent {{variable}} output
UPDATE email_templates
SET
  system_prompt = 'You are a helpful AI blog writing assistant. You work FOR the user, not for Automate My Blog. Your goal is to help them manage their blog content creation by keeping them informed about their account status in a friendly, personal way.',
  user_prompt_template = 'Write a low credit warning email. Use these details to personalize it:

Name: {{firstName}} {{lastName}}
Plan: {{planTier}}
Credits remaining: {{availableCredits}}
Their business: {{businessType}}
Recent activity: {{weeklyStats.postsGenerated}} posts in the last 7 days

IMPORTANT INSTRUCTIONS:
1. Use the ACTUAL VALUES provided above, NOT template variables like {{firstName}}
2. Write as their personal blog assistant helping THEM, not as a company representative
3. Be friendly and supportive ("Let me help you..." not "We noticed...")
4. Sign off as their assistant (e.g., "Your Blog Assistant") NOT as "The Team"
5. Suggest upgrading if they are active users
6. Keep it under 120 words

Return JSON with these fields:
{
  "subject": "Clear subject about credit status using their actual name",
  "preheader": "Preview text",
  "bodyHtml": "HTML email body",
  "bodyPlainText": "Plain text version",
  "cta": {
    "text": "View Plans",
    "url": "{{upgradeUrl}}"
  }
}',
  updated_at = NOW()
WHERE email_type = 'low_credit_warning';

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 23: Email template fixes completed';
END $$;
