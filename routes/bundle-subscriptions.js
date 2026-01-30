import express from 'express';
import db from '../services/database.js';
import pricingCalculator from '../services/pricing-calculator.js';
import Stripe from 'stripe';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Middleware to authenticate requests
 */
const authenticateToken = (req, res, next) => {
  if (!req.user || !req.user.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

/**
 * GET /api/v1/strategies/bundle/calculate
 * Calculate bundle pricing for all user's strategies
 */
router.get('/calculate',  async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get all user's strategies
    const result = await db.query(
      'SELECT * FROM audiences WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    const strategies = result.rows;

    if (strategies.length < 2) {
      return res.status(400).json({
        error: 'Insufficient strategies',
        message: 'Bundle requires at least 2 strategies. You currently have ' + strategies.length
      });
    }

    // Calculate bundle pricing
    const bundlePricing = pricingCalculator.calculateAllStrategiesBundle(strategies);

    if (!bundlePricing) {
      return res.status(400).json({
        error: 'Could not calculate bundle pricing',
        message: 'Not enough strategies with valid profit data'
      });
    }

    res.json({
      bundlePricing,
      message: pricingCalculator.formatBundlePricingMessage(bundlePricing)
    });

  } catch (error) {
    console.error('Error calculating bundle pricing:', error);
    res.status(500).json({ error: 'Failed to calculate bundle pricing' });
  }
});

/**
 * POST /api/v1/strategies/bundle/subscribe
 * Create Stripe checkout session for bundle subscription
 */
router.post('/subscribe',  async (req, res) => {
  try {
    const { billingInterval } = req.body; // 'monthly' or 'annual'
    const userId = req.user.userId;

    // Validate billing interval
    if (!['monthly', 'annual'].includes(billingInterval)) {
      return res.status(400).json({ error: 'Invalid billing interval. Must be "monthly" or "annual"' });
    }

    // Get all user's strategies
    const strategiesResult = await db.query(
      'SELECT * FROM audiences WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    const strategies = strategiesResult.rows;

    if (strategies.length < 2) {
      return res.status(400).json({
        error: 'Bundle requires at least 2 strategies',
        message: `You currently have ${strategies.length} strategy. Create at least one more to access bundle pricing.`
      });
    }

    // Calculate bundle pricing
    const bundlePricing = pricingCalculator.calculateAllStrategiesBundle(strategies);

    if (!bundlePricing) {
      return res.status(400).json({
        error: 'Could not calculate bundle pricing',
        message: 'Not enough strategies with valid profit data for bundle'
      });
    }

    // Check if user already has an active bundle subscription
    const existingBundle = await db.query(
      `SELECT * FROM bundle_subscriptions
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );

    if (existingBundle.rows.length > 0) {
      return res.status(400).json({
        error: 'Bundle subscription already exists',
        message: 'You already have an active bundle subscription. Cancel it first to create a new one.',
        existingBundle: existingBundle.rows[0]
      });
    }

    // Create dynamic Stripe price for bundle (on-the-fly)
    const amount = billingInterval === 'annual'
      ? bundlePricing.bundleAnnual
      : bundlePricing.bundleMonthly;

    console.log('💰 Creating bundle Stripe price:', {
      amount,
      billingInterval,
      strategyCount: bundlePricing.strategyCount,
      bundleMonthly: bundlePricing.bundleMonthly,
      bundleAnnual: bundlePricing.bundleAnnual
    });

    const bundlePrice = await stripe.prices.create({
      unit_amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      recurring: {
        interval: billingInterval === 'annual' ? 'year' : 'month'
      },
      product_data: {
        name: `All Strategies Bundle (${bundlePricing.strategyCount} strategies)`,
        description: `Access to all ${bundlePricing.strategyCount} strategies with ${bundlePricing.postsPerStrategy.recommended}-${bundlePricing.postsPerStrategy.maximum} posts/month each`
      },
      metadata: {
        user_id: userId.toString(),
        bundle_type: 'all_strategies',
        strategy_count: bundlePricing.strategyCount.toString(),
        billing_interval: billingInterval,
        monthly_discount: bundlePricing.savings.monthlyDiscountPercent.toString(),
        annual_discount: bundlePricing.savings.annualDiscountPercent?.toString() || '0',
        total_discount: bundlePricing.savings.totalDiscountPercent.toString()
      }
    });

    console.log('✅ Bundle Stripe price created:', bundlePrice.id);

    // Create Checkout Session
    console.log('🛒 Creating Stripe checkout session...');
    const session = await stripe.checkout.sessions.create({
      customer_email: req.user.email,
      line_items: [{
        price: bundlePrice.id,
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?bundle_subscribed=true`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?tab=audience`,
      metadata: {
        user_id: userId.toString(),
        is_bundle: 'true',
        strategy_count: bundlePricing.strategyCount.toString(),
        billing_interval: billingInterval,
        bundle_monthly_price: bundlePricing.bundleMonthly.toString(),
        bundle_annual_price: bundlePricing.bundleAnnual.toString(),
        individual_monthly_total: bundlePricing.individualMonthlyTotal.toString(),
        total_discount_percent: bundlePricing.savings.totalDiscountPercent.toString()
      }
    });

    res.json({
      sessionId: session.id,
      url: session.url,
      bundlePricing
    });

  } catch (error) {
    console.error('❌ Error creating bundle subscription:', {
      message: error.message,
      type: error.type,
      code: error.code,
      statusCode: error.statusCode,
      stack: error.stack
    });

    // Return detailed error for debugging
    res.status(500).json({
      error: 'Failed to create bundle subscription',
      message: error.message,
      details: error.type || error.code || 'Unknown error'
    });
  }
});

/**
 * GET /api/v1/strategies/bundle
 * Get user's active bundle subscription
 */
router.get('/',  async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await db.query(
      `SELECT * FROM bundle_subscriptions
       WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.json({ bundleSubscription: null });
    }

    const bundle = result.rows[0];

    // Get all strategy purchases linked to this bundle
    const strategiesResult = await db.query(
      `SELECT
        sp.*,
        a.id as strategy_id,
        a.pitch,
        a.target_segment,
        a.seo_keywords,
        a.image_url
      FROM strategy_purchases sp
      INNER JOIN audiences a ON sp.strategy_id = a.id
      WHERE sp.bundle_subscription_id = $1 AND sp.status = 'active'`,
      [bundle.id]
    );

    res.json({
      bundleSubscription: {
        id: bundle.id,
        strategyCount: bundle.strategy_count,
        billingInterval: bundle.billing_interval,
        bundleMonthlyPrice: parseFloat(bundle.bundle_monthly_price),
        bundleAnnualPrice: bundle.bundle_annual_price ? parseFloat(bundle.bundle_annual_price) : null,
        amountPaid: parseFloat(bundle.amount_paid),
        totalDiscountPercent: bundle.total_discount_percent ? parseFloat(bundle.total_discount_percent) : null,
        nextBillingDate: bundle.next_billing_date,
        createdAt: bundle.created_at,
        strategies: strategiesResult.rows.map(row => ({
          strategyId: row.strategy_id,
          postsRecommended: row.posts_recommended,
          postsMaximum: row.posts_maximum,
          postsUsed: row.posts_used,
          postsRemaining: row.posts_remaining,
          targetSegment: typeof row.target_segment === 'string' ? JSON.parse(row.target_segment) : row.target_segment,
          seoKeywords: row.seo_keywords,
          imageUrl: row.image_url
        }))
      }
    });

  } catch (error) {
    console.error('Error fetching bundle subscription:', error);
    res.status(500).json({ error: 'Failed to fetch bundle subscription' });
  }
});

/**
 * DELETE /api/v1/strategies/bundle
 * Cancel bundle subscription (via Stripe)
 */
router.delete('/',  async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get active bundle subscription
    const result = await db.query(
      `SELECT * FROM bundle_subscriptions
       WHERE user_id = $1 AND status = 'active'
       LIMIT 1`,
      [userId]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'No active bundle subscription found' });
    }

    const bundle = result.rows[0];

    // Cancel subscription in Stripe
    if (bundle.stripe_subscription_id) {
      await stripe.subscriptions.cancel(bundle.stripe_subscription_id);
    }

    // Mark as cancelled in database (webhook will handle the actual update)
    await db.query(
      `UPDATE bundle_subscriptions
       SET status = 'cancelled', cancelled_at = NOW()
       WHERE id = $1`,
      [bundle.id]
    );

    // Also mark all linked strategy purchases as cancelled
    await db.query(
      `UPDATE strategy_purchases
       SET status = 'cancelled', cancelled_at = NOW()
       WHERE bundle_subscription_id = $1`,
      [bundle.id]
    );

    res.json({
      success: true,
      message: 'Bundle subscription cancelled successfully'
    });

  } catch (error) {
    console.error('Error cancelling bundle subscription:', error);
    res.status(500).json({ error: 'Failed to cancel bundle subscription' });
  }
});

export default router;
