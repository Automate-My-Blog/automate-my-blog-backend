-- =====================================================
-- Migration 21: Additional Email Templates
-- =====================================================
-- Adds remaining 29 email templates (5 already exist from Migration 20)
-- Total: 34 email types across all categories
-- =====================================================

-- =====================================================
-- TRANSACTIONAL EMAILS (5 more - 3 already exist)
-- =====================================================

-- 6. Email Verification
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'email_verification',
    'transactional',
    'You are an email marketing expert who writes clear, urgent transactional emails. Your goal is to get users to verify their email address quickly.',
    'Write an email verification email for:

USER: {{firstName}}
EMAIL: {{email}}
VERIFICATION URL: {{verificationUrl}}

The email should:
1. Be urgent but friendly
2. Explain why email verification is needed (security and account activation)
3. Make it clear the link expires in 24 hours
4. Include a clear verification button
5. Keep it under 80 words

Return JSON:
{
  "subject": "string - urgent subject about verifying email",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Verify Email Address",
    "url": "{{verificationUrl}}"
  }
}',
    0.5,
    600,
    json_build_array('firstName', 'email', 'verificationUrl')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 7. Password Reset
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'password_reset',
    'transactional',
    'You are an email marketing expert who writes secure, helpful transactional emails. Your goal is to help users reset their password safely.',
    'Write a password reset email for:

EMAIL: {{email}}
RESET URL: {{resetUrl}}
EXPIRES IN: {{expiresIn}}

The email should:
1. Confirm this was requested (if not, ignore this email)
2. Make it clear the link expires soon
3. Include security tips (don''t share the link)
4. Include a clear reset button
5. Keep it under 100 words

Return JSON:
{
  "subject": "string - clear subject about password reset",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Reset Password",
    "url": "{{resetUrl}}"
  }
}',
    0.5,
    600,
    json_build_array('email', 'resetUrl', 'expiresIn')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 8. Password Change Confirmation
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'password_change_confirmation',
    'transactional',
    'You are an email marketing expert who writes security-focused confirmation emails. Your goal is to reassure users their account is secure.',
    'Write a password change confirmation email for:

USER: {{firstName}}
EMAIL: {{email}}
CHANGED AT: {{changedAt}}

The email should:
1. Confirm password was successfully changed
2. Include timestamp for their records
3. Explain what to do if they did not make this change (contact support)
4. Keep it under 80 words

Return JSON:
{
  "subject": "string - confirmation subject",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": null
}',
    0.5,
    600,
    json_build_array('firstName', 'email', 'changedAt')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 9. Account Deactivation Warning
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'account_deactivation_warning',
    'transactional',
    'You are an email marketing expert who writes helpful warning emails. Your goal is to inform users without being alarming.',
    'Write an account deactivation warning email for:

USER: {{firstName}}
EMAIL: {{email}}
DAYS UNTIL DEACTIVATION: {{daysUntilDeactivation}}
REACTIVATE URL: {{reactivateUrl}}

The email should:
1. Explain the account will be deactivated due to inactivity
2. Mention when it will happen
3. Explain what happens when deactivated (data preserved for 30 days)
4. Provide easy reactivation link
5. Keep it under 120 words

Return JSON:
{
  "subject": "string - warning subject",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Keep My Account Active",
    "url": "{{reactivateUrl}}"
  }
}',
    0.6,
    700,
    json_build_array('firstName', 'email', 'daysUntilDeactivation', 'reactivateUrl')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 10. Account Reactivation
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'account_reactivation',
    'transactional',
    'You are an email marketing expert who writes welcoming confirmation emails. Your goal is to celebrate the user''s return.',
    'Write an account reactivation confirmation email for:

USER: {{firstName}}
EMAIL: {{email}}
REACTIVATED AT: {{reactivatedAt}}

The email should:
1. Welcome them back warmly
2. Confirm account is fully reactivated
3. Remind them of key features
4. Keep it under 80 words

Return JSON:
{
  "subject": "string - welcoming subject",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Get Started",
    "url": "https://automatemyblog.com/dashboard"
  }
}',
    0.7,
    600,
    json_build_array('firstName', 'email', 'reactivatedAt')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- =====================================================
-- ENGAGEMENT EMAILS (2 more - 1 already exists)
-- =====================================================

-- 11. Blog Post Completion
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'blog_post_completion',
    'engagement',
    'You are an email marketing expert who writes exciting notification emails. Your goal is to celebrate the completion and get users to review their content.',
    'Write a blog post completion notification email for:

USER: {{firstName}}
POST TITLE: {{postTitle}}
POST URL: {{postUrl}}
CREATED AT: {{createdAt}}

The email should:
1. Celebrate the completion with enthusiasm
2. Mention the post title
3. Encourage them to review and publish
4. Keep it under 80 words

Return JSON:
{
  "subject": "string - exciting subject about post completion",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Review Your Post",
    "url": "{{postUrl}}"
  }
}',
    0.7,
    600,
    json_build_array('firstName', 'postTitle', 'postUrl', 'createdAt')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 12. Usage Digest
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'usage_digest',
    'engagement',
    'You are an email marketing expert who writes motivating weekly digest emails. Your goal is to show users their progress and encourage continued engagement.',
    'Write a weekly usage digest email for:

USER: {{firstName}}
WEEKLY STATS:
- Posts generated: {{weeklyStats.postsGenerated}}
- Credits remaining: {{availableCredits}}

DASHBOARD URL: {{dashboardUrl}}

The email should:
1. Celebrate their weekly activity
2. Show key metrics in a motivating way
3. Suggest next steps (generate more, upgrade if needed)
4. Keep it under 120 words

Return JSON:
{
  "subject": "string - motivating subject about their week",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body with metrics",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "View Dashboard",
    "url": "{{dashboardUrl}}"
  }
}',
    0.7,
    700,
    json_build_array('firstName', 'weeklyStats', 'availableCredits', 'dashboardUrl')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- =====================================================
-- RE-ENGAGEMENT EMAILS (2)
-- =====================================================

-- 13. 7-Day Inactive Reminder
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    '7_day_inactive_reminder',
    'reengagement',
    'You are an email marketing expert who writes friendly reminder emails. Your goal is to gently re-engage inactive users without being pushy.',
    'Write a 7-day inactive reminder email for:

USER: {{firstName}}
DAYS SINCE LAST LOGIN: {{daysSinceLastLogin}}
DASHBOARD URL: {{dashboardUrl}}

The email should:
1. Be friendly and non-judgmental
2. Remind them of what they can do with AutoBlog
3. Mention any new features or improvements
4. Keep it under 100 words

Return JSON:
{
  "subject": "string - friendly subject checking in",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Continue Creating",
    "url": "{{dashboardUrl}}"
  }
}',
    0.7,
    700,
    json_build_array('firstName', 'daysSinceLastLogin', 'dashboardUrl')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 14. 14-Day Re-engagement
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    '14_day_reengagement',
    'reengagement',
    'You are an email marketing expert who writes compelling win-back emails. Your goal is to re-engage users who have not returned in 2 weeks.',
    'Write a 14-day re-engagement email for:

USER: {{firstName}}
DAYS SINCE LAST LOGIN: {{daysSinceLastLogin}}
PLAN TIER: {{planTier}}
AVAILABLE CREDITS: {{availableCredits}}
DASHBOARD URL: {{dashboardUrl}}

The email should:
1. Acknowledge it''s been a while
2. Remind them of unused credits (if any)
3. Highlight recent platform improvements
4. Make it easy to jump back in
5. Keep it under 150 words

Return JSON:
{
  "subject": "string - compelling win-back subject",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Pick Up Where You Left Off",
    "url": "{{dashboardUrl}}"
  }
}',
    0.7,
    800,
    json_build_array('firstName', 'daysSinceLastLogin', 'planTier', 'availableCredits', 'dashboardUrl')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- =====================================================
-- LEAD NURTURING EMAILS (3 more - 1 already exists)
-- =====================================================

-- 15. Warm Lead Nurture
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'warm_lead_nurture',
    'lead_nurture',
    'You are a sales expert who writes educational, value-first emails to warm leads. Your goal is to build trust and demonstrate value.',
    'Write a warm lead nurture email for:

LEAD SCORE: {{leadScore}}/100
WEBSITE: {{websiteUrl}}
LEAD SOURCE: {{leadSource}}

The email should:
1. Reference their website/business context
2. Provide immediate value (tips, insights, case study)
3. Position AutoBlog as a solution (not a hard sell)
4. Include a soft CTA (learn more, see how it works)
5. Keep it under 150 words

Return JSON:
{
  "subject": "string - value-focused subject",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "See How It Works",
    "url": "https://automatemyblog.com/how-it-works"
  }
}',
    0.7,
    800,
    json_build_array('leadScore', 'websiteUrl', 'leadSource')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 16. Cold Lead Reactivation
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'cold_lead_reactivation',
    'lead_nurture',
    'You are a sales expert who writes re-engagement emails to cold leads. Your goal is to reignite interest with a fresh angle.',
    'Write a cold lead reactivation email for:

LEAD SCORE: {{leadScore}}/100
WEBSITE: {{websiteUrl}}
DAYS SINCE CREATED: {{daysSinceCreated}}

The email should:
1. Acknowledge it has been a while since they checked out AutoBlog
2. Share what is new or improved
3. Offer a fresh value proposition (ROI, time saved, quality)
4. Keep it brief and respect their time (under 120 words)

Return JSON:
{
  "subject": "string - fresh angle subject",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Take Another Look",
    "url": "https://automatemyblog.com/signup"
  }
}',
    0.7,
    700,
    json_build_array('leadScore', 'websiteUrl', 'daysSinceCreated')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 17. Lead Converted Celebration
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'lead_converted_celebration',
    'lead_nurture',
    'You are an email marketing expert who writes celebratory welcome emails. Your goal is to make new users feel valued and excited.',
    'Write a lead converted celebration email for:

USER: {{firstName}}
LEAD SCORE: {{leadScore}}/100
CONVERSION SOURCE: {{conversionSource}}

The email should:
1. Celebrate their decision to join
2. Acknowledge their journey (from lead to user)
3. Highlight what makes them a great fit
4. Set expectations for what comes next
5. Keep it under 120 words

Return JSON:
{
  "subject": "string - celebratory subject",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Start Creating",
    "url": "https://automatemyblog.com/dashboard"
  }
}',
    0.8,
    700,
    json_build_array('firstName', 'leadScore', 'conversionSource')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- =====================================================
-- ADMIN ALERT EMAILS (5 more - 1 already exists)
-- =====================================================

-- 18. New User Signup Alert
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'new_user_signup_alert',
    'admin',
    'You are an analytics expert who writes concise admin alert emails. Your goal is to provide key information at a glance.',
    'Write a new user signup alert email for admin:

USER: {{userId}}
NAME: {{firstName}} {{lastName}}
EMAIL: {{email}}
PLAN: {{planTier}}
BUSINESS TYPE: {{businessType}}
SIGNUP DATE: {{signupDate}}

The email should:
1. Present key user details in a scannable format
2. Include relevant business context
3. Keep it very brief (under 80 words)
4. Use bullet points or table format

Return JSON:
{
  "subject": "string - clear alert subject with user name",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body with structured data",
  "bodyPlainText": "string - plain text version",
  "cta": null
}',
    0.5,
    600,
    json_build_array('userId', 'email', 'firstName', 'lastName', 'planTier', 'businessType', 'signupDate')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 19. Suspicious Activity Alert
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'suspicious_activity_alert',
    'admin',
    'You are a security expert who writes urgent admin alert emails. Your goal is to flag suspicious activity for immediate review.',
    'Write a suspicious activity alert email for admin:

USER: {{userId}}
EMAIL: {{email}}
ACTIVITY TYPE: {{activityType}}
DETAILS: {{details}}
TIMESTAMP: {{timestamp}}

The email should:
1. Clearly flag as SECURITY ALERT
2. Describe the suspicious activity
3. Include user details for investigation
4. Keep it brief but complete (under 100 words)

Return JSON:
{
  "subject": "string - URGENT security alert subject",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": null
}',
    0.5,
    700,
    json_build_array('userId', 'email', 'activityType', 'details', 'timestamp')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 20. System Error Alert
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'system_error_alert',
    'admin',
    'You are a DevOps expert who writes actionable error alert emails. Your goal is to provide enough context for immediate debugging.',
    'Write a system error alert email for admin:

ERROR TYPE: {{errorType}}
ERROR MESSAGE: {{errorMessage}}
CONTEXT: {{errorContext}}
TIMESTAMP: {{timestamp}}
ENVIRONMENT: {{environment}}

The email should:
1. Clearly identify the error type
2. Include error message and stack trace if available
3. Provide context (what was happening)
4. Keep it structured and scannable

Return JSON:
{
  "subject": "string - ERROR alert subject with error type",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body with code formatting",
  "bodyPlainText": "string - plain text version",
  "cta": null
}',
    0.5,
    1000,
    json_build_array('errorType', 'errorMessage', 'errorContext', 'timestamp', 'environment')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 21. Monthly Revenue Summary
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'monthly_revenue_summary',
    'admin',
    'You are a business analyst who writes clear monthly summary emails. Your goal is to present key metrics in an actionable format.',
    'Write a monthly revenue summary email for admin:

MONTH: {{month}}
TOTAL REVENUE: ${{totalRevenue}}
NEW SUBSCRIPTIONS: {{newSubscriptions}}
CANCELLED SUBSCRIPTIONS: {{cancelledSubscriptions}}
ACTIVE USERS: {{activeUsers}}
CREDITS USED: {{creditsUsed}}

The email should:
1. Present metrics in a clear, visual format
2. Highlight key trends (growth, churn, usage)
3. Keep it scannable (under 150 words)
4. Use tables or bullet points

Return JSON:
{
  "subject": "string - monthly summary subject with month",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body with formatted metrics",
  "bodyPlainText": "string - plain text version",
  "cta": null
}',
    0.6,
    1000,
    json_build_array('month', 'totalRevenue', 'newSubscriptions', 'cancelledSubscriptions', 'activeUsers', 'creditsUsed')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- =====================================================
-- SUBSCRIPTION/BILLING EMAILS (4 more - 1 already exists)
-- =====================================================

-- 22. Subscription Upgraded
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'subscription_upgraded',
    'billing',
    'You are an email marketing expert who writes celebratory confirmation emails. Your goal is to congratulate users on their upgrade.',
    'Write a subscription upgraded confirmation email for:

USER: {{firstName}}
OLD PLAN: {{oldPlan}}
NEW PLAN: {{newPlan}}
UPGRADED AT: {{upgradedAt}}

The email should:
1. Congratulate them on upgrading
2. Highlight new features/limits they unlocked
3. Thank them for their continued trust
4. Keep it under 100 words

Return JSON:
{
  "subject": "string - celebratory upgrade subject",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Explore New Features",
    "url": "https://automatemyblog.com/dashboard"
  }
}',
    0.7,
    700,
    json_build_array('firstName', 'oldPlan', 'newPlan', 'upgradedAt')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 23. Subscription Cancelled
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'subscription_cancelled',
    'billing',
    'You are an email marketing expert who writes respectful cancellation emails. Your goal is to confirm the cancellation while leaving the door open.',
    'Write a subscription cancelled confirmation email for:

USER: {{firstName}}
PLAN TIER: {{planTier}}
REASON: {{reason}}
CANCELLED AT: {{cancelledAt}}

The email should:
1. Confirm the cancellation respectfully
2. Explain what happens next (access until period end, data retention)
3. Invite feedback (optional survey)
4. Leave door open for return
5. Keep it under 120 words

Return JSON:
{
  "subject": "string - respectful cancellation subject",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Share Feedback",
    "url": "https://automatemyblog.com/feedback"
  }
}',
    0.6,
    700,
    json_build_array('firstName', 'planTier', 'reason', 'cancelledAt')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 24. Payment Received
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'payment_received',
    'billing',
    'You are an email marketing expert who writes clear receipt emails. Your goal is to provide payment confirmation and receipt details.',
    'Write a payment received receipt email for:

USER: {{firstName}}
AMOUNT: ${{amount}}
INVOICE ID: {{invoiceId}}
PAID AT: {{paidAt}}
PLAN TIER: {{planTier}}

The email should:
1. Thank them for their payment
2. Include clear receipt details
3. Confirm what they received (credits, subscription period)
4. Keep it under 100 words

Return JSON:
{
  "subject": "string - clear receipt subject with amount",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body with receipt details",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "View Invoice",
    "url": "https://automatemyblog.com/billing"
  }
}',
    0.5,
    600,
    json_build_array('firstName', 'amount', 'invoiceId', 'paidAt', 'planTier')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 25. Credit Expiration Warning
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'credit_expiration_warning',
    'billing',
    'You are an email marketing expert who writes helpful reminder emails. Your goal is to inform users about expiring credits without being pushy.',
    'Write a credit expiration warning email for:

USER: {{firstName}}
EXPIRING CREDITS: {{expiringCredits}}
EXPIRATION DATE: {{expirationDate}}
DAYS UNTIL EXPIRATION: {{daysUntilExpiration}}
DASHBOARD URL: {{dashboardUrl}}

The email should:
1. Clearly state how many credits are expiring and when
2. Encourage them to use credits before expiration
3. Explain what happens when credits expire
4. Keep it under 100 words

Return JSON:
{
  "subject": "string - urgent subject about expiring credits",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Use Your Credits",
    "url": "{{dashboardUrl}}"
  }
}',
    0.6,
    700,
    json_build_array('firstName', 'expiringCredits', 'expirationDate', 'daysUntilExpiration', 'dashboardUrl')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- =====================================================
-- REFERRAL PROGRAM EMAILS (2 more - 1 already exists)
-- =====================================================

-- 26. Referral Link Share Reminder
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'referral_link_share_reminder',
    'referral',
    'You are an email marketing expert who writes motivating referral reminder emails. Your goal is to encourage sharing without being pushy.',
    'Write a referral link share reminder email for:

USER: {{firstName}}
REFERRAL CODE: {{referralCode}}
REFERRAL URL: {{referralUrl}}

The email should:
1. Remind them about the referral program
2. Highlight the mutual benefit (both get 1 free post)
3. Make sharing easy (include link prominently)
4. Keep it under 100 words

Return JSON:
{
  "subject": "string - motivating subject about sharing",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body with prominent referral link",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Share My Referral Link",
    "url": "{{referralUrl}}"
  }
}',
    0.7,
    700,
    json_build_array('firstName', 'referralCode', 'referralUrl')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- =====================================================
-- NICE-TO-HAVE EMAILS (3)
-- =====================================================

-- 27. Weekly Analytics Report
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'weekly_analytics_report',
    'engagement',
    'You are a data analyst who writes insightful analytics emails. Your goal is to provide actionable insights from user data.',
    'Write a weekly analytics report email for:

USER: {{firstName}}
WEEKLY STATS: {{weeklyStats}}
DASHBOARD URL: {{dashboardUrl}}

The email should:
1. Present key metrics visually
2. Highlight notable trends or achievements
3. Provide actionable recommendations
4. Keep it under 150 words

Return JSON:
{
  "subject": "string - insights-focused subject",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body with formatted metrics",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "View Full Report",
    "url": "{{dashboardUrl}}"
  }
}',
    0.7,
    900,
    json_build_array('firstName', 'weeklyStats', 'dashboardUrl')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 28. Content Performance Insights
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'content_performance_insights',
    'engagement',
    'You are a content strategist who writes insightful performance emails. Your goal is to help users improve their content strategy.',
    'Write a content performance insights email for:

USER: {{firstName}}
PERFORMANCE DATA: {{performanceData}}
DASHBOARD URL: {{dashboardUrl}}

The email should:
1. Highlight top-performing content
2. Provide insights on why it performed well
3. Suggest improvements for future content
4. Keep it under 150 words

Return JSON:
{
  "subject": "string - insights-focused subject",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "See Full Analysis",
    "url": "{{dashboardUrl}}"
  }
}',
    0.7,
    900,
    json_build_array('firstName', 'performanceData', 'dashboardUrl')::jsonb
)
ON CONFLICT (email_type) DO NOTHING;

-- 29. Feature Announcement
INSERT INTO email_templates (email_type, category, system_prompt, user_prompt_template, temperature, max_tokens, required_context_fields)
VALUES (
    'feature_announcement',
    'engagement',
    'You are a product marketer who writes exciting announcement emails. Your goal is to generate enthusiasm about new features.',
    'Write a feature announcement email for:

USER: {{firstName}}
FEATURE NAME: {{featureName}}
FEATURE DESCRIPTION: {{featureDescription}}
DASHBOARD URL: {{dashboardUrl}}

The email should:
1. Build excitement about the new feature
2. Explain what it does and why it matters
3. Encourage them to try it
4. Keep it under 120 words

Return JSON:
{
  "subject": "string - exciting subject about new feature",
  "preheader": "string - preview text",
  "bodyHtml": "string - HTML email body",
  "bodyPlainText": "string - plain text version",
  "cta": {
    "text": "Try It Now",
    "url": "{{dashboardUrl}}"
  }
}',
    0.8,
    800,
    json_build_array('firstName', 'featureName', 'featureDescription', 'dashboardUrl')::jsonb
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

    RAISE NOTICE '✅ Migration 21: Additional Email Templates completed';
    RAISE NOTICE '📧 Total active email templates: %', template_count;
    RAISE NOTICE '🎯 Expected: 34 templates (5 from Migration 20 + 29 from Migration 21)';

    IF template_count >= 34 THEN
        RAISE NOTICE '✅ All 34 email templates are seeded!';
    ELSE
        RAISE NOTICE '⚠️  Only % templates found (expected 34)', template_count;
    END IF;
END $$;
