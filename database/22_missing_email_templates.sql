-- =====================================================
-- Migration 22: Missing Email Templates
-- =====================================================
-- Adds 5 missing email templates to reach total of 34
-- =====================================================

-- 1. Organization Member Invitation
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'organization_member_invitation',
    'transactional',
    'You are an email marketing expert who writes professional team invitation emails. Your goal is to make the recipient feel valued and excited about joining the organization.',
    'Write an organization member invitation email with these details:

INVITER: {{inviterName}}
ORGANIZATION: {{organizationName}}
RECIPIENT: {{email}}
INVITE CODE: {{inviteCode}}
INVITE URL: {{inviteUrl}}

The email should:
1. Be professional and welcoming
2. Explain what the organization is and what they do
3. Mention the role or access they will have
4. Include a clear call-to-action button
5. Keep it under 120 words

Return JSON:
{
  "subject": "string - professional subject mentioning organization",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body with simple styling",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Accept Invitation",
    "url": "{{inviteUrl}}"
  }
}',
    0.6,
    700,
    json_build_array('inviterName', 'organizationName', 'email', 'inviteCode', 'inviteUrl')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 2. Payment Failed Alert (Admin)
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'payment_failed_alert',
    'admin',
    'You are an operations expert who writes actionable alert emails. Your goal is to flag payment failures for immediate follow-up.',
    'Write a payment failed alert email for admin:

USER: {{userId}}
NAME: {{firstName}} {{lastName}}
EMAIL: {{email}}
INVOICE ID: {{invoiceId}}
AMOUNT: ${{amount}}
PLAN TIER: {{planTier}}

The email should:
1. Clearly flag as PAYMENT FAILED
2. Include user and invoice details
3. Mention next steps (retry, contact user)
4. Keep it brief (under 80 words)

Return JSON:
{
  "subject": "string - URGENT payment failed subject",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body with key details",
  "bodyPlainText": "string - plain text version",
  "cta": null
}',
    0.5,
    600,
    json_build_array('userId', 'firstName', 'lastName', 'email', 'invoiceId', 'amount', 'planTier')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 3. High-Value Lead Notification (Admin)
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'high_value_lead_notification',
    'admin',
    'You are a sales operations expert who writes lead alert emails. Your goal is to flag high-value leads for immediate follow-up.',
    'Write a high-value lead notification email for admin:

LEAD ID: {{leadId}}
EMAIL: {{email}}
WEBSITE: {{websiteUrl}}
LEAD SCORE: {{leadScore}}/100
INDUSTRY FIT: {{industryFitScore}}/100
URGENCY: {{urgencyScore}}/100
COMPANY SIZE: {{estimatedCompanySize}}
SOURCE: {{leadSource}}

The email should:
1. Clearly flag as HIGH-VALUE LEAD
2. Present scoring breakdown
3. Highlight why this lead is valuable
4. Keep it scannable (under 120 words)

Return JSON:
{
  "subject": "string - HIGH-VALUE LEAD alert with score",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body with formatted metrics",
  "bodyPlainText": "string - plain text version",
  "cta": null
}',
    0.5,
    800,
    json_build_array('leadId', 'email', 'websiteUrl', 'leadScore', 'industryFitScore', 'urgencyScore', 'estimatedCompanySize', 'leadSource')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 4. Referral Accepted Notification
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'referral_accepted_notification',
    'referral',
    'You are an email marketing expert who writes celebratory notification emails. Your goal is to celebrate successful referrals and keep users engaged.',
    'Write a referral accepted notification email for:

USER: {{firstName}}
REFERRED EMAIL: {{referredEmail}}
ACCEPTED AT: {{acceptedAt}}

The email should:
1. Congratulate them on successful referral
2. Mention who accepted (if appropriate)
3. Remind them of their reward (1 free post)
4. Encourage more referrals
5. Keep it under 100 words

Return JSON:
{
  "subject": "string - celebratory subject about referral",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Refer More Friends",
    "url": "https://automatemyblog.com/referrals"
  }
}',
    0.7,
    700,
    json_build_array('firstName', 'referredEmail', 'acceptedAt')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 5. Referral Reward Granted
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'referral_reward_granted',
    'referral',
    'You are an email marketing expert who writes reward confirmation emails. Your goal is to confirm rewards and encourage continued participation.',
    'Write a referral reward granted email for:

USER: {{firstName}}
REWARD TYPE: {{rewardType}}
REWARD VALUE: ${{rewardValue}}
GRANTED AT: {{grantedAt}}

The email should:
1. Confirm reward was granted
2. Explain what they received (1 free blog post)
3. Show how to use it
4. Thank them for referrals
5. Keep it under 80 words

Return JSON:
{
  "subject": "string - reward confirmation subject",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Use Your Credit",
    "url": "https://automatemyblog.com/dashboard"
  }
}',
    0.6,
    600,
    json_build_array('firstName', 'rewardType', 'rewardValue', 'grantedAt')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- =====================================================
-- Verification
-- =====================================================

DO $$
DECLARE
    template_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO template_count FROM email_templates WHERE active = TRUE;

    RAISE NOTICE '✅ Migration 22: Missing Email Templates completed';
    RAISE NOTICE '📧 Total active email templates: %', template_count;
    RAISE NOTICE '🎯 Expected: 34 templates';

    IF template_count >= 34 THEN
        RAISE NOTICE '✅ All 34 email templates are now seeded!';
    ELSE
        RAISE NOTICE '⚠️  Only % templates found (expected 34)', template_count;
    END IF;
END $$;
