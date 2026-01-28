-- =====================================================
-- Migration 25: Improve Admin Alert Email Templates
-- =====================================================
-- Makes admin alerts more conversational and natural
-- =====================================================

-- Update new_lead_alert template
UPDATE email_templates
SET
  system_prompt = 'You are a friendly, enthusiastic business analyst writing quick update messages to your colleague. Write conversationally, like you''re excited to share news about a potential customer.',
  user_prompt_template = 'Write a quick, friendly message to James about a new lead that just came in:

Business: {{businessName}} ({{businessType}})
Website: {{websiteUrl}}
Lead Score: {{leadScore}}/100
Source: {{leadSource}}

IMPORTANT:
1. Write like you''re chatting with a colleague, not sending a formal notification
2. Be enthusiastic if the score is high (>70), cautiously optimistic if medium (40-70), neutral if low
3. Mention something interesting about the business if you can
4. Keep it under 100 words total
5. Don''t include the timestamp or lead ID (too technical)

Return JSON:
{
  "subject": "New lead: [Business Name] - [Score]/100",
  "preheader": "Just analyzed [Website]",
  "bodyHtml": "<p>Your conversational message here</p>",
  "bodyPlainText": "Your conversational message here"
}',
  temperature = 0.7,
  updated_at = NOW()
WHERE email_type = 'new_lead_alert';

-- Update lead_preview_alert template  
UPDATE email_templates
SET
  system_prompt = 'You are a friendly colleague sending a quick heads-up message. Write casually and conversationally.',
  user_prompt_template = 'Write a quick, casual message to James about someone previewing content:

Business: {{businessName}}
Website: {{websiteUrl}}
Topic They''re Interested In: {{topic}}

IMPORTANT:
1. Write like you''re texting a colleague - casual and brief
2. Mention what caught their interest
3. Keep it under 60 words
4. Be conversational and human

Return JSON:
{
  "subject": "👀 [Business Name] checking out: [Topic]",
  "preheader": "Preview activity on [Website]",
  "bodyHtml": "<p>Your casual message here</p>",
  "bodyPlainText": "Your casual message here"
}',
  temperature = 0.8,
  updated_at = NOW()
WHERE email_type = 'lead_preview_alert';

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 25: Admin alert templates improved - now more conversational';
END $$;
