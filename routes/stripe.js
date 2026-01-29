import express from 'express';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import db from '../services/database.js';
import leadsService from '../services/leads.js';
import emailService from '../services/email.js';
import strategyWebhooks from '../services/strategy-subscription-webhooks.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Create Checkout Session
 * POST /api/v1/stripe/create-checkout-session
 */
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { priceId, planType } = req.body;
    const userId = req.user.userId;
    const userEmail = req.user.email;

    if (!priceId) {
      return res.status(400).json({
        success: false,
        error: 'Missing priceId'
      });
    }

    console.log(`Creating checkout session for user ${userId}, priceId: ${priceId}, planType: ${planType}`);

    // Determine success/cancel URLs based on environment
    // Use FRONTEND_URL env variable if set, otherwise use default
    let baseUrl = process.env.FRONTEND_URL || (
      process.env.NODE_ENV === 'production'
        ? 'https://automatemyblog.com'
        : 'http://localhost:3000'
    );

    // Clean up baseUrl - trim whitespace and remove trailing slash
    baseUrl = baseUrl.trim().replace(/\/$/, '');

    const successUrl = `${baseUrl}/dashboard?payment=success`;
    const cancelUrl = `${baseUrl}/dashboard?payment=cancelled`;

    console.log(`Using frontend URL for redirects: ${baseUrl}`);
    console.log(`Success URL: ${successUrl}`);
    console.log(`Cancel URL: ${cancelUrl}`);

    const session = await stripe.checkout.sessions.create({
      customer_email: userEmail,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: planType === 'one_time' ? 'payment' : 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: userId,
        priceId: priceId,
        planType: planType
      }
    });

    console.log(`✅ Checkout session created: ${session.id}`);

    res.json({
      success: true,
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create checkout session',
      message: error.message
    });
  }
});

/**
 * Stripe Webhook Handler
 * POST /api/v1/stripe/webhook
 * Note: Raw body parsing is handled globally in index.js for this route
 */
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`📨 Webhook received: ${event.type}`);

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object);
      break;
    case 'customer.subscription.created':
      await handleSubscriptionCreated(event.data.object);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object);
      break;
    case 'invoice.payment_succeeded':
      await handlePaymentSucceeded(event.data.object);
      break;
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

/**
 * Handle successful checkout completion
 */
async function handleCheckoutCompleted(session) {
  console.log(`✅ Checkout completed: ${session.id}`);

  // Check if this is a strategy subscription (individual or bundle)
  if (strategyWebhooks.isStrategySubscription(session)) {
    console.log('🎯 Strategy subscription detected, delegating to strategy webhook handler');
    await strategyWebhooks.handleStrategyCheckoutCompleted(session);
    return; // Early return - strategy subscriptions handled separately
  }

  const userId = session.metadata.userId;
  const priceId = session.metadata.priceId;
  const planType = session.metadata.planType;

  if (!userId) {
    console.error('❌ No userId in session metadata');
    return;
  }

  try {
    if (planType === 'one_time') {
      // One-time purchase: Add credits to proper tables
      console.log(`💰 One-time purchase: Adding 1 credit to user ${userId}`);

      // 1. Record the charge in pay_per_use_charges
      const chargeResult = await db.query(`
        INSERT INTO pay_per_use_charges (
          user_id,
          feature_type,
          unit_price,
          quantity,
          total_amount,
          charged_at
        ) VALUES (
          $1, 'blog_post', 15.00, 1, 15.00, NOW()
        ) RETURNING id
      `, [userId]);

      const chargeId = chargeResult.rows[0].id;

      // 2. Create credit in user_credits table
      await db.query(`
        INSERT INTO user_credits (
          user_id,
          source_type,
          source_id,
          source_description,
          quantity,
          value_usd,
          status,
          priority,
          created_at
        ) VALUES (
          $1, 'purchase', $2, 'Single Post Purchase', 1, 15.00, 'active', 100, NOW()
        )
      `, [userId, chargeId]);

      console.log(`✅ Added 1 purchased credit to user ${userId}`);

      // Track payment event for analytics funnel
      try {
        await db.query(`
          INSERT INTO user_activity_events (
            id, user_id, event_type, conversion_funnel_step,
            revenue_attributed, event_data, timestamp
          ) VALUES (
            $1, $2, 'payment_success', 'payment_success',
            15.00, $3, NOW()
          )
        `, [
          uuidv4(),
          userId,
          JSON.stringify({ priceId, sessionId: session.id, amount: 15.00, type: 'one_time' })
        ]);
        console.log(`📊 Analytics event tracked: payment_success (one-time purchase)`);

        // Track first payment for lead funnel
        try {
          const leadResult = await db.query(`
            SELECT wl.id, wl.session_id
            FROM website_leads wl
            WHERE wl.converted_to_user_id = $1
            ORDER BY wl.created_at DESC
            LIMIT 1
          `, [userId]);

          if (leadResult.rows[0]) {
            await leadsService.trackConversionStep(
              leadResult.rows[0].id,
              'first_payment',
              {
                amount: 15.00,
                payment_type: 'one_time',
                price_id: priceId,
                timestamp: new Date().toISOString()
              },
              leadResult.rows[0].session_id
            );
            console.log(`📊 Lead conversion tracked: first_payment`);
          }
        } catch (leadTrackError) {
          console.error(`⚠️ Failed to track lead conversion:`, leadTrackError.message);
          // Don't throw - tracking failure shouldn't block payment processing
        }
      } catch (eventError) {
        console.error(`⚠️ Failed to track analytics event:`, eventError.message);
        // Don't throw - analytics failure shouldn't block payment processing
      }
    } else {
      // Subscription: Create or update subscription record
      const planName = getPlanNameFromPriceId(priceId);
      console.log(`📋 Subscription purchase: ${planName} for user ${userId}`);

      // Get or create Stripe customer ID
      let stripeCustomerId = session.customer;

      // Get user's organization
      const orgResult = await db.query(`
        SELECT organization_id FROM organization_members
        WHERE user_id = $1
        LIMIT 1
      `, [userId]);

      const organizationId = orgResult.rows[0]?.organization_id;

      // Check if subscription already exists
      const existingSub = await db.query(`
        SELECT id FROM subscriptions
        WHERE user_id = $1 AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1
      `, [userId]);

      if (existingSub.rows.length > 0) {
        // Update existing subscription
        await db.query(`
          UPDATE subscriptions
          SET
            plan_name = $1,
            stripe_subscription_id = $2,
            stripe_customer_id = $3,
            current_period_start = NOW(),
            current_period_end = NOW() + INTERVAL '1 month',
            updated_at = NOW()
          WHERE id = $4
        `, [planName, session.subscription, stripeCustomerId, existingSub.rows[0].id]);

        console.log(`✅ Updated subscription for user ${userId} to ${planName}`);

        // CRITICAL: Delete old unused subscription credits when upgrading
        await db.query(`
          DELETE FROM user_credits
          WHERE user_id = $1
            AND source_type = 'subscription'
            AND status = 'active'
        `, [userId]);

        console.log(`🗑️ Deleted old subscription credits for user ${userId}`);
      } else {
        // Create new subscription
        await db.query(`
          INSERT INTO subscriptions (
            user_id,
            organization_id,
            plan_name,
            status,
            stripe_subscription_id,
            stripe_customer_id,
            current_period_start,
            current_period_end,
            created_at
          ) VALUES (
            $1, $2, $3, 'active', $4, $5,
            NOW(),
            NOW() + INTERVAL '1 month',
            NOW()
          )
        `, [userId, organizationId, planName, session.subscription, stripeCustomerId]);

        console.log(`✅ Created subscription for user ${userId}`);
      }

      // Create individual credits for limited subscription plans
      const credits = getPlanCredits(planName);
      console.log(`📊 Plan ${planName} should receive ${credits} credits`);

      let subscriptionId = existingSub.rows[0]?.id;

      // Get the subscription ID if we just created it
      if (!subscriptionId) {
        const newSubResult = await db.query(`
          SELECT id FROM subscriptions
          WHERE user_id = $1 AND stripe_subscription_id = $2
          LIMIT 1
        `, [userId, session.subscription]);
        subscriptionId = newSubResult.rows[0]?.id;
      }

      console.log(`🔑 Subscription ID: ${subscriptionId}`);

      // For limited plans (not Pro/unlimited), create individual credit records
      if (credits > 0 && credits < 999999 && subscriptionId) {
        console.log(`💳 Creating ${credits} credits for ${planName} plan...`);

        for (let i = 0; i < credits; i++) {
          await db.query(`
            INSERT INTO user_credits (
              user_id,
              source_type,
              source_id,
              source_description,
              quantity,
              value_usd,
              status,
              priority,
              expires_at,
              created_at
            ) VALUES (
              $1, 'subscription', $2, $3, 1, $4, 'active', 50,
              NOW() + INTERVAL '1 month',
              NOW()
            )
          `, [
            userId,
            subscriptionId,
            `${planName} Plan - Monthly Allocation`,
            planName === 'Starter' ? 5.00 : planName === 'Professional' ? 2.50 : 0.00
          ]);
        }
        console.log(`✅ Created ${credits} subscription credits for user ${userId}`);

        // Verify credits were created
        const verifyResult = await db.query(`
          SELECT COUNT(*) as credit_count
          FROM user_credits
          WHERE user_id = $1
            AND source_type = 'subscription'
            AND status = 'active'
        `, [userId]);

        const actualCredits = parseInt(verifyResult.rows[0]?.credit_count || 0);
        console.log(`🔍 Verification: User ${userId} now has ${actualCredits} active subscription credits`);

        if (actualCredits !== credits) {
          console.error(`⚠️ WARNING: Expected ${credits} credits but found ${actualCredits}!`);
        }
      } else if (credits >= 999999) {
        console.log(`✅ User ${userId} has unlimited plan (${planName}) - no individual credits needed`);
      } else {
        console.error(`❌ ERROR: Invalid credit count (${credits}) or missing subscription ID for user ${userId}`);
      }

      // Reset usage tracking for the new billing period
      const currentMonth = new Date();
      const periodStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const periodEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

      await db.query(`
        INSERT INTO user_usage_tracking (
          user_id,
          feature_type,
          period_start,
          period_end,
          usage_count,
          limit_count,
          created_at
        ) VALUES (
          $1, 'generation', $2, $3, 0, $4, NOW()
        )
        ON CONFLICT (user_id, feature_type, period_start)
        DO UPDATE SET
          usage_count = 0,
          limit_count = $4,
          updated_at = NOW()
      `, [userId, periodStart, periodEnd, credits]);

      console.log(`✅ Reset usage tracking for user ${userId}`);

      // Track subscription event for analytics funnel
      try {
        await db.query(`
          INSERT INTO user_activity_events (
            id, user_id, event_type, conversion_funnel_step,
            event_data, timestamp
          ) VALUES (
            $1, $2, 'subscription_started', 'active_subscriber',
            $3, NOW()
          )
        `, [
          uuidv4(),
          userId,
          JSON.stringify({
            planName,
            subscriptionId: session.subscription,
            credits,
            sessionId: session.id
          })
        ]);
        console.log(`📊 Analytics event tracked: subscription_started (active_subscriber) - ${planName}`);

        // Track first payment for lead funnel
        try {
          const leadResult = await db.query(`
            SELECT wl.id, wl.session_id
            FROM website_leads wl
            WHERE wl.converted_to_user_id = $1
            ORDER BY wl.created_at DESC
            LIMIT 1
          `, [userId]);

          if (leadResult.rows[0]) {
            await leadsService.trackConversionStep(
              leadResult.rows[0].id,
              'first_payment',
              {
                plan_name: planName,
                payment_type: 'subscription',
                subscription_id: session.subscription,
                credits,
                timestamp: new Date().toISOString()
              },
              leadResult.rows[0].session_id
            );
            console.log(`📊 Lead conversion tracked: first_payment (subscription)`);
          }
        } catch (leadTrackError) {
          console.error(`⚠️ Failed to track lead conversion:`, leadTrackError.message);
          // Don't throw - tracking failure shouldn't block subscription processing
        }
      } catch (eventError) {
        console.error(`⚠️ Failed to track analytics event:`, eventError.message);
        // Don't throw - analytics failure shouldn't block subscription processing
      }

      // Send subscription confirmation email (async, don't block)
      emailService.sendSubscriptionConfirmation(userId, session.subscription)
        .then(() => console.log(`✅ Subscription confirmation email sent to user ${userId}`))
        .catch(err => console.error('❌ Failed to send subscription confirmation email:', err));
    }

    // Send payment received email for all purchases (one-time or subscription)
    const amount = session.amount_total ? (session.amount_total / 100) : 0; // Convert from cents
    emailService.sendPaymentReceived(userId, amount, session.id)
      .then(() => console.log(`✅ Payment received email sent to user ${userId}`))
      .catch(err => console.error('❌ Failed to send payment received email:', err));

  } catch (error) {
    console.error('❌ Error handling checkout completion:', error);
  }
}

/**
 * Handle subscription created
 */
async function handleSubscriptionCreated(subscription) {
  console.log(`📋 Subscription created: ${subscription.id}`);
  // Additional handling if needed
}

/**
 * Handle subscription updated
 */
async function handleSubscriptionUpdated(subscription) {
  console.log(`📋 Subscription updated: ${subscription.id}`);

  // Handle strategy subscription updates (quota resets on renewal)
  await strategyWebhooks.handleStrategySubscriptionUpdated(subscription);

  try {
    // Get current subscription from database to detect plan changes
    const currentSubResult = await db.query(`
      SELECT user_id, plan_name
      FROM subscriptions
      WHERE stripe_subscription_id = $1
    `, [subscription.id]);

    if (currentSubResult.rows.length > 0) {
      const userId = currentSubResult.rows[0].user_id;
      const oldPlan = currentSubResult.rows[0].plan_name;

      // Get new plan name from Stripe subscription
      const newPriceId = subscription.items.data[0]?.price.id;
      const newPlan = getPlanNameFromPriceId(newPriceId);

      // If plan changed, send upgrade email
      if (oldPlan !== newPlan && newPlan !== 'Unknown') {
        emailService.sendSubscriptionUpgraded(userId, oldPlan, newPlan)
          .then(() => console.log(`✅ Subscription upgraded email sent to user ${userId}`))
          .catch(err => console.error('❌ Failed to send subscription upgraded email:', err));
      }

      // Update subscription in database
      await db.query(`
        UPDATE subscriptions
        SET
          plan_name = $1,
          current_period_start = to_timestamp($2),
          current_period_end = to_timestamp($3),
          updated_at = NOW()
        WHERE stripe_subscription_id = $4
      `, [newPlan, subscription.current_period_start, subscription.current_period_end, subscription.id]);

      console.log(`✅ Updated subscription in database: ${subscription.id}`);
    }
  } catch (error) {
    console.error('❌ Error handling subscription update:', error);
  }
}

/**
 * Handle subscription deleted/cancelled
 */
async function handleSubscriptionDeleted(subscription) {
  console.log(`❌ Subscription deleted: ${subscription.id}`);

  // Handle strategy subscription cancellations
  await strategyWebhooks.handleStrategySubscriptionDeleted(subscription);

  try {
    // Get userId before marking as cancelled
    const subResult = await db.query(`
      SELECT user_id FROM subscriptions
      WHERE stripe_subscription_id = $1
    `, [subscription.id]);

    const userId = subResult.rows[0]?.user_id;

    // Mark subscription as cancelled in database
    await db.query(`
      UPDATE subscriptions
      SET
        status = 'cancelled',
        updated_at = NOW()
      WHERE stripe_subscription_id = $1
    `, [subscription.id]);

    console.log(`✅ Marked subscription as cancelled: ${subscription.id}`);

    // Send cancellation confirmation email
    if (userId) {
      const reason = subscription.cancellation_details?.reason || 'user_cancelled';
      emailService.sendSubscriptionCancelled(userId, reason)
        .then(() => console.log(`✅ Subscription cancelled email sent to user ${userId}`))
        .catch(err => console.error('❌ Failed to send subscription cancelled email:', err));
    }
  } catch (error) {
    console.error('❌ Error handling subscription deletion:', error);
  }
}

/**
 * Handle successful payment (for recurring subscriptions)
 */
async function handlePaymentSucceeded(invoice) {
  console.log(`💰 Payment succeeded: ${invoice.id}`);

  try {
    // Get user ID from Stripe customer
    if (invoice.customer) {
      const subResult = await db.query(`
        SELECT user_id FROM subscriptions
        WHERE stripe_customer_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [invoice.customer]);

      const userId = subResult.rows[0]?.user_id;

      if (userId) {
        const amount = invoice.amount_paid ? (invoice.amount_paid / 100) : 0; // Convert from cents
        emailService.sendPaymentReceived(userId, amount, invoice.id)
          .then(() => console.log(`✅ Payment received email sent to user ${userId}`))
          .catch(err => console.error('❌ Failed to send payment received email:', err));
      }
    }
  } catch (error) {
    console.error('❌ Error handling payment succeeded:', error);
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice) {
  console.log(`⚠️ Payment failed: ${invoice.id}`);

  try {
    // Get user ID from Stripe customer
    if (invoice.customer) {
      const subResult = await db.query(`
        SELECT user_id FROM subscriptions
        WHERE stripe_customer_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [invoice.customer]);

      const userId = subResult.rows[0]?.user_id;

      if (userId) {
        const amount = invoice.amount_due ? (invoice.amount_due / 100) : 0; // Convert from cents

        // Send alert to admin
        emailService.sendPaymentFailedAlert(userId, invoice.id, amount)
          .then(() => console.log(`✅ Payment failed alert sent to admin for user ${userId}`))
          .catch(err => console.error('❌ Failed to send payment failed alert:', err));
      }
    }
  } catch (error) {
    console.error('❌ Error handling payment failed:', error);
  }
}

/**
 * Helper: Get plan name from price ID
 */
function getPlanNameFromPriceId(priceId) {
  const priceMap = {
    [process.env.STRIPE_PRICE_CREATOR]: 'Starter',
    [process.env.STRIPE_PRICE_PROFESSIONAL]: 'Professional'
  };
  return priceMap[priceId] || 'Unknown';
}

/**
 * Helper: Get credit limit for plan
 */
function getPlanCredits(planName) {
  const creditMap = {
    'Starter': 4,
    'Professional': 8,
    'Pro': 999999, // Unlimited (legacy)
    'Free': 1
  };
  return creditMap[planName] || 0;
}

export default router;
