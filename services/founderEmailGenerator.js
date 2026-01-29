import OpenAI from 'openai';
import db from './database.js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class FounderEmailGenerator {
  /**
   * Generate a personalized founder welcome email using LLM
   * @param {string} userId - User ID
   * @returns {Promise<object>} Generated email content + metadata
   */
  async generateWelcomeEmail(userId) {
    try {
      console.log(`📧 Generating founder welcome email for user: ${userId}`);

      // Get user context
      const userResult = await db.query(`
        SELECT id, email, first_name, last_name, created_at, first_login_at
        FROM users
        WHERE id = $1
      `, [userId]);

      if (userResult.rows.length === 0) {
        throw new Error(`User not found: ${userId}`);
      }

      const user = userResult.rows[0];

      // Check if user has generated any posts
      const postResult = await db.query(`
        SELECT id, title, created_at
        FROM blog_posts
        WHERE user_id = $1
        ORDER BY created_at ASC
        LIMIT 1
      `, [userId]);

      const hasGeneratedPost = postResult.rows.length > 0;
      const firstPost = postResult.rows[0];

      // Build context for LLM
      const firstName = user.first_name || user.email.split('@')[0];
      const lastName = user.last_name || '';

      const systemPrompt = `You are James, the founder of Automate My Blog. You write warm, genuine, conversational emails to new users - not marketing copy. Your tone is:
- Humble and honest about being early stage
- Genuinely curious about their feedback
- Appreciative without being pushy
- Calm and friendly, like texting a colleague
- Never salesy or corporate

Your goal is to build a real relationship and get honest feedback, not to upsell or sound polished.`;

      const userPrompt = `Write a personal welcome email from James (founder) to a new user who just signed up:

USER: ${firstName} ${lastName}
EMAIL: ${user.email}
SIGNED UP: ${new Date(user.created_at).toLocaleDateString()}
FIRST LOGIN: ${new Date(user.first_login_at).toLocaleString()} (about 24 minutes ago)
${hasGeneratedPost ? `HAS GENERATED POST: Yes
POST TITLE: "${firstPost.title}"
POST GENERATED: ${new Date(firstPost.created_at).toLocaleString()}` : 'HAS GENERATED POST: No'}

The email should:
1. Start with a warm, personal greeting (use first name casually)
2. Briefly introduce yourself as James, the founder/builder
3. Be honest that you're still figuring things out and it's early days
4. Express genuine appreciation that they signed up and tried it
${hasGeneratedPost ? `5. Specifically mention you saw they generated content (reference the title naturally)
6. Ask what they think of it - did it meet expectations? How could it be better?` : `5. Acknowledge they haven't generated content yet (no pressure)
6. Ask if anything was confusing or if they hit any roadblocks`}
7. Ask for any feedback - good or bad - in a non-pressuring way
8. Offer to personally help if they run into issues
9. Sign off casually (just "James" or "James from Automate My Blog")
10. Keep it under 150 words
11. Sound like a real person texting, not a marketing email

Avoid:
- Corporate buzzwords or jargon
- Excessive exclamation marks
- Being too formal or too casual
- Making promises you can't keep
- Sounding like AI wrote it

Return JSON:
{
  "subject": "string - casual, personal subject (not marketing-y)",
  "bodyPlainText": "string - plain text email body (natural paragraphs)"
}`;

      // Call OpenAI API
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.8,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' }
      });

      const generated = JSON.parse(completion.choices[0].message.content);

      // Convert plain text to simple HTML
      const bodyHtml = this.convertToSimpleHtml(generated.bodyPlainText);

      // Store in pending_founder_emails table
      const insertResult = await db.query(`
        INSERT INTO pending_founder_emails (
          user_id, recipient_email, recipient_name,
          subject, body_html, body_plain_text,
          user_context, has_generated_post, post_title,
          status, generated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())
        RETURNING id
      `, [
        userId,
        user.email,
        `${firstName} ${lastName}`.trim(),
        generated.subject,
        bodyHtml,
        generated.bodyPlainText,
        JSON.stringify({
          firstName,
          lastName,
          signupDate: user.created_at,
          firstLoginAt: user.first_login_at
        }),
        hasGeneratedPost,
        hasGeneratedPost ? firstPost.title : null
      ]);

      const emailId = insertResult.rows[0].id;

      console.log(`✅ Generated founder email ${emailId} for ${user.email}`);

      return {
        id: emailId,
        userId,
        recipientEmail: user.email,
        subject: generated.subject,
        bodyPlainText: generated.bodyPlainText,
        bodyHtml,
        hasGeneratedPost
      };

    } catch (error) {
      console.error(`❌ Failed to generate founder email for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Convert plain text to simple HTML paragraphs
   * @param {string} plainText - Plain text email body
   * @returns {string} HTML version
   */
  convertToSimpleHtml(plainText) {
    return plainText
      .split('\n\n')
      .map(para => `<p>${para.trim()}</p>`)
      .join('\n');
  }
}

export default new FounderEmailGenerator();
