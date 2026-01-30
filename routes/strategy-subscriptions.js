import express from 'express';
import db from '../services/database.js';
import pricingCalculator from '../services/pricing-calculator.js';
import Stripe from 'stripe';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Note: Authentication is handled at the router level in index.js
 * All routes here assume req.user is already set by authService.authMiddleware
 */

/**
 * GET /api/v1/strategies/:id/pricing
 * Calculate and return pricing for a specific strategy
 */
router.get('/:id/pricing', async (req, res) => {
  // Verify user is authenticated (should be set by upstream middleware)
  if (!req.user || !req.user.userId) {
    return res.status(401).json({ error: 'Unauthorized - User not authenticated' });
  }
  try {
    const { id: strategyId } = req.params;
    const userId = req.user.userId;

    // Get strategy from database
    const strategyResult = await db.query(
      'SELECT * FROM audiences WHERE id = $1 AND user_id = $2',
      [strategyId, userId]
    );

    if (!strategyResult.rows || strategyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const strategy = strategyResult.rows[0];

    // Calculate pricing
    const pricing = pricingCalculator.calculateProfitBasedPrice(strategy);

    if (!pricing) {
      return res.status(400).json({
        error: 'Could not calculate pricing',
        message: 'Strategy pitch does not contain valid profit data. Please regenerate the strategy.'
      });
    }

    res.json({
      strategyId: parseInt(strategyId),
      pricing,
      message: pricingCalculator.formatPricingMessage(pricing)
    });

  } catch (error) {
    console.error('Error calculating strategy pricing:', error);
    res.status(500).json({ error: 'Failed to calculate pricing' });
  }
});

/**
 * POST /api/v1/strategies/:id/subscribe
 * Create Stripe checkout session for individual strategy subscription
 */
router.post('/:id/subscribe',  async (req, res) => {
  try {
    const { id: strategyId } = req.params;
    const { billingInterval } = req.body; // 'monthly' or 'annual'
    const userId = req.user.userId;

    // Validate billing interval
    if (!['monthly', 'annual'].includes(billingInterval)) {
      return res.status(400).json({ error: 'Invalid billing interval. Must be "monthly" or "annual"' });
    }

    // Get strategy with pricing
    const strategyResult = await db.query(
      'SELECT * FROM audiences WHERE id = $1 AND user_id = $2',
      [strategyId, userId]
    );

    if (!strategyResult.rows || strategyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const strategy = strategyResult.rows[0];

    // Check if pricing already calculated and stored
    let pricing;
    if (strategy.pricing_monthly && strategy.pricing_annual) {
      pricing = {
        monthly: parseFloat(strategy.pricing_monthly),
        annual: parseFloat(strategy.pricing_annual),
        posts: {
          recommended: strategy.posts_recommended || 8,
          maximum: strategy.posts_maximum || 40
        },
        projectedLow: strategy.projected_profit_low,
        projectedHigh: strategy.projected_profit_high
      };
    } else {
      // Calculate pricing on-the-fly
      pricing = pricingCalculator.calculateProfitBasedPrice(strategy);
      if (!pricing) {
        return res.status(400).json({
          error: 'Could not calculate pricing',
          message: 'Strategy pitch does not contain valid profit data'
        });
      }

      // Store pricing in database for future use
      await db.query(
        `UPDATE audiences SET
          pricing_monthly = $1,
          pricing_annual = $2,
          posts_recommended = $3,
          posts_maximum = $4,
          projected_profit_low = $5,
          projected_profit_high = $6,
          pricing_calculated_at = NOW()
        WHERE id = $7`,
        [
          pricing.monthly,
          pricing.annual,
          pricing.posts.recommended,
          pricing.posts.maximum,
          pricing.projectedLow,
          pricing.projectedHigh,
          strategyId
        ]
      );
    }

    // Create Stripe Price on-the-fly for this subscription
    const amount = billingInterval === 'annual' ? pricing.annual : pricing.monthly;
    const targetSegment = typeof strategy.target_segment === 'string'
      ? JSON.parse(strategy.target_segment)
      : strategy.target_segment;

    const demographics = targetSegment?.demographics || 'Audience Strategy';

    const stripePrice = await stripe.prices.create({
      unit_amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      recurring: {
        interval: billingInterval === 'annual' ? 'year' : 'month'
      },
      product_data: {
        name: `${demographics.substring(0, 80)} - SEO Strategy (${pricing.posts.recommended}-${pricing.posts.maximum} posts/mo)`,
        metadata: {
          strategy_id: strategyId.toString(),
          user_id: userId.toString(),
          projected_profit_low: pricing.projectedLow?.toString() || '0',
          projected_profit_high: pricing.projectedHigh?.toString() || '0',
          description: `${pricing.posts.recommended}-${pricing.posts.maximum} posts/month. Projected profit: $${pricing.projectedLow}-$${pricing.projectedHigh}/month`
        }
      },
      metadata: {
        strategy_id: strategyId.toString(),
        user_id: userId.toString(),
        billing_interval: billingInterval,
        posts_recommended: pricing.posts.recommended.toString(),
        posts_maximum: pricing.posts.maximum.toString()
      }
    });

    // Build URLs (trim any whitespace and remove trailing slashes)
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
    const successUrl = `${frontendUrl}/dashboard?strategy_subscribed=${strategyId}`;
    const cancelUrl = `${frontendUrl}/dashboard?tab=audience`;

    console.log('🔗 Stripe Checkout URLs:', {
      frontendUrl,
      successUrl,
      cancelUrl
    });

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer_email: req.user.email,
      line_items: [{
        price: stripePrice.id,
        quantity: 1
      }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        user_id: userId.toString(),
        strategy_id: strategyId.toString(),
        billing_interval: billingInterval,
        posts_recommended: pricing.posts.recommended.toString(),
        posts_maximum: pricing.posts.maximum.toString()
      }
    });

    res.json({
      sessionId: session.id,
      url: session.url,
      pricing
    });

  } catch (error) {
    console.error('❌ Error creating strategy subscription:', {
      message: error.message,
      type: error.type,
      code: error.code,
      statusCode: error.statusCode,
      stack: error.stack
    });

    // Return detailed error for debugging
    res.status(500).json({
      error: 'Failed to create subscription',
      message: error.message,
      details: error.type || error.code || 'Unknown error'
    });
  }
});

/**
 * GET /api/v1/strategies/subscribed
 * Get all subscribed strategies for the current user
 */
router.get('/subscribed',  async (req, res) => {
  console.log('📊 GET /subscribed - Request received:', {
    hasUser: !!req.user,
    userId: req.user?.userId,
    userKeys: req.user ? Object.keys(req.user) : []
  });

  // Verify user is authenticated (should be set by upstream middleware)
  if (!req.user || !req.user.userId) {
    console.error('❌ GET /subscribed - Auth failed:', {
      hasUser: !!req.user,
      user: req.user
    });
    return res.status(401).json({ error: 'Unauthorized - User not authenticated' });
  }

  try {
    const userId = req.user.userId;
    console.log('📊 Fetching subscriptions for user:', userId);

    const result = await db.query(
      `SELECT
        sp.*,
        a.id as strategy_id,
        a.pitch,
        a.target_segment,
        a.customer_problem,
        a.customer_language,
        a.image_url,
        a.pricing_monthly,
        a.pricing_annual
      FROM strategy_purchases sp
      INNER JOIN audiences a ON sp.strategy_id = a.id
      WHERE sp.user_id = $1 AND sp.status = 'active'
      ORDER BY sp.created_at DESC`,
      [userId]
    );

    console.log('📊 Query completed:', {
      rowCount: result.rows.length,
      subscriptions: result.rows.map(r => ({ id: r.id, strategyId: r.strategy_id }))
    });

    const subscriptions = result.rows.map(row => ({
      id: row.id,
      strategyId: row.strategy_id,
      billingInterval: row.billing_interval,
      amountPaid: parseFloat(row.amount_paid),
      postsRecommended: row.posts_recommended,
      postsMaximum: row.posts_maximum,
      postsUsed: row.posts_used,
      postsRemaining: row.posts_remaining,
      nextBillingDate: row.next_billing_date,
      createdAt: row.created_at,
      strategy: {
        id: row.strategy_id,
        pitch: row.pitch,
        targetSegment: typeof row.target_segment === 'string' ? JSON.parse(row.target_segment) : row.target_segment,
        customerProblem: row.customer_problem,
        customerLanguage: row.customer_language,
        imageUrl: row.image_url,
        pricingMonthly: row.pricing_monthly ? parseFloat(row.pricing_monthly) : null,
        pricingAnnual: row.pricing_annual ? parseFloat(row.pricing_annual) : null
      }
    }));

    console.log('✅ Returning subscriptions:', subscriptions.length);
    res.json({ subscriptions });

  } catch (error) {
    console.error('❌ Error fetching subscribed strategies:', {
      message: error.message,
      stack: error.stack,
      userId: req.user?.userId
    });
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

/**
 * GET /api/v1/strategies/:id/access
 * Check if user has access to a specific strategy
 */
router.get('/:id/access',  async (req, res) => {
  try {
    const { id: strategyId } = req.params;
    const userId = req.user.userId;

    // Check if user has active subscription
    const result = await db.query(
      `SELECT * FROM strategy_purchases
       WHERE user_id = $1 AND strategy_id = $2 AND status = 'active'`,
      [userId, strategyId]
    );

    const hasAccess = result.rows.length > 0;
    const subscription = result.rows[0] || null;

    res.json({
      hasAccess,
      subscription: subscription ? {
        postsRemaining: subscription.posts_remaining,
        postsMaximum: subscription.posts_maximum,
        nextBillingDate: subscription.next_billing_date,
        billingInterval: subscription.billing_interval
      } : null
    });

  } catch (error) {
    console.error('Error checking strategy access:', error);
    res.status(500).json({ error: 'Failed to check access' });
  }
});

/**
 * POST /api/v1/strategies/:id/decrement
 * Decrement post quota for a strategy subscription
 */
router.post('/:id/decrement',  async (req, res) => {
  try {
    const { id: strategyId } = req.params;
    const userId = req.user.userId;
    const { action = 'content_generation', metadata = {} } = req.body;

    // Get active subscription
    const subResult = await db.query(
      `SELECT * FROM strategy_purchases
       WHERE user_id = $1 AND strategy_id = $2 AND status = 'active'`,
      [userId, strategyId]
    );

    if (!subResult.rows || subResult.rows.length === 0) {
      return res.status(403).json({
        error: 'No active subscription found',
        message: 'You need an active subscription to use this strategy'
      });
    }

    const subscription = subResult.rows[0];

    // Check if posts remaining
    if (subscription.posts_remaining <= 0) {
      return res.status(403).json({
        error: 'No posts remaining',
        message: 'Your post quota will reset on next billing date',
        nextBillingDate: subscription.next_billing_date
      });
    }

    // Decrement posts in transaction
    const client = await db.pool.getClient();
    try {
      await client.query('BEGIN');

      // Update subscription
      const updateResult = await client.query(
        `UPDATE strategy_purchases
         SET posts_used = posts_used + 1,
             posts_remaining = posts_remaining - 1,
             updated_at = NOW()
         WHERE id = $1
         RETURNING posts_remaining, posts_used`,
        [subscription.id]
      );

      // Log usage
      await client.query(
        `INSERT INTO strategy_usage_log
         (user_id, strategy_id, purchase_id, action, posts_decremented, context)
         VALUES ($1, $2, $3, $4, 1, $5)`,
        [userId, strategyId, subscription.id, action, JSON.stringify(metadata)]
      );

      await client.query('COMMIT');

      const updated = updateResult.rows[0];

      res.json({
        success: true,
        postsRemaining: updated.posts_remaining,
        postsUsed: updated.posts_used,
        postsMaximum: subscription.posts_maximum
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error decrementing posts:', error);
    res.status(500).json({ error: 'Failed to decrement posts' });
  }
});

export default router;
