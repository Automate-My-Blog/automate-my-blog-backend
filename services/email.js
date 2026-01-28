import sendgrid from '@sendgrid/mail';
import db from './database.js';
import emailContentGenerator from './emailContentGenerator.js';

// Initialize SendGrid with API key
sendgrid.setApiKey(process.env.SENDGRID_API_KEY);

class EmailService {
  constructor() {
    this.fromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@automatemyblog.com';
    this.fromName = process.env.SENDGRID_FROM_NAME || 'AutoBlog';
    this.replyToEmail = process.env.SENDGRID_REPLY_TO_EMAIL || 'support@automatemyblog.com';
    this.testMode = process.env.EMAIL_TEST_MODE === 'true';
    this.emailWhitelist = process.env.EMAIL_WHITELIST?.split(',') || [];
  }

  // =====================================================
  // CORE SENDING METHOD
  // =====================================================

  /**
   * Send email with LLM-generated content
   * @param {string} emailType - Type of email from email_templates
   * @param {string} recipientEmail - Recipient email address
   * @param {object} context - Context data for LLM generation
   * @param {string} userId - Optional user ID for logging
   * @returns {Promise<object>} Send result
   */
  async send(emailType, recipientEmail, context, userId = null) {
    try {
      console.log(`📧 Preparing email: ${emailType} to ${recipientEmail}`);

      // 1. Check if user has unsubscribed from this email type
      if (userId) {
        const isUnsubscribed = await this.checkUnsubscribed(userId, emailType);
        if (isUnsubscribed) {
          console.log(`⛔ User ${userId} unsubscribed from ${emailType}`);
          return { skipped: true, reason: 'unsubscribed' };
        }
      }

      // 2. Test mode / whitelist check (non-production)
      if (this.testMode) {
        console.log('🧪 TEST MODE: Email would be sent');
        console.log('  Type:', emailType);
        console.log('  Recipient:', recipientEmail);
        console.log('  Context:', JSON.stringify(context, null, 2));
        return { success: true, testMode: true };
      }

      if (process.env.NODE_ENV !== 'production' && this.emailWhitelist.length > 0) {
        if (!this.emailWhitelist.includes(recipientEmail)) {
          console.log(`⚠️ Email not in whitelist: ${recipientEmail}`);
          return { skipped: true, reason: 'not_whitelisted' };
        }
      }

      // 3. Generate email content using LLM
      const generatedContent = await emailContentGenerator.generate(emailType, context);

      // 4. Wrap content in HTML email template
      const htmlBody = this.wrapInEmailTemplate(generatedContent.bodyHtml, generatedContent.cta);

      // 5. Generate dynamic sender name (improves open rates)
      const dynamicFromName = this.generateDynamicSenderName(context);

      // 6. Prepare SendGrid message
      console.log('📧 SendGrid message config:', {
        to: recipientEmail,
        from: this.fromEmail,
        fromName: dynamicFromName,
        subjectLength: generatedContent.subject?.length,
        hasHtml: !!htmlBody,
        hasText: !!generatedContent.bodyPlainText
      });

      const message = {
        to: recipientEmail,
        from: {
          email: this.fromEmail,
          name: "Automate My Blog"
        },
        subject: generatedContent.subject,
        text: generatedContent.bodyPlainText,
        html: htmlBody
      };

      // 7. Send via SendGrid with retry logic
      const result = await this.sendWithRetry(message);

      // 8. Log email to database
      await this.logEmail({
        userId,
        emailType,
        recipientEmail,
        subject: generatedContent.subject,
        sendgridMessageId: result.messageId,
        status: 'sent',
        contextData: context,
        generatedContent,
        sentAt: new Date()
      });

      // 8. Update user email stats
      if (userId) {
        await this.updateUserEmailStats(userId);
      }

      console.log(`✅ Email sent: ${emailType} to ${recipientEmail}`);
      return { success: true, messageId: result.messageId };

    } catch (error) {
      console.error(`❌ Email send failed: ${emailType}`, error);

      // Log failed email
      await this.logEmail({
        userId,
        emailType,
        recipientEmail,
        status: 'failed',
        contextData: context,
        errorMessage: error.message
      });

      throw error;
    }
  }

  /**
   * Send email with exponential backoff retry logic
   * @param {object} message - SendGrid message object
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<object>} SendGrid response
   */
  async sendWithRetry(message, maxRetries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const [response] = await sendgrid.send(message);
        return {
          messageId: response.headers['x-message-id'],
          statusCode: response.statusCode
        };
      } catch (error) {
        lastError = error;
        console.error(`❌ SendGrid attempt ${attempt}/${maxRetries} failed:`, error.message);
        console.error(`❌ SendGrid error details:`, JSON.stringify({
          code: error.code,
          statusCode: error.response?.statusCode,
          body: error.response?.body
        }, null, 2));

        if (attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`⏳ Retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    throw new Error(`SendGrid failed after ${maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Generate dynamic sender name based on user context
   * Examples: "TechCorp Blog Assistant", "Acme Inc Blog Assistant"
   * Falls back to default "Automate My Blog" if no business name available
   * @param {object} context - Email context data
   * @returns {string} Sender name
   */
  generateDynamicSenderName(context) {
    // Priority order: businessName > organizationName > companyName > default
    const businessName = context.businessName ||
                        context.organizationName ||
                        context.companyName ||
                        context.businessType;

    if (businessName && businessName !== 'undefined') {
      // Clean the name (remove extra spaces, capitalize properly)
      const cleanName = businessName.trim();

      // If it already contains "Blog" or "Assistant", use as-is
      if (cleanName.toLowerCase().includes('blog') ||
          cleanName.toLowerCase().includes('assistant')) {
        return cleanName;
      }

      // Otherwise, append "Blog Assistant"
      return `${cleanName} Blog Assistant`;
    }

    // Default fallback
    return this.fromName;
  }

  /**
   * Wrap email body in HTML template
   * @param {string} bodyHtml - Email body HTML
   * @param {object} cta - Call-to-action button {text, url}
   * @returns {string} Complete HTML email
   */
  wrapInEmailTemplate(bodyHtml, cta = null) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Message</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #ffffff;
    }
    .email-body {
      font-size: 15px;
    }
    .cta-button {
      display: inline-block;
      background-color: #2563eb;
      color: white !important;
      padding: 10px 24px;
      text-decoration: none;
      border-radius: 6px;
      margin: 16px 0;
      font-weight: 500;
    }
    .signature {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      font-size: 13px;
      color: #6b7280;
    }
    a {
      color: #2563eb;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="email-body">
    ${bodyHtml}
    ${cta ? `
    <div style="margin: 20px 0;">
      <a href="${cta.url}" class="cta-button">${cta.text}</a>
    </div>
    ` : ''}
    <div class="signature">
      <p style="margin: 4px 0; color: #9ca3af; font-size: 12px;">
        <a href="${process.env.FRONTEND_URL}/preferences" style="color: #9ca3af;">Email Preferences</a> ·
        <a href="${process.env.FRONTEND_URL}/unsubscribe" style="color: #9ca3af;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  // =====================================================
  // HELPER METHODS
  // =====================================================

  /**
   * Check if user has unsubscribed from email type
   * @param {string} userId - User ID
   * @param {string} emailType - Email type to check
   * @returns {Promise<boolean>} True if unsubscribed
   */
  async checkUnsubscribed(userId, emailType) {
    const result = await db.query(`
      SELECT unsubscribed_from FROM users WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) return false;

    const unsubscribedFrom = result.rows[0].unsubscribed_from || [];
    return unsubscribedFrom.includes(emailType);
  }

  /**
   * Log email to database
   * @param {object} logData - Email log data
   */
  async logEmail(logData) {
    try {
      await db.query(`
        INSERT INTO email_logs (
          user_id, email_type, recipient_email, subject,
          sendgrid_message_id, status, context_data,
          generated_content, error_message, sent_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        logData.userId || null,
        logData.emailType,
        logData.recipientEmail,
        logData.subject || null,
        logData.sendgridMessageId || null,
        logData.status,
        JSON.stringify(logData.contextData || {}),
        JSON.stringify(logData.generatedContent || {}),
        logData.errorMessage || null,
        logData.sentAt || null
      ]);
    } catch (error) {
      console.error('❌ Failed to log email:', error);
    }
  }

  /**
   * Update user email stats
   * @param {string} userId - User ID
   */
  async updateUserEmailStats(userId) {
    try {
      await db.query(`
        UPDATE users
        SET last_email_sent_at = NOW(),
            total_emails_sent = total_emails_sent + 1
        WHERE id = $1
      `, [userId]);
    } catch (error) {
      console.error('❌ Failed to update user email stats:', error);
    }
  }

  /**
   * Fetch user context for email generation
   * @param {string} userId - User ID
   * @returns {Promise<object>} User context
   */
  async getUserContext(userId) {
    const result = await db.query(`
      SELECT
        u.id, u.email, u.first_name, u.last_name, u.plan_tier,
        u.created_at, u.last_login_at, u.timezone, u.language,
        COALESCE(SUM(CASE WHEN uc.status = 'active' THEN 1 ELSE 0 END), 0) as available_credits
      FROM users u
      LEFT JOIN user_credits uc ON u.id = uc.user_id AND uc.status = 'active'
      WHERE u.id = $1
      GROUP BY u.id, u.email, u.first_name, u.last_name, u.plan_tier,
               u.created_at, u.last_login_at, u.timezone, u.language
    `, [userId]);

    if (result.rows.length === 0) {
      throw new Error(`User not found: ${userId}`);
    }

    const user = result.rows[0];

    return {
      userId: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      planTier: user.plan_tier || 'free',
      availableCredits: parseInt(user.available_credits) || 0,
      timezone: user.timezone || 'America/New_York',
      language: user.language || 'en',
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at
    };
  }

  /**
   * Fetch lead context for email generation
   * @param {string} leadId - Lead ID
   * @returns {Promise<object>} Lead context
   */
  async getLeadContext(leadId) {
    const result = await db.query(`
      SELECT *
      FROM website_leads
      WHERE id = $1
    `, [leadId]);

    if (result.rows.length === 0) {
      throw new Error(`Lead not found: ${leadId}`);
    }

    const lead = result.rows[0];

    return {
      leadId: lead.id,
      email: lead.email || lead.contact_email || 'lead@example.com',
      websiteUrl: lead.website_url || lead.url || 'https://example.com',
      leadSource: lead.lead_source || lead.source || 'website',
      leadScore: lead.lead_score || 75,
      industryFitScore: lead.industry_fit_score || 80,
      urgencyScore: lead.urgency_score || 70,
      companySizeScore: lead.company_size_score || 65,
      engagementScore: lead.engagement_score || 50,
      estimatedCompanySize: lead.estimated_company_size || '50-200 employees',
      createdAt: lead.created_at
    };
  }

  /**
   * Fetch weekly usage stats for user
   * @param {string} userId - User ID
   * @returns {Promise<object>} Weekly stats
   */
  async getWeeklyStats(userId) {
    const result = await db.query(`
      SELECT
        COUNT(*) as posts_generated,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_posts
      FROM blog_posts
      WHERE user_id = $1
        AND created_at >= NOW() - INTERVAL '7 days'
    `, [userId]);

    return {
      postsGenerated: parseInt(result.rows[0]?.posts_generated || 0),
      completedPosts: parseInt(result.rows[0]?.completed_posts || 0)
    };
  }

  // =====================================================
  // TRANSACTIONAL EMAILS (8)
  // =====================================================

  /**
   * Send referral invitation email
   * @param {string} inviterUserId - Inviter user ID
   * @param {string} recipientEmail - Recipient email
   * @param {string} inviteCode - Invite code
   * @returns {Promise<object>} Send result
   */
  async sendReferralInvitation(inviterUserId, recipientEmail, inviteCode) {
    const inviter = await this.getUserContext(inviterUserId);
    const inviteUrl = `${process.env.FRONTEND_URL}/signup?invite=${inviteCode}`;

    const context = {
      inviterName: `${inviter.firstName} ${inviter.lastName}`.trim() || inviter.email,
      inviterEmail: inviter.email,
      email: recipientEmail,
      inviteCode,
      inviteUrl
    };

    return this.send('referral_invitation', recipientEmail, context, inviterUserId);
  }

  /**
   * Send organization member invitation email
   * @param {string} inviterUserId - Inviter user ID
   * @param {string} recipientEmail - Recipient email
   * @param {string} organizationName - Organization name
   * @param {string} inviteCode - Invite code
   * @returns {Promise<object>} Send result
   */
  async sendOrganizationMemberInvitation(inviterUserId, recipientEmail, organizationName, inviteCode) {
    const inviter = await this.getUserContext(inviterUserId);
    const inviteUrl = `${process.env.FRONTEND_URL}/invite/org/${inviteCode}`;

    const context = {
      inviterName: `${inviter.firstName} ${inviter.lastName}`.trim() || inviter.email,
      organizationName,
      email: recipientEmail,
      inviteCode,
      inviteUrl
    };

    return this.send('organization_member_invitation', recipientEmail, context, inviterUserId);
  }

  /**
   * Send welcome email to new user
   * @param {string} userId - User ID
   * @returns {Promise<object>} Send result
   */
  async sendWelcomeEmail(userId) {
    const user = await this.getUserContext(userId);

    const context = {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      planTier: user.planTier,
      businessType: user.businessType || 'your business'
    };

    return this.send('welcome_email', user.email, context, userId);
  }

  /**
   * Send email verification
   * @param {string} userId - User ID
   * @param {string} verificationToken - Verification token
   * @returns {Promise<object>} Send result
   */
  async sendEmailVerification(userId, verificationToken) {
    const user = await this.getUserContext(userId);
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    const context = {
      firstName: user.firstName,
      email: user.email,
      verificationUrl
    };

    return this.send('email_verification', user.email, context, userId);
  }

  /**
   * Send password reset email
   * @param {string} email - User email
   * @param {string} resetToken - Password reset token
   * @returns {Promise<object>} Send result
   */
  async sendPasswordReset(email, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    const context = {
      email,
      resetUrl,
      expiresIn: '1 hour'
    };

    return this.send('password_reset', email, context);
  }

  /**
   * Send password change confirmation
   * @param {string} userId - User ID
   * @returns {Promise<object>} Send result
   */
  async sendPasswordChangeConfirmation(userId) {
    const user = await this.getUserContext(userId);

    const context = {
      firstName: user.firstName,
      email: user.email,
      changedAt: new Date().toISOString()
    };

    return this.send('password_change_confirmation', user.email, context, userId);
  }

  /**
   * Send account deactivation warning
   * @param {string} userId - User ID
   * @param {number} daysUntilDeactivation - Days until deactivation
   * @returns {Promise<object>} Send result
   */
  async sendAccountDeactivationWarning(userId, daysUntilDeactivation = 7) {
    const user = await this.getUserContext(userId);

    const context = {
      firstName: user.firstName,
      email: user.email,
      daysUntilDeactivation,
      reactivateUrl: `${process.env.FRONTEND_URL}/dashboard`
    };

    return this.send('account_deactivation_warning', user.email, context, userId);
  }

  /**
   * Send account reactivation confirmation
   * @param {string} userId - User ID
   * @returns {Promise<object>} Send result
   */
  async sendAccountReactivation(userId) {
    const user = await this.getUserContext(userId);

    const context = {
      firstName: user.firstName,
      email: user.email,
      reactivatedAt: new Date().toISOString()
    };

    return this.send('account_reactivation', user.email, context, userId);
  }

  // =====================================================
  // ENGAGEMENT EMAILS (3)
  // =====================================================

  /**
   * Send blog post completion notification
   * @param {string} userId - User ID
   * @param {string} postId - Blog post ID
   * @returns {Promise<object>} Send result
   */
  async sendBlogPostCompletion(userId, postId) {
    const user = await this.getUserContext(userId);

    const postResult = await db.query(`
      SELECT title, created_at
      FROM blog_posts
      WHERE id = $1
    `, [postId]);

    const post = postResult.rows[0];
    const postUrl = `${process.env.FRONTEND_URL}/posts/${postId}`;

    const context = {
      firstName: user.firstName,
      postTitle: post.title,
      postUrl,
      createdAt: post.created_at
    };

    return this.send('blog_post_completion', user.email, context, userId);
  }

  /**
   * Send low credit warning
   * @param {string} userId - User ID
   * @returns {Promise<object>} Send result
   */
  async sendLowCreditWarning(userId) {
    const user = await this.getUserContext(userId);
    const weeklyStats = await this.getWeeklyStats(userId);
    const upgradeUrl = `${process.env.FRONTEND_URL}/pricing`;

    const context = {
      firstName: user.firstName,
      lastName: user.lastName,
      planTier: user.planTier,
      availableCredits: user.availableCredits,
      businessType: user.businessType || 'your business',
      weeklyStats,
      upgradeUrl
    };

    return this.send('low_credit_warning', user.email, context, userId);
  }

  /**
   * Send weekly usage digest
   * @param {string} userId - User ID
   * @returns {Promise<object>} Send result
   */
  async sendUsageDigest(userId) {
    const user = await this.getUserContext(userId);
    const weeklyStats = await this.getWeeklyStats(userId);

    const context = {
      firstName: user.firstName,
      weeklyStats,
      availableCredits: user.availableCredits,
      dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`
    };

    return this.send('usage_digest', user.email, context, userId);
  }

  // =====================================================
  // RE-ENGAGEMENT EMAILS (2)
  // =====================================================

  /**
   * Send 7-day inactive reminder
   * @param {string} userId - User ID
   * @returns {Promise<object>} Send result
   */
  async send7DayInactiveReminder(userId) {
    const user = await this.getUserContext(userId);

    const context = {
      firstName: user.firstName,
      daysSinceLastLogin: 7,
      dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`
    };

    return this.send('7_day_inactive_reminder', user.email, context, userId);
  }

  /**
   * Send 14-day re-engagement email
   * @param {string} userId - User ID
   * @returns {Promise<object>} Send result
   */
  async send14DayReengagement(userId) {
    const user = await this.getUserContext(userId);

    const context = {
      firstName: user.firstName,
      daysSinceLastLogin: 14,
      planTier: user.planTier,
      availableCredits: user.availableCredits,
      dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`
    };

    return this.send('14_day_reengagement', user.email, context, userId);
  }

  // =====================================================
  // LEAD NURTURING EMAILS (4)
  // =====================================================

  /**
   * Send high lead score follow-up
   * @param {string} leadId - Lead ID
   * @returns {Promise<object>} Send result
   */
  async sendHighLeadScoreFollowup(leadId) {
    const lead = await this.getLeadContext(leadId);

    const context = {
      leadScore: lead.leadScore,
      estimatedCompanySize: lead.estimatedCompanySize,
      industryFitScore: lead.industryFitScore,
      urgencyScore: lead.urgencyScore,
      leadSource: lead.leadSource,
      websiteUrl: lead.websiteUrl
    };

    return this.send('high_lead_score_followup', lead.email, context);
  }

  /**
   * Send warm lead nurture email
   * @param {string} leadId - Lead ID
   * @returns {Promise<object>} Send result
   */
  async sendWarmLeadNurture(leadId) {
    const lead = await this.getLeadContext(leadId);

    const context = {
      leadScore: lead.leadScore,
      websiteUrl: lead.websiteUrl,
      leadSource: lead.leadSource
    };

    return this.send('warm_lead_nurture', lead.email, context);
  }

  /**
   * Send cold lead reactivation email
   * @param {string} leadId - Lead ID
   * @returns {Promise<object>} Send result
   */
  async sendColdLeadReactivation(leadId) {
    const lead = await this.getLeadContext(leadId);

    const context = {
      leadScore: lead.leadScore,
      websiteUrl: lead.websiteUrl,
      daysSinceCreated: Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    };

    return this.send('cold_lead_reactivation', lead.email, context);
  }

  /**
   * Send lead converted celebration
   * @param {string} userId - New user ID (converted lead)
   * @param {string} leadId - Original lead ID
   * @returns {Promise<object>} Send result
   */
  async sendLeadConvertedCelebration(userId, leadId) {
    const user = await this.getUserContext(userId);
    const lead = await this.getLeadContext(leadId);

    const context = {
      firstName: user.firstName,
      leadScore: lead.leadScore,
      conversionSource: lead.leadSource
    };

    return this.send('lead_converted_celebration', user.email, context, userId);
  }

  // =====================================================
  // ADMIN ALERTS (6)
  // =====================================================

  /**
   * Send new lead alert to admin
   * @param {object} leadData - Lead data
   * @returns {Promise<object>} Send result
   */
  async sendNewLeadAlert(leadData) {
    const adminEmail = process.env.ADMIN_EMAIL || 'james@frankel.tv';

    const context = {
      leadId: leadData.leadId,
      websiteUrl: leadData.websiteUrl,
      businessName: leadData.businessName,
      businessType: leadData.businessType,
      leadScore: leadData.leadScore,
      leadSource: leadData.leadSource,
      timestamp: new Date().toISOString()
    };

    return this.send('new_lead_alert', adminEmail, context);
  }

  /**
   * Send lead preview activity alert to admin
   * @param {object} previewData - Preview activity data
   * @returns {Promise<object>} Send result
   */
  async sendLeadPreviewAlert(previewData) {
    const adminEmail = process.env.ADMIN_EMAIL || 'james@frankel.tv';

    const context = {
      websiteUrl: previewData.websiteUrl,
      businessName: previewData.businessName,
      topic: previewData.topic,
      timestamp: new Date().toISOString()
    };

    return this.send('lead_preview_alert', adminEmail, context);
  }

  /**
   * Send new user signup alert to admin
   * @param {string} userId - New user ID
   * @returns {Promise<object>} Send result
   */
  async sendNewUserSignupAlert(userId) {
    const adminEmail = process.env.ADMIN_EMAIL || 'james@frankel.tv';
    const user = await this.getUserContext(userId);

    const context = {
      userId: user.userId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      planTier: user.planTier,
      signupDate: user.createdAt
    };

    return this.send('new_user_signup_alert', adminEmail, context);
  }

  /**
   * Send payment failed alert to admin
   * @param {string} userId - User ID
   * @param {string} invoiceId - Stripe invoice ID
   * @param {number} amount - Failed amount
   * @returns {Promise<object>} Send result
   */
  async sendPaymentFailedAlert(userId, invoiceId, amount) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@automatemyblog.com';
    const user = await this.getUserContext(userId);

    const context = {
      userId: user.userId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      invoiceId,
      amount,
      planTier: user.planTier
    };

    return this.send('payment_failed_alert', adminEmail, context);
  }

  /**
   * Send suspicious activity alert to admin
   * @param {string} userId - User ID
   * @param {string} activityType - Type of suspicious activity
   * @param {object} details - Activity details
   * @returns {Promise<object>} Send result
   */
  async sendSuspiciousActivityAlert(userId, activityType, details) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@automatemyblog.com';
    const user = await this.getUserContext(userId);

    const context = {
      userId: user.userId,
      email: user.email,
      activityType,
      details: JSON.stringify(details, null, 2),
      timestamp: new Date().toISOString()
    };

    return this.send('suspicious_activity_alert', adminEmail, context);
  }

  /**
   * Send high value lead notification to admin
   * @param {string} leadId - Lead ID
   * @returns {Promise<object>} Send result
   */
  async sendHighValueLeadNotification(leadId) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@automatemyblog.com';
    const lead = await this.getLeadContext(leadId);

    const context = {
      leadId: lead.leadId,
      email: lead.email,
      websiteUrl: lead.websiteUrl,
      leadScore: lead.leadScore,
      industryFitScore: lead.industryFitScore,
      urgencyScore: lead.urgencyScore,
      estimatedCompanySize: lead.estimatedCompanySize,
      leadSource: lead.leadSource
    };

    return this.send('high_value_lead_notification', adminEmail, context);
  }

  /**
   * Send system error alert to admin
   * @param {string} errorType - Type of error
   * @param {string} errorMessage - Error message
   * @param {object} context - Error context
   * @returns {Promise<object>} Send result
   */
  async sendSystemErrorAlert(errorType, errorMessage, context = {}) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@automatemyblog.com';

    const emailContext = {
      errorType,
      errorMessage,
      errorContext: JSON.stringify(context, null, 2),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    };

    return this.send('system_error_alert', adminEmail, emailContext);
  }

  /**
   * Send monthly revenue summary to admin
   * @param {object} revenueData - Revenue data
   * @returns {Promise<object>} Send result
   */
  async sendMonthlyRevenueSummary(revenueData = {}) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@automatemyblog.com';

    const context = {
      month: revenueData.month || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      totalRevenue: revenueData.totalRevenue || 0,
      newSubscriptions: revenueData.newSubscriptions || 0,
      cancelledSubscriptions: revenueData.cancelledSubscriptions || 0,
      activeUsers: revenueData.activeUsers || 0,
      creditsUsed: revenueData.creditsUsed || 0
    };

    return this.send('monthly_revenue_summary', adminEmail, context);
  }

  // =====================================================
  // SUBSCRIPTION/BILLING EMAILS (5)
  // =====================================================

  /**
   * Send subscription confirmation
   * @param {string} userId - User ID
   * @param {string} subscriptionId - Stripe subscription ID
   * @returns {Promise<object>} Send result
   */
  async sendSubscriptionConfirmation(userId, subscriptionId) {
    const user = await this.getUserContext(userId);

    // Use plan tier data as fallback
    const planAmounts = {
      creator: 29,
      professional: 99,
      enterprise: 299
    };

    const planCredits = {
      creator: 10,
      professional: 30,
      enterprise: 100
    };

    const context = {
      firstName: user.firstName,
      lastName: user.lastName,
      subscription: {
        plan_name: user.planTier || 'professional',
        amount: planAmounts[user.planTier] || 99,
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        credits_included: planCredits[user.planTier] || 30
      }
    };

    return this.send('subscription_confirmation', user.email, context, userId);
  }

  /**
   * Send subscription upgraded notification
   * @param {string} userId - User ID
   * @param {string} oldPlan - Old plan name
   * @param {string} newPlan - New plan name
   * @returns {Promise<object>} Send result
   */
  async sendSubscriptionUpgraded(userId, oldPlan, newPlan) {
    const user = await this.getUserContext(userId);

    const context = {
      firstName: user.firstName,
      oldPlan,
      newPlan,
      upgradedAt: new Date().toISOString()
    };

    return this.send('subscription_upgraded', user.email, context, userId);
  }

  /**
   * Send subscription cancelled notification
   * @param {string} userId - User ID
   * @param {string} reason - Cancellation reason
   * @returns {Promise<object>} Send result
   */
  async sendSubscriptionCancelled(userId, reason = 'user_cancelled') {
    const user = await this.getUserContext(userId);

    const context = {
      firstName: user.firstName,
      planTier: user.planTier,
      reason,
      cancelledAt: new Date().toISOString()
    };

    return this.send('subscription_cancelled', user.email, context, userId);
  }

  /**
   * Send payment received confirmation
   * @param {string} userId - User ID
   * @param {number} amount - Payment amount
   * @param {string} invoiceId - Invoice ID
   * @returns {Promise<object>} Send result
   */
  async sendPaymentReceived(userId, amount, invoiceId) {
    const user = await this.getUserContext(userId);

    const context = {
      firstName: user.firstName,
      amount,
      invoiceId,
      paidAt: new Date().toISOString(),
      planTier: user.planTier
    };

    return this.send('payment_received', user.email, context, userId);
  }

  /**
   * Send credit expiration warning
   * @param {string} userId - User ID
   * @param {number} expiringCredits - Number of expiring credits
   * @param {Date} expirationDate - Expiration date
   * @returns {Promise<object>} Send result
   */
  async sendCreditExpirationWarning(userId, expiringCredits = 5, expirationDate = null) {
    const user = await this.getUserContext(userId);

    if (!expirationDate) {
      expirationDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    }

    const daysUntilExpiration = Math.ceil((expirationDate - Date.now()) / (1000 * 60 * 60 * 24));

    const context = {
      firstName: user.firstName,
      expiringCredits,
      expirationDate: expirationDate.toISOString(),
      daysUntilExpiration,
      dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`
    };

    return this.send('credit_expiration_warning', user.email, context, userId);
  }

  // =====================================================
  // REFERRAL PROGRAM EMAILS (3)
  // =====================================================

  /**
   * Send referral accepted notification to referrer
   * @param {string} referrerUserId - Referrer user ID
   * @param {string} referredEmail - Referred user email
   * @returns {Promise<object>} Send result
   */
  async sendReferralAcceptedNotification(referrerUserId, referredEmail) {
    const referrer = await this.getUserContext(referrerUserId);

    const context = {
      firstName: referrer.firstName,
      referredEmail,
      acceptedAt: new Date().toISOString()
    };

    return this.send('referral_accepted_notification', referrer.email, context, referrerUserId);
  }

  /**
   * Send referral reward granted notification
   * @param {string} userId - User ID
   * @param {string} rewardType - Type of reward (free_generation, credits, etc.)
   * @param {number} rewardValue - Reward value
   * @returns {Promise<object>} Send result
   */
  async sendReferralRewardGranted(userId, rewardType, rewardValue) {
    const user = await this.getUserContext(userId);

    const context = {
      firstName: user.firstName,
      rewardType,
      rewardValue,
      grantedAt: new Date().toISOString()
    };

    return this.send('referral_reward_granted', user.email, context, userId);
  }

  /**
   * Send referral link share reminder
   * @param {string} userId - User ID
   * @returns {Promise<object>} Send result
   */
  async sendReferralLinkShareReminder(userId) {
    const user = await this.getUserContext(userId);

    // Try to get referral code, fallback to generating one
    let referralCode;
    try {
      const referralResult = await db.query(`
        SELECT code FROM referrals WHERE user_id = $1 LIMIT 1
      `, [userId]);
      referralCode = referralResult.rows[0]?.code;
    } catch (error) {
      // Table might not exist or query failed
      referralCode = null;
    }

    // Generate a sample code if none exists
    if (!referralCode) {
      referralCode = userId.substring(0, 8).toUpperCase();
    }

    const referralUrl = `${process.env.FRONTEND_URL}/signup?invite=${referralCode}`;

    const context = {
      firstName: user.firstName,
      referralCode,
      referralUrl
    };

    return this.send('referral_link_share_reminder', user.email, context, userId);
  }

  // =====================================================
  // NICE-TO-HAVE EMAILS (3)
  // =====================================================

  /**
   * Send weekly analytics report
   * @param {string} userId - User ID
   * @param {object} analyticsData - Weekly analytics data
   * @returns {Promise<object>} Send result
   */
  async sendWeeklyAnalyticsReport(userId, analyticsData) {
    const user = await this.getUserContext(userId);

    const context = {
      firstName: user.firstName,
      weeklyStats: analyticsData,
      dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`
    };

    return this.send('weekly_analytics_report', user.email, context, userId);
  }

  /**
   * Send content performance insights
   * @param {string} userId - User ID
   * @param {object} performanceData - Content performance data
   * @returns {Promise<object>} Send result
   */
  async sendContentPerformanceInsights(userId, performanceData) {
    const user = await this.getUserContext(userId);

    const context = {
      firstName: user.firstName,
      performanceData,
      dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`
    };

    return this.send('content_performance_insights', user.email, context, userId);
  }

  /**
   * Send feature announcement
   * @param {string} userId - User ID
   * @param {string} featureName - Name of new feature
   * @param {string} featureDescription - Feature description
   * @returns {Promise<object>} Send result
   */
  async sendFeatureAnnouncement(userId, featureName, featureDescription) {
    const user = await this.getUserContext(userId);

    const context = {
      firstName: user.firstName,
      featureName,
      featureDescription,
      dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`
    };

    return this.send('feature_announcement', user.email, context, userId);
  }
}

export default new EmailService();
