import OpenAI from 'openai';
import db from './database.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class EmailContentGenerator {
  constructor() {
    this.model = 'gpt-4o'; // Use GPT-4o for better email quality
    this.promptCache = new Map(); // Cache loaded prompts
  }

  /**
   * Generate email content using GPT-4o
   * @param {string} emailType - Type of email (referral_invitation, low_credit_warning, etc.)
   * @param {object} context - Context data for email personalization
   * @returns {Promise<object>} Generated email content {subject, preheader, bodyHtml, bodyPlainText, cta}
   */
  async generate(emailType, context) {
    try {
      console.log(`🤖 Generating LLM email content: ${emailType}`);

      // 1. Load email template (prompts) from database
      const template = await this.getEmailTemplate(emailType);

      // 2. Build system and user prompts
      const systemPrompt = template.system_prompt;
      const userPrompt = this.interpolateTemplate(template.user_prompt_template, context);

      // 3. Call OpenAI API
      const completion = await openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: parseFloat(template.temperature) || 0.7,
        max_tokens: parseInt(template.max_tokens) || 1000
      });

      // 4. Parse and validate response
      const response = completion.choices[0].message.content;
      const parsedContent = this.parseOpenAIResponse(response);

      // 5. Validate required fields
      this.validateEmailContent(parsedContent);

      // 6. Run quality checks
      const qualityCheck = this.validateEmailQuality(parsedContent, emailType);
      if (!qualityCheck.valid) {
        console.warn(`⚠️ Quality issues in ${emailType}:`, qualityCheck.issues);
      }

      console.log(`✅ LLM email content generated: ${emailType}`);
      return parsedContent;

    } catch (error) {
      console.error(`❌ LLM email generation failed: ${emailType}`, error);

      // Fallback to simple template if LLM fails
      return this.getFallbackContent(emailType, context);
    }
  }

  /**
   * Get email template from database (with caching)
   * @param {string} emailType - Type of email
   * @returns {Promise<object>} Email template with system_prompt, user_prompt_template, etc.
   */
  async getEmailTemplate(emailType) {
    // Check cache first
    if (this.promptCache.has(emailType)) {
      return this.promptCache.get(emailType);
    }

    const result = await db.query(`
      SELECT system_prompt, user_prompt_template, temperature, max_tokens
      FROM email_templates
      WHERE email_type = $1 AND active = TRUE
      LIMIT 1
    `, [emailType]);

    if (result.rows.length === 0) {
      throw new Error(`Email template not found: ${emailType}`);
    }

    const template = result.rows[0];
    this.promptCache.set(emailType, template);
    return template;
  }

  /**
   * Interpolate Handlebars-style template variables
   * @param {string} template - Template string with {{variables}}
   * @param {object} context - Context object with values
   * @returns {string} Interpolated template
   */
  interpolateTemplate(template, context) {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const value = this.getNestedProperty(context, key.trim());
      return value !== undefined ? value : match;
    });
  }

  /**
   * Get nested property from object (e.g., 'user.firstName')
   * @param {object} obj - Object to get property from
   * @param {string} path - Dot-separated path
   * @returns {any} Property value
   */
  getNestedProperty(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Parse OpenAI JSON response with robust error handling
   * @param {string} response - LLM response string
   * @returns {object} Parsed JSON object
   */
  parseOpenAIResponse(response) {
    try {
      // Remove markdown code blocks if present
      let cleanedResponse = response.trim();
      cleanedResponse = cleanedResponse.replace(/^```json\s*/i, '');
      cleanedResponse = cleanedResponse.replace(/^```\s*/, '');
      cleanedResponse = cleanedResponse.replace(/\s*```$/, '');
      cleanedResponse = cleanedResponse.trim();

      return JSON.parse(cleanedResponse);
    } catch (error) {
      console.error('❌ Failed to parse OpenAI response:', error);
      console.error('Response was:', response.substring(0, 200));
      throw new Error(`Invalid JSON response from LLM: ${error.message}`);
    }
  }

  /**
   * Validate email content has required fields
   * @param {object} content - Email content object
   * @throws {Error} If required fields are missing
   */
  validateEmailContent(content) {
    const requiredFields = ['subject', 'bodyHtml', 'bodyPlainText'];
    const missingFields = requiredFields.filter(field => !content[field]);

    if (missingFields.length > 0) {
      throw new Error(`Missing required email fields: ${missingFields.join(', ')}`);
    }
  }

  /**
   * Validate email quality (subject length, placeholders, etc.)
   * @param {object} content - Email content object
   * @param {string} emailType - Type of email
   * @returns {object} {valid: boolean, issues: string[]}
   */
  validateEmailQuality(content, emailType) {
    const issues = [];

    // Subject length
    if (content.subject.length > 60) {
      issues.push(`Subject line too long: ${content.subject.length} chars`);
    }

    // Placeholder detection
    if (content.bodyHtml.includes('{{') || content.bodyHtml.includes('}}')) {
      issues.push('Uninterpolated template variables found in HTML');
    }
    if (content.bodyPlainText.includes('{{') || content.bodyPlainText.includes('}}')) {
      issues.push('Uninterpolated template variables found in plain text');
    }

    // CTA validation
    if (content.cta && content.cta.url && !content.cta.url.startsWith('http')) {
      issues.push('Invalid CTA URL (must start with http/https)');
    }

    // Word count check
    const wordCount = content.bodyPlainText.split(/\s+/).length;
    if (wordCount > 300) {
      issues.push(`Email too long: ${wordCount} words (recommended < 300)`);
    }

    // Empty content check
    if (!content.subject || content.subject.trim().length === 0) {
      issues.push('Empty subject line');
    }
    if (!content.bodyHtml || content.bodyHtml.trim().length < 10) {
      issues.push('Email body too short or empty');
    }

    return { valid: issues.length === 0, issues };
  }

  /**
   * Fallback content if LLM fails (simple templates)
   * @param {string} emailType - Type of email
   * @param {object} context - Context object
   * @returns {object} Fallback email content
   */
  getFallbackContent(emailType, context) {
    console.warn(`⚠️ Using fallback template for: ${emailType}`);

    const fallbacks = {
      'welcome_email': {
        subject: `Welcome to AutoBlog, ${context.firstName}!`,
        preheader: `Let's get you started with AI-powered blog generation`,
        bodyHtml: `<p>Hi ${context.firstName},</p><p>Welcome to AutoBlog! We're excited to have you join us.</p><p>AutoBlog helps you create high-quality blog content using AI. Get started by analyzing your website and generating your first blog post.</p><p style="margin-top: 20px;"><a href="${process.env.FRONTEND_URL}/dashboard" style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Get Started</a></p>`,
        bodyPlainText: `Hi ${context.firstName},\n\nWelcome to AutoBlog! We're excited to have you join us.\n\nAutoBlog helps you create high-quality blog content using AI. Get started by analyzing your website and generating your first blog post.\n\nGet Started: ${process.env.FRONTEND_URL}/dashboard`,
        cta: { text: 'Get Started', url: `${process.env.FRONTEND_URL}/dashboard` }
      },
      'low_credit_warning': {
        subject: 'Running low on credits',
        preheader: `You have ${context.availableCredits} credits remaining`,
        bodyHtml: `<p>Hi ${context.firstName},</p><p>You have ${context.availableCredits} credits remaining. Consider upgrading your plan to continue creating great content.</p><p style="margin-top: 20px;"><a href="${context.upgradeUrl}" style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Add Credits</a></p>`,
        bodyPlainText: `Hi ${context.firstName},\n\nYou have ${context.availableCredits} credits remaining. Consider upgrading your plan to continue creating great content.\n\nAdd Credits: ${context.upgradeUrl}`,
        cta: { text: 'Add Credits', url: context.upgradeUrl }
      },
      'referral_invitation': {
        subject: `${context.inviterName} invited you to try AutoBlog`,
        preheader: 'Get 1 free blog post when you sign up',
        bodyHtml: `<p>Hi there!</p><p>Your friend <strong>${context.inviterName}</strong> has invited you to try AutoBlog.</p><p>AutoBlog uses AI to generate high-quality blog posts in minutes. Sign up through this invitation and you'll both get 1 free blog post (a $15 value!).</p><p style="margin-top: 20px;"><a href="${context.inviteUrl}" style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Accept Invitation</a></p>`,
        bodyPlainText: `Hi there!\n\nYour friend ${context.inviterName} has invited you to try AutoBlog.\n\nAutoBlog uses AI to generate high-quality blog posts in minutes. Sign up through this invitation and you'll both get 1 free blog post (a $15 value!).\n\nAccept Invitation: ${context.inviteUrl}`,
        cta: { text: 'Accept Invitation', url: context.inviteUrl }
      }
    };

    return fallbacks[emailType] || {
      subject: 'Notification from AutoBlog',
      preheader: 'You have a new notification',
      bodyHtml: '<p>You have a new notification from AutoBlog.</p>',
      bodyPlainText: 'You have a new notification from AutoBlog.',
      cta: { text: 'View Dashboard', url: `${process.env.FRONTEND_URL}/dashboard` }
    };
  }

  /**
   * Clear prompt cache (useful for testing or when templates are updated)
   */
  clearCache() {
    this.promptCache.clear();
    console.log('🧹 Email template cache cleared');
  }
}

export default new EmailContentGenerator();
