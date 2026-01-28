/**
 * Email System Test Script
 *
 * This script demonstrates how to test the email system using the test endpoints.
 *
 * Usage:
 * 1. Ensure EMAIL_TEST_MODE=true in .env to prevent actual sending
 * 2. Start the server: npm start
 * 3. Run this script: node test-email.js
 *
 * Or use curl commands directly (see examples below)
 */

const API_BASE = 'http://localhost:3001/api/v1/email/test';

console.log(`
╔════════════════════════════════════════════════════════════════╗
║          AutoBlog Email System - Test Guide                    ║
╚════════════════════════════════════════════════════════════════╝

📧 EMAIL TEST ENDPOINTS

1. List All Email Templates
   GET ${API_BASE}/templates

   Example:
   curl ${API_BASE}/templates

2. Get Example Context for Email Type
   GET ${API_BASE}/example/:emailType

   Example:
   curl ${API_BASE}/example/welcome_email

3. Quick Preview (uses example context)
   POST ${API_BASE}/quick/:emailType

   Example:
   curl -X POST ${API_BASE}/quick/welcome_email

4. Preview Email with Custom Context
   POST ${API_BASE}/preview
   Body: { emailType, context }

   Example:
   curl -X POST ${API_BASE}/preview \\
     -H "Content-Type: application/json" \\
     -d '{
       "emailType": "referral_invitation",
       "context": {
         "inviterName": "John Smith",
         "inviterEmail": "john@example.com",
         "email": "friend@example.com",
         "inviteCode": "ABC123",
         "inviteUrl": "https://automatemyblog.com/signup?invite=ABC123"
       }
     }'

5. Send Test Email
   POST ${API_BASE}/send
   Body: { emailType, recipientEmail, context, userId? }

   Example:
   curl -X POST ${API_BASE}/send \\
     -H "Content-Type: application/json" \\
     -d '{
       "emailType": "welcome_email",
       "recipientEmail": "test@example.com",
       "context": {
         "firstName": "Test",
         "lastName": "User",
         "email": "test@example.com",
         "planTier": "starter",
         "businessType": "SaaS"
       }
     }'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 AVAILABLE EMAIL TYPES (34 total)

TRANSACTIONAL (8):
  - referral_invitation
  - organization_member_invitation
  - welcome_email
  - email_verification
  - password_reset
  - password_change_confirmation
  - account_deactivation_warning
  - account_reactivation

ENGAGEMENT (3):
  - blog_post_completion
  - low_credit_warning
  - usage_digest

RE-ENGAGEMENT (2):
  - 7_day_inactive_reminder
  - 14_day_reengagement

LEAD NURTURING (4):
  - high_lead_score_followup
  - warm_lead_nurture
  - cold_lead_reactivation
  - lead_converted_celebration

ADMIN ALERTS (6):
  - new_user_signup_alert
  - payment_failed_alert
  - suspicious_activity_alert
  - high_value_lead_notification
  - system_error_alert
  - monthly_revenue_summary

SUBSCRIPTION/BILLING (5):
  - subscription_confirmation
  - subscription_upgraded
  - subscription_cancelled
  - payment_received
  - credit_expiration_warning

REFERRAL PROGRAM (3):
  - referral_accepted_notification
  - referral_reward_granted
  - referral_link_share_reminder

NICE-TO-HAVE (3):
  - weekly_analytics_report
  - content_performance_insights
  - feature_announcement

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚙️  ENVIRONMENT VARIABLES REQUIRED

Add these to your .env file:

# SendGrid Configuration
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxx
SENDGRID_FROM_EMAIL=noreply@automatemyblog.com
SENDGRID_FROM_NAME=AutoBlog
SENDGRID_REPLY_TO_EMAIL=support@automatemyblog.com

# Email Configuration
EMAIL_TEST_MODE=true  # Set to false to actually send emails
EMAIL_WHITELIST=your-email@example.com,another@example.com

# Admin Email
ADMIN_EMAIL=admin@automatemyblog.com

# Frontend URL
FRONTEND_URL=https://automatemyblog.com

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🧪 TESTING WORKFLOW

1. Start in TEST MODE:
   - Set EMAIL_TEST_MODE=true in .env
   - Emails will not be sent, only logged to console

2. Preview emails:
   - Use /quick/:emailType for rapid testing with example data
   - Use /preview with custom context for specific scenarios

3. Test with whitelist:
   - Set EMAIL_TEST_MODE=false
   - Add EMAIL_WHITELIST=your-email@example.com
   - Use /send endpoint to actually send to whitelisted emails

4. Production:
   - Set EMAIL_TEST_MODE=false
   - Remove EMAIL_WHITELIST (or keep for safety)
   - Emails will be sent to all recipients

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ QUICK START COMMANDS

# 1. List all available email templates
curl ${API_BASE}/templates | jq

# 2. Preview welcome email (quick test)
curl -X POST ${API_BASE}/quick/welcome_email | jq

# 3. Preview referral invitation (quick test)
curl -X POST ${API_BASE}/quick/referral_invitation | jq

# 4. Preview low credit warning (quick test)
curl -X POST ${API_BASE}/quick/low_credit_warning | jq

# 5. Get example context for subscription confirmation
curl ${API_BASE}/example/subscription_confirmation | jq

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 EMAIL LOGGING

All sent emails are logged to the email_logs table:
- user_id: Associated user (if applicable)
- email_type: Type of email sent
- recipient_email: Recipient address
- status: sent, delivered, opened, clicked, bounced, failed
- context_data: Full context used for generation (JSONB)
- generated_content: LLM output (JSONB)
- sendgrid_message_id: SendGrid message ID for tracking

Query email logs:
SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 10;

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 NEXT STEPS

Week 1 - Foundation (CURRENT):
  ✅ Database setup (3 tables + columns)
  ✅ SendGrid package installation
  ✅ emailContentGenerator.js service
  ✅ email.js main service
  ✅ Test endpoints

Week 2 - Transactional & Engagement:
  - Replace TODO comments in referrals.js (lines 96, 168)
  - Add billing & subscription emails (Stripe webhooks)
  - Add credit & engagement emails
  - Testing & QA

Week 3 - Re-engagement & Lead Nurture:
  - Re-engagement campaigns (7-day, 14-day inactive)
  - Lead nurture system (high/warm/cold leads)
  - Scheduled job setup

Week 4 - Admin & Nice-to-Have:
  - Admin alerts
  - Weekly reports
  - Email preferences & unsubscribe
  - Final testing & launch

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For more information, see:
- /services/email.js - Main email service (all 34 methods)
- /services/emailContentGenerator.js - LLM content generation
- /routes/email-test.js - Test endpoints
- /database/20_email_system.sql - Database schema

`);
