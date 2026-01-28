-- =====================================================
-- Migration 24: Add Admin Lead Alert Email Templates
-- =====================================================
-- Adds two new admin alert email types:
-- 1. new_lead_alert - When a new lead enters the website
-- 2. lead_preview_alert - When a lead previews content
-- =====================================================

-- Insert new_lead_alert template
INSERT INTO email_templates (
  email_type,
  category,
  system_prompt,
  user_prompt_template,
  temperature,
  max_tokens,
  required_context_fields,
  active
) VALUES (
  'new_lead_alert',
  'admin',
  'You are an administrative notification system. Write clear, informative alerts for admin users about new leads entering the system.',
  'Write an admin alert email for a new lead:

Lead ID: {{leadId}}
Website: {{websiteUrl}}
Business Name: {{businessName}}
Business Type: {{businessType}}
Lead Score: {{leadScore}}/100
Source: {{leadSource}}
Timestamp: {{timestamp}}

IMPORTANT:
1. Keep it concise and data-focused (under 80 words)
2. Highlight high-value leads (score > 70)
3. Include actionable next steps
4. Format as plain text notification

Return JSON:
{
  "subject": "🎯 New Lead: [Business Name] ([Lead Score]/100)",
  "preheader": "New lead from [Website]",
  "bodyHtml": "<p>HTML version</p>",
  "bodyPlainText": "Plain text version"
}',
  0.3,
  500,
  json_build_array('leadId', 'websiteUrl', 'businessName', 'leadScore')::jsonb,
  TRUE
);

-- Insert lead_preview_alert template
INSERT INTO email_templates (
  email_type,
  category,
  system_prompt,
  user_prompt_template,
  temperature,
  max_tokens,
  required_context_fields,
  active
) VALUES (
  'lead_preview_alert',
  'admin',
  'You are an administrative notification system. Write clear, informative alerts for admin users about lead activity.',
  'Write an admin alert email for lead preview activity:

Business: {{businessName}}
Website: {{websiteUrl}}
Topic Previewed: {{topic}}
Timestamp: {{timestamp}}

IMPORTANT:
1. Keep it very brief (under 60 words)
2. Focus on the engagement signal
3. Mention the topic being previewed
4. Format as plain text notification

Return JSON:
{
  "subject": "👀 Preview Activity: [Business Name]",
  "preheader": "Lead previewed: [Topic]",
  "bodyHtml": "<p>HTML version</p>",
  "bodyPlainText": "Plain text version"
}',
  0.3,
  400,
  json_build_array('websiteUrl', 'businessName', 'topic')::jsonb,
  TRUE
);

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 24: Admin lead alert templates added';
END $$;
