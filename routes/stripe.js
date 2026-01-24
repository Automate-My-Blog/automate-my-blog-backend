import express from 'express';
import Stripe from 'stripe';
import db from '../services/database.js';

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
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
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
    }
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
  // Handle plan changes, etc.
}

/**
 * Handle subscription deleted/cancelled
 */
async function handleSubscriptionDeleted(subscription) {
  console.log(`❌ Subscription deleted: ${subscription.id}`);

  try {
    // Mark subscription as cancelled in database
    await db.query(`
      UPDATE subscriptions
      SET
        status = 'cancelled',
        updated_at = NOW()
      WHERE stripe_subscription_id = $1
    `, [subscription.id]);

    console.log(`✅ Marked subscription as cancelled: ${subscription.id}`);
  } catch (error) {
    console.error('❌ Error handling subscription deletion:', error);
  }
}

/**
 * Handle successful payment (for recurring subscriptions)
 */
async function handlePaymentSucceeded(invoice) {
  console.log(`💰 Payment succeeded: ${invoice.id}`);
  // Additional handling if needed (e.g., send receipt email)
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice) {
  console.log(`⚠️ Payment failed: ${invoice.id}`);
  // Handle payment failure (e.g., send notification email)
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
