/**
 * Strategy Subscription Webhook Handlers
 *
 * Handles Stripe webhook events for strategy subscriptions and bundles:
 * - checkout.session.completed: Create subscription records
 * - customer.subscription.updated: Reset post quotas on renewal
 * - customer.subscription.deleted: Mark subscriptions as cancelled
 */

import db from './database.js';

/**
 * Handle strategy subscription checkout completion
 * Called from main webhook handler when session metadata indicates strategy subscription
 *
 * @param {Object} session - Stripe checkout session object
 */
export async function handleStrategyCheckoutCompleted(session) {
  try {
    const metadata = session.metadata;

    // Check if this is a bundle subscription
    if (metadata.is_bundle === 'true') {
      console.log('📦 Processing bundle subscription checkout...');
      await handleBundleSubscriptionCreated(session);
    }
    // Check if this is an individual strategy subscription
    else if (metadata.strategy_id && metadata.billing_interval) {
      console.log('🎯 Processing individual strategy subscription checkout...');
      await handleIndividualStrategySubscriptionCreated(session);
    }
  } catch (error) {
    console.error('❌ Error handling strategy checkout:', error);
    throw error;
  }
}

/**
 * Create bundle subscription record and link all user's strategies
 */
async function handleBundleSubscriptionCreated(session) {
  const metadata = session.metadata;
  const userId = metadata.user_id;

  const client = await db.pool.getClient();
  try {
    await client.query('BEGIN');

    // Create bundle subscription record
    const bundleResult = await client.query(
      `INSERT INTO bundle_subscriptions (
        user_id,
        strategy_count,
        billing_interval,
        individual_monthly_total,
        bundle_monthly_price,
        bundle_annual_price,
        amount_paid,
        monthly_discount_percent,
        annual_discount_percent,
        total_discount_percent,
        stripe_subscription_id,
        stripe_customer_id,
        status,
        next_billing_date,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', NOW() + INTERVAL '1 month', NOW())
      RETURNING id`,
      [
        userId,
        parseInt(metadata.strategy_count),
        metadata.billing_interval,
        parseFloat(metadata.individual_monthly_total || 0),
        parseFloat(metadata.bundle_monthly_price),
        metadata.bundle_annual_price ? parseFloat(metadata.bundle_annual_price) : null,
        session.amount_total / 100, // Convert from cents
        10.00, // Monthly discount
        metadata.billing_interval === 'annual' ? 10.00 : 0, // Annual discount
        parseFloat(metadata.total_discount_percent || 0),
        session.subscription,
        session.customer
      ]
    );

    const bundleId = bundleResult.rows[0].id;
    console.log(`✅ Created bundle subscription ${bundleId} for user ${userId}`);

    // Get all user's strategies
    const strategiesResult = await client.query(
      'SELECT id FROM audiences WHERE user_id = $1',
      [userId]
    );

    // Create strategy_purchases records for each strategy linked to bundle
    for (const strategy of strategiesResult.rows) {
      await client.query(
        `INSERT INTO strategy_purchases (
          user_id,
          strategy_id,
          bundle_subscription_id,
          billing_interval,
          amount_paid,
          is_bundle,
          posts_recommended,
          posts_maximum,
          posts_remaining,
          stripe_subscription_id,
          stripe_customer_id,
          status,
          next_billing_date,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, true, 8, 40, 40, $6, $7, 'active', NOW() + INTERVAL '1 month', NOW())`,
        [
          userId,
          strategy.id,
          bundleId,
          metadata.billing_interval,
          0, // No individual charge, part of bundle
          session.subscription,
          session.customer
        ]
      );
    }

    await client.query('COMMIT');
    console.log(`✅ Linked ${strategiesResult.rows.length} strategies to bundle subscription`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to create bundle subscription:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Create individual strategy subscription record
 */
async function handleIndividualStrategySubscriptionCreated(session) {
  const metadata = session.metadata;
  const userId = metadata.user_id;
  const strategyId = metadata.strategy_id;

  try {
    await db.query(
      `INSERT INTO strategy_purchases (
        user_id,
        strategy_id,
        billing_interval,
        amount_paid,
        is_bundle,
        posts_recommended,
        posts_maximum,
        posts_remaining,
        stripe_subscription_id,
        stripe_payment_intent_id,
        stripe_customer_id,
        status,
        next_billing_date,
        created_at
      ) VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, $9, $10, 'active', NOW() + INTERVAL '1 month', NOW())`,
      [
        userId,
        strategyId,
        metadata.billing_interval,
        session.amount_total / 100, // Convert from cents
        parseInt(metadata.posts_recommended || 8),
        parseInt(metadata.posts_maximum || 40),
        parseInt(metadata.posts_maximum || 40), // Start with full quota
        session.subscription,
        session.payment_intent,
        session.customer
      ]
    );

    console.log(`✅ Created individual strategy subscription for strategy ${strategyId}, user ${userId}`);

  } catch (error) {
    console.error('❌ Failed to create individual strategy subscription:', error);
    throw error;
  }
}

/**
 * Handle subscription renewal - reset post quotas
 * Called when customer.subscription.updated event fires
 *
 * @param {Object} subscription - Stripe subscription object
 */
export async function handleStrategySubscriptionUpdated(subscription) {
  try {
    // Check if billing cycle just renewed (current_period_start recently updated)
    if (subscription.status === 'active') {
      console.log(`🔄 Resetting post quotas for subscription ${subscription.id}`);

      const result = await db.query(
        `UPDATE strategy_purchases
         SET
           posts_remaining = posts_maximum,
           posts_used = 0,
           next_billing_date = to_timestamp($1),
           updated_at = NOW()
         WHERE stripe_subscription_id = $2
         RETURNING id, strategy_id, posts_maximum`,
        [subscription.current_period_end, subscription.id]
      );

      if (result.rows.length > 0) {
        console.log(`✅ Reset quotas for ${result.rows.length} strategy subscription(s)`);
        result.rows.forEach(row => {
          console.log(`  - Strategy ${row.strategy_id}: Reset to ${row.posts_maximum} posts`);
        });
      }

      // Also update bundle subscription next billing date
      await db.query(
        `UPDATE bundle_subscriptions
         SET
           next_billing_date = to_timestamp($1),
           updated_at = NOW()
         WHERE stripe_subscription_id = $2`,
        [subscription.current_period_end, subscription.id]
      );
    }
  } catch (error) {
    console.error('❌ Error updating strategy subscription:', error);
    throw error;
  }
}

/**
 * Handle subscription cancellation
 * Called when customer.subscription.deleted event fires
 *
 * @param {Object} subscription - Stripe subscription object
 */
export async function handleStrategySubscriptionDeleted(subscription) {
  try {
    console.log(`🗑️ Cancelling subscriptions for Stripe subscription ${subscription.id}`);

    const client = await db.pool.getClient();
    try {
      await client.query('BEGIN');

      // Mark strategy purchases as cancelled
      const strategyResult = await client.query(
        `UPDATE strategy_purchases
         SET
           status = 'cancelled',
           cancelled_at = NOW(),
           updated_at = NOW()
         WHERE stripe_subscription_id = $1
         RETURNING id, strategy_id, is_bundle`,
        [subscription.id]
      );

      console.log(`✅ Cancelled ${strategyResult.rows.length} strategy purchase(s)`);

      // If any were bundle subscriptions, also cancel the bundle record
      const bundleRows = strategyResult.rows.filter(row => row.is_bundle);
      if (bundleRows.length > 0) {
        await client.query(
          `UPDATE bundle_subscriptions
           SET
             status = 'cancelled',
             cancelled_at = NOW(),
             updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [subscription.id]
        );
        console.log(`✅ Cancelled bundle subscription`);
      }

      await client.query('COMMIT');

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Error deleting strategy subscription:', error);
    throw error;
  }
}

/**
 * Check if a session is for strategy subscription
 * @param {Object} session - Stripe checkout session
 * @returns {boolean}
 */
export function isStrategySubscription(session) {
  const metadata = session.metadata || {};
  return metadata.is_bundle === 'true' ||
         (metadata.strategy_id && metadata.billing_interval);
}

export default {
  handleStrategyCheckoutCompleted,
  handleStrategySubscriptionUpdated,
  handleStrategySubscriptionDeleted,
  isStrategySubscription
};
