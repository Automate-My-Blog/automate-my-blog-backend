import express from 'express';
import emailService from '../services/email.js';
import emailContentGenerator from '../services/emailContentGenerator.js';

const router = express.Router();

/**
 * POST /api/v1/email/test/preview
 * Preview email content without sending
 * Body: { emailType, context }
 */
router.post('/preview', async (req, res) => {
  try {
    const { emailType, context } = req.body;

    if (!emailType) {
      return res.status(400).json({
        error: 'Missing required field: emailType'
      });
    }

    if (!context || typeof context !== 'object') {
      return res.status(400).json({
        error: 'Missing or invalid context object'
      });
    }

    console.log(`🧪 Generating email preview: ${emailType}`);

    // Generate email content using LLM
    const generatedContent = await emailContentGenerator.generate(emailType, context);

    // Wrap in HTML template
    const htmlBody = emailService.wrapInEmailTemplate(
      generatedContent.bodyHtml,
      generatedContent.cta
    );

    // Return preview
    res.json({
      success: true,
      emailType,
      preview: {
        subject: generatedContent.subject,
        preheader: generatedContent.preheader,
        bodyHtml: generatedContent.bodyHtml,
        bodyPlainText: generatedContent.bodyPlainText,
        cta: generatedContent.cta,
        fullHtml: htmlBody
      },
      context
    });

  } catch (error) {
    console.error('❌ Email preview failed:', error);
    res.status(500).json({
      error: 'Failed to generate email preview',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/email/test/send
 * Send a test email (respects test mode and whitelist)
 * Body: { emailType, recipientEmail, context, userId? }
 */
router.post('/send', async (req, res) => {
  try {
    const { emailType, recipientEmail, context, userId } = req.body;

    if (!emailType) {
      return res.status(400).json({
        error: 'Missing required field: emailType'
      });
    }

    if (!recipientEmail) {
      return res.status(400).json({
        error: 'Missing required field: recipientEmail'
      });
    }

    if (!context || typeof context !== 'object') {
      return res.status(400).json({
        error: 'Missing or invalid context object'
      });
    }

    console.log(`🧪 Sending test email: ${emailType} to ${recipientEmail}`);

    // Send email (will respect test mode and whitelist settings)
    const result = await emailService.send(
      emailType,
      recipientEmail,
      context,
      userId || null
    );

    res.json({
      success: true,
      result,
      emailType,
      recipientEmail,
      testMode: emailService.testMode
    });

  } catch (error) {
    console.error('❌ Test email send failed:', error);
    res.status(500).json({
      error: 'Failed to send test email',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/email/test/templates
 * List all available email templates
 */
router.get('/templates', async (req, res) => {
  try {
    const db = (await import('../services/database.js')).default;

    const result = await db.query(`
      SELECT
        email_type,
        category,
        required_context_fields,
        active
      FROM email_templates
      WHERE active = TRUE
      ORDER BY category, email_type
    `);

    const templatesByCategory = result.rows.reduce((acc, template) => {
      if (!acc[template.category]) {
        acc[template.category] = [];
      }
      acc[template.category].push({
        emailType: template.email_type,
        requiredFields: template.required_context_fields
      });
      return acc;
    }, {});

    res.json({
      success: true,
      templates: result.rows,
      templatesByCategory,
      totalTemplates: result.rows.length
    });

  } catch (error) {
    console.error('❌ Failed to fetch email templates:', error);
    res.status(500).json({
      error: 'Failed to fetch email templates',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/email/test/example/:emailType
 * Get example context for a specific email type
 */
router.get('/example/:emailType', async (req, res) => {
  try {
    const { emailType } = req.params;

    // Example contexts for each email type
    const exampleContexts = {
      referral_invitation: {
        inviterName: 'John Smith',
        inviterEmail: 'john@example.com',
        email: 'friend@example.com',
        inviteCode: 'ABC123XYZ',
        inviteUrl: 'https://automatemyblog.com/signup?invite=ABC123XYZ'
      },
      welcome_email: {
        firstName: 'Sarah',
        lastName: 'Johnson',
        email: 'sarah@example.com',
        planTier: 'starter',
        businessType: 'SaaS'
      },
      low_credit_warning: {
        firstName: 'Michael',
        lastName: 'Chen',
        planTier: 'starter',
        availableCredits: 2,
        businessType: 'E-commerce',
        weeklyStats: {
          postsGenerated: 5,
          completedPosts: 5
        },
        upgradeUrl: 'https://automatemyblog.com/pricing'
      },
      high_lead_score_followup: {
        leadScore: 85,
        estimatedCompanySize: '50-200 employees',
        industryFitScore: 90,
        urgencyScore: 75,
        leadSource: 'website_form',
        websiteUrl: 'https://example.com'
      },
      subscription_confirmation: {
        firstName: 'Emma',
        lastName: 'Wilson',
        subscription: {
          plan_name: 'Professional',
          amount: 99,
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          credits_included: 20
        }
      },
      blog_post_completion: {
        firstName: 'David',
        postTitle: '10 Ways to Improve Your SaaS Marketing Strategy',
        postUrl: 'https://automatemyblog.com/posts/123',
        createdAt: new Date().toISOString()
      },
      credit_expiration_warning: {
        firstName: 'Lisa',
        expiringCredits: 5,
        expirationDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        daysUntilExpiration: 7,
        dashboardUrl: 'https://automatemyblog.com/dashboard'
      }
    };

    const exampleContext = exampleContexts[emailType];

    if (!exampleContext) {
      return res.status(404).json({
        error: 'Example context not found for this email type',
        message: `No example context defined for: ${emailType}`,
        availableExamples: Object.keys(exampleContexts)
      });
    }

    res.json({
      success: true,
      emailType,
      exampleContext,
      usage: `POST /api/v1/email/test/preview with body: { "emailType": "${emailType}", "context": ${JSON.stringify(exampleContext, null, 2)} }`
    });

  } catch (error) {
    console.error('❌ Failed to get example context:', error);
    res.status(500).json({
      error: 'Failed to get example context',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/email/test/send-to-me/:emailType
 * Send a personalized test email to your account (for quick testing)
 */
router.get('/send-to-me/:emailType', async (req, res) => {
  try {
    const { emailType } = req.params;
    const db = (await import('../services/database.js')).default;

    // Get your user account
    const userResult = await db.query(`
      SELECT id, email, first_name, last_name, plan_tier
      FROM users
      WHERE email = 'james@frankel.tv'
      LIMIT 1
    `);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found',
        message: 'No user found with email james@frankel.tv'
      });
    }

    const user = userResult.rows[0];

    console.log(`🧪 Sending test email: ${emailType} to ${user.email}`);

    // Send based on email type
    let result;
    switch (emailType) {
      case 'low_credit_warning':
        result = await emailService.sendLowCreditWarning(user.id);
        break;
      case 'welcome_email':
        result = await emailService.sendWelcomeEmail(user.id);
        break;
      case 'usage_digest':
        result = await emailService.sendUsageDigest(user.id);
        break;
      default:
        return res.status(400).json({
          error: 'Email type not supported',
          message: `Supported types: low_credit_warning, welcome_email, usage_digest`,
          emailType
        });
    }

    res.json({
      success: true,
      message: `Test email sent to ${user.email}!`,
      emailType,
      recipient: user.email,
      messageId: result.messageId,
      subject: result.generatedContent?.subject
    });

  } catch (error) {
    console.error('❌ Send-to-me test failed:', error);
    res.status(500).json({
      error: 'Failed to send test email',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/email/test/quick/:emailType
 * Quick test with example context (preview only)
 */
router.post('/quick/:emailType', async (req, res) => {
  try {
    const { emailType } = req.params;

    // Get example context
    const exampleResponse = await fetch(`http://localhost:${process.env.PORT || 3001}/api/v1/email/test/example/${emailType}`);

    if (!exampleResponse.ok) {
      return res.status(404).json({
        error: 'Email type not found or no example available',
        emailType
      });
    }

    const exampleData = await exampleResponse.json();
    const context = exampleData.exampleContext;

    // Generate preview
    const generatedContent = await emailContentGenerator.generate(emailType, context);

    // Wrap in HTML template
    const htmlBody = emailService.wrapInEmailTemplate(
      generatedContent.bodyHtml,
      generatedContent.cta
    );

    res.json({
      success: true,
      emailType,
      preview: {
        subject: generatedContent.subject,
        preheader: generatedContent.preheader,
        bodyHtml: generatedContent.bodyHtml,
        bodyPlainText: generatedContent.bodyPlainText,
        cta: generatedContent.cta,
        fullHtml: htmlBody
      },
      usedExampleContext: context
    });

  } catch (error) {
    console.error('❌ Quick test failed:', error);
    res.status(500).json({
      error: 'Quick test failed',
      message: error.message
    });
  }
});

export default router;
