/**
 * Strategy Access Control Middleware
 *
 * Checks if user has an active subscription to access a specific strategy
 * and enforces post quota limits.
 */

import db from '../services/database.js';

/**
 * Middleware to check if user has access to a strategy
 * Usage: router.post('/generate', authenticateToken, checkStrategyAccess, handler)
 *
 * Expects:
 * - req.user.id: User ID from auth middleware
 * - req.params.strategyId OR req.body.strategyId: Strategy ID to check
 *
 * Sets:
 * - req.strategySubscription: Active subscription details if access granted
 */
export const checkStrategyAccess = async (req, res, next) => {
  try {
    // Extract strategy ID from params or body
    const strategyId = req.params.strategyId || req.body.strategyId || req.params.id;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!strategyId) {
      return res.status(400).json({ error: 'Strategy ID required' });
    }

    // Get strategy to check if subscription is required
    const strategyResult = await db.query(
      'SELECT requires_subscription, pricing_monthly, pricing_annual FROM audiences WHERE id = $1',
      [strategyId]
    );

    if (!strategyResult.rows || strategyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const strategy = strategyResult.rows[0];

    // If strategy doesn't require subscription, allow access
    if (!strategy.requires_subscription) {
      return next();
    }

    // Check if user has active subscription (individual or bundle)
    const subscriptionResult = await db.query(
      `SELECT * FROM strategy_purchases
       WHERE user_id = $1
         AND strategy_id = $2
         AND status = 'active'
       LIMIT 1`,
      [userId, strategyId]
    );

    if (!subscriptionResult.rows || subscriptionResult.rows.length === 0) {
      return res.status(403).json({
        error: 'Strategy subscription required',
        strategyId: parseInt(strategyId),
        pricing: {
          monthly: strategy.pricing_monthly ? parseFloat(strategy.pricing_monthly) : null,
          annual: strategy.pricing_annual ? parseFloat(strategy.pricing_annual) : null
        },
        message: 'You need an active subscription to access this strategy'
      });
    }

    const subscription = subscriptionResult.rows[0];

    // Check if posts remaining this billing cycle
    if (subscription.posts_remaining <= 0) {
      return res.status(403).json({
        error: 'No posts remaining',
        message: 'Your post quota will reset on next billing date',
        nextBillingDate: subscription.next_billing_date,
        postsUsed: subscription.posts_used,
        postsMaximum: subscription.posts_maximum
      });
    }

    // Access granted - attach subscription to request
    req.strategySubscription = {
      id: subscription.id,
      strategyId: subscription.strategy_id,
      billingInterval: subscription.billing_interval,
      postsRecommended: subscription.posts_recommended,
      postsMaximum: subscription.posts_maximum,
      postsUsed: subscription.posts_used,
      postsRemaining: subscription.posts_remaining,
      nextBillingDate: subscription.next_billing_date,
      isBundle: subscription.is_bundle,
      bundleSubscriptionId: subscription.bundle_subscription_id
    };

    next();

  } catch (error) {
    console.error('Error checking strategy access:', error);
    res.status(500).json({ error: 'Failed to check strategy access' });
  }
};

/**
 * Middleware to check bundle subscription access
 * Usage: router.post('/bulk-generate', authenticateToken, checkBundleAccess, handler)
 */
export const checkBundleAccess = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if user has active bundle subscription
    const bundleResult = await db.query(
      `SELECT * FROM bundle_subscriptions
       WHERE user_id = $1 AND status = 'active'
       LIMIT 1`,
      [userId]
    );

    if (!bundleResult.rows || bundleResult.rows.length === 0) {
      return res.status(403).json({
        error: 'Bundle subscription required',
        message: 'You need an active bundle subscription to access all strategies'
      });
    }

    const bundle = bundleResult.rows[0];

    // Attach bundle subscription to request
    req.bundleSubscription = {
      id: bundle.id,
      strategyCount: bundle.strategy_count,
      billingInterval: bundle.billing_interval,
      bundleMonthlyPrice: parseFloat(bundle.bundle_monthly_price),
      nextBillingDate: bundle.next_billing_date
    };

    next();

  } catch (error) {
    console.error('Error checking bundle access:', error);
    res.status(500).json({ error: 'Failed to check bundle access' });
  }
};

/**
 * Helper function to manually check strategy access (non-middleware)
 * Useful for checking access within route handlers
 *
 * @param {number} userId - User ID
 * @param {number} strategyId - Strategy ID
 * @returns {Promise<Object|null>} Subscription object or null if no access
 */
export const hasStrategyAccess = async (userId, strategyId) => {
  try {
    const result = await db.query(
      `SELECT * FROM strategy_purchases
       WHERE user_id = $1
         AND strategy_id = $2
         AND status = 'active'
         AND posts_remaining > 0
       LIMIT 1`,
      [userId, strategyId]
    );

    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error checking strategy access:', error);
    return null;
  }
};

/**
 * Helper function to get all accessible strategies for a user
 *
 * @param {number} userId - User ID
 * @returns {Promise<Array>} Array of strategy IDs user has access to
 */
export const getUserAccessibleStrategies = async (userId) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT strategy_id FROM strategy_purchases
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );

    return result.rows.map(row => row.strategy_id);
  } catch (error) {
    console.error('Error getting accessible strategies:', error);
    return [];
  }
};

export default {
  checkStrategyAccess,
  checkBundleAccess,
  hasStrategyAccess,
  getUserAccessibleStrategies
};
