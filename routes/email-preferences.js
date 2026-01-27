import express from 'express';
import db from '../services/database.js';
import crypto from 'crypto';

const router = express.Router();

/**
 * Email Categories:
 * - transactional: Welcome, verification, password reset (cannot unsubscribe)
 * - engagement: Blog post completion, low credit warnings, usage digests
 * - reengagement: 7-day and 14-day inactive reminders
 * - referral: Referral program emails
 * - admin: Admin alerts (cannot unsubscribe - only sent to admins)
 */

const EMAIL_CATEGORIES = {
  transactional: {
    name: 'Transactional Emails',
    description: 'Account-related emails like password resets and verifications',
    canUnsubscribe: false
  },
  engagement: {
    name: 'Product Updates & Tips',
    description: 'Blog post completion alerts, credit warnings, and usage summaries',
    canUnsubscribe: true
  },
  reengagement: {
    name: 'Re-engagement Reminders',
    description: 'Reminders when you haven\'t used the platform in a while',
    canUnsubscribe: true
  },
  referral: {
    name: 'Referral Program',
    description: 'Updates about your referrals and rewards',
    canUnsubscribe: true
  }
};

/**
 * GET /api/v1/email-preferences/:userId
 * Get user's email preferences
 */
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Verify user exists
    const userResult = await db.query(
      'SELECT email, unsubscribed_from, email_preferences FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const unsubscribedFrom = user.unsubscribed_from || [];
    const emailPreferences = user.email_preferences || {};

    // Build preferences object
    const preferences = {};
    for (const [category, config] of Object.entries(EMAIL_CATEGORIES)) {
      preferences[category] = {
        ...config,
        subscribed: !unsubscribedFrom.includes(category)
      };
    }

    res.json({
      success: true,
      email: user.email,
      preferences,
      customPreferences: emailPreferences
    });

  } catch (error) {
    console.error('❌ Failed to get email preferences:', error);
    res.status(500).json({
      error: 'Failed to get email preferences',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/email-preferences/:userId
 * Update user's email preferences
 * Body: { category: string, subscribed: boolean }
 */
router.post('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { category, subscribed } = req.body;

    // Validate category
    if (!EMAIL_CATEGORIES[category]) {
      return res.status(400).json({
        error: 'Invalid category',
        availableCategories: Object.keys(EMAIL_CATEGORIES)
      });
    }

    // Check if category can be unsubscribed
    if (!EMAIL_CATEGORIES[category].canUnsubscribe && !subscribed) {
      return res.status(400).json({
        error: 'Cannot unsubscribe from this category',
        category: EMAIL_CATEGORIES[category].name
      });
    }

    // Get current unsubscribed_from array
    const userResult = await db.query(
      'SELECT unsubscribed_from FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    let unsubscribedFrom = userResult.rows[0].unsubscribed_from || [];

    // Update array
    if (subscribed) {
      // Remove from unsubscribed list
      unsubscribedFrom = unsubscribedFrom.filter(cat => cat !== category);
    } else {
      // Add to unsubscribed list
      if (!unsubscribedFrom.includes(category)) {
        unsubscribedFrom.push(category);
      }
    }

    // Update database
    await db.query(
      'UPDATE users SET unsubscribed_from = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(unsubscribedFrom), userId]
    );

    // Log preference change
    await db.query(`
      INSERT INTO email_logs (user_id, email_type, recipient_email, status, context_data, created_at)
      SELECT
        id,
        'preference_change',
        email,
        'completed',
        jsonb_build_object('category', $2, 'action', $3),
        NOW()
      FROM users WHERE id = $1
    `, [userId, category, subscribed ? 'subscribed' : 'unsubscribed']);

    res.json({
      success: true,
      message: `Successfully ${subscribed ? 'subscribed to' : 'unsubscribed from'} ${EMAIL_CATEGORIES[category].name}`,
      category,
      subscribed,
      unsubscribedFrom
    });

  } catch (error) {
    console.error('❌ Failed to update email preferences:', error);
    res.status(500).json({
      error: 'Failed to update email preferences',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/email-preferences/unsubscribe/:token
 * One-click unsubscribe from specific category
 */
router.get('/unsubscribe/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Decode token (format: base64(userId:category:timestamp:hmac))
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [userId, category, timestamp, hmac] = decoded.split(':');

    // Verify HMAC
    const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET || 'default-secret-change-me';
    const expectedHmac = crypto
      .createHmac('sha256', secret)
      .update(`${userId}:${category}:${timestamp}`)
      .digest('hex');

    if (hmac !== expectedHmac) {
      return res.status(400).json({ error: 'Invalid unsubscribe token' });
    }

    // Check token age (valid for 90 days)
    const tokenAge = Date.now() - parseInt(timestamp);
    if (tokenAge > 90 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Unsubscribe token expired' });
    }

    // Validate category
    if (!EMAIL_CATEGORIES[category]) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    // Check if category can be unsubscribed
    if (!EMAIL_CATEGORIES[category].canUnsubscribe) {
      return res.status(400).json({
        error: 'Cannot unsubscribe from this category',
        category: EMAIL_CATEGORIES[category].name
      });
    }

    // Get current unsubscribed_from array
    const userResult = await db.query(
      'SELECT email, unsubscribed_from FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    let unsubscribedFrom = userResult.rows[0].unsubscribed_from || [];

    // Add to unsubscribed list
    if (!unsubscribedFrom.includes(category)) {
      unsubscribedFrom.push(category);
    }

    // Update database
    await db.query(
      'UPDATE users SET unsubscribed_from = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(unsubscribedFrom), userId]
    );

    // Log unsubscribe
    await db.query(`
      INSERT INTO email_logs (user_id, email_type, recipient_email, status, context_data, created_at)
      VALUES ($1, 'unsubscribe', $2, 'completed', $3, NOW())
    `, [userId, userResult.rows[0].email, JSON.stringify({ category, method: 'one_click' })]);

    res.json({
      success: true,
      message: `You have been unsubscribed from ${EMAIL_CATEGORIES[category].name}`,
      category: EMAIL_CATEGORIES[category].name,
      managePreferencesUrl: `${process.env.FRONTEND_URL}/email-preferences/${userId}`
    });

  } catch (error) {
    console.error('❌ Failed to process unsubscribe:', error);
    res.status(500).json({
      error: 'Failed to process unsubscribe',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/email-preferences/unsubscribe/generate-token
 * Generate unsubscribe token for email footer links
 * Body: { userId: string, category: string }
 */
router.post('/unsubscribe/generate-token', async (req, res) => {
  try {
    const { userId, category } = req.body;

    if (!userId || !category) {
      return res.status(400).json({ error: 'userId and category are required' });
    }

    // Validate category
    if (!EMAIL_CATEGORIES[category]) {
      return res.status(400).json({
        error: 'Invalid category',
        availableCategories: Object.keys(EMAIL_CATEGORIES)
      });
    }

    // Generate HMAC token
    const timestamp = Date.now().toString();
    const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET || 'default-secret-change-me';
    const hmac = crypto
      .createHmac('sha256', secret)
      .update(`${userId}:${category}:${timestamp}`)
      .digest('hex');

    // Create token (format: base64(userId:category:timestamp:hmac))
    const token = Buffer.from(`${userId}:${category}:${timestamp}:${hmac}`).toString('base64');

    const unsubscribeUrl = `${process.env.FRONTEND_URL}/api/v1/email-preferences/unsubscribe/${token}`;

    res.json({
      success: true,
      token,
      unsubscribeUrl,
      expiresIn: '90 days'
    });

  } catch (error) {
    console.error('❌ Failed to generate unsubscribe token:', error);
    res.status(500).json({
      error: 'Failed to generate unsubscribe token',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/email-preferences/categories
 * Get all email categories and descriptions
 */
router.get('/categories/list', async (req, res) => {
  try {
    res.json({
      success: true,
      categories: EMAIL_CATEGORIES
    });
  } catch (error) {
    console.error('❌ Failed to get email categories:', error);
    res.status(500).json({
      error: 'Failed to get email categories',
      message: error.message
    });
  }
});

export default router;
