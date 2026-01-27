import db from '../services/database.js';

/**
 * Manual subscription creation for failed Stripe webhook
 * Run with: node scripts/manual-subscription-creation.js
 */

async function createManualSubscription() {
  try {
    // CONFIGURE THESE VALUES:
    const userEmail = 'james@frankel.tv'; // Change if using james+test@frankel.tv
    const stripeSubId = 'sub_1StCEW6S2Lijk9r3TDWNP2Lv'; // Get from Stripe Dashboard
    const stripeCustomerId = 'cus_Tqu2CrvY50dZXC'; // Get from Stripe Dashboard
    const planName = 'Starter'; // Creator plan = Starter in backend
    const credits = 4; // Starter plan gives 4 credits

    console.log('🔧 Manual Subscription Creation');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // 1. Get user ID
    console.log(`1️⃣ Looking up user: ${userEmail}`);
    const userResult = await db.query(`
      SELECT id FROM users WHERE email = $1
    `, [userEmail]);

    if (userResult.rows.length === 0) {
      console.error('❌ User not found');
      process.exit(1);
    }

    const userId = userResult.rows[0].id;
    console.log(`✅ Found user: ${userId}\n`);

    // 2. Check if subscription already exists
    console.log('2️⃣ Checking for existing subscription...');
    const existingSubResult = await db.query(`
      SELECT id, plan_name, status FROM subscriptions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId]);

    if (existingSubResult.rows.length > 0) {
      const existing = existingSubResult.rows[0];
      console.log(`⚠️  Existing subscription found: ${existing.plan_name} (${existing.status})`);
      console.log('   This script will create a new subscription record.');
      console.log('   If you want to update the existing one instead, edit this script.\n');
    } else {
      console.log('✅ No existing subscription\n');
    }

    // 3. Get organization ID (if exists)
    console.log('3️⃣ Looking up organization membership...');
    const orgResult = await db.query(`
      SELECT organization_id FROM organization_members
      WHERE user_id = $1
      LIMIT 1
    `, [userId]);

    const organizationId = orgResult.rows[0]?.organization_id || null;
    if (organizationId) {
      console.log(`✅ Found organization: ${organizationId}\n`);
    } else {
      console.log('⚠️  No organization found (user may not have one)\n');
    }

    // 4. Create subscription
    console.log('4️⃣ Creating subscription record...');
    const subResult = await db.query(`
      INSERT INTO subscriptions (
        user_id,
        organization_id,
        plan_name,
        status,
        stripe_subscription_id,
        stripe_customer_id,
        current_period_start,
        current_period_end,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, 'active', $4, $5,
        NOW(), NOW() + INTERVAL '1 month', NOW(), NOW()
      ) RETURNING id, created_at, current_period_end
    `, [userId, organizationId, planName, stripeSubId, stripeCustomerId]);

    const subscription = subResult.rows[0];
    const subscriptionId = subscription.id;
    console.log(`✅ Created subscription: ${subscriptionId}`);
    console.log(`   Plan: ${planName}`);
    console.log(`   Status: active`);
    console.log(`   Period ends: ${subscription.current_period_end}\n`);

    // 5. Create 4 credits
    console.log(`5️⃣ Creating ${credits} credit records...`);
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
          $1, 'subscription', $2, 'Starter Plan - Monthly Allocation',
          1, 5.00, 'active', 50,
          NOW() + INTERVAL '1 month', NOW()
        )
      `, [userId, subscriptionId]);
      console.log(`   ✅ Created credit ${i + 1}/${credits}`);
    }
    console.log();

    // 6. Verify credits were created
    console.log('6️⃣ Verifying credits...');
    const verifyResult = await db.query(`
      SELECT COUNT(*) as credit_count
      FROM user_credits
      WHERE user_id = $1
        AND source_type = 'subscription'
        AND status = 'active'
    `, [userId]);

    const actualCredits = parseInt(verifyResult.rows[0]?.credit_count || 0);
    console.log(`✅ Verification: User has ${actualCredits} active subscription credits\n`);

    if (actualCredits !== credits) {
      console.error(`⚠️  WARNING: Expected ${credits} credits but found ${actualCredits}!`);
    }

    // 7. Update usage tracking
    console.log('7️⃣ Updating usage tracking...');
    const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const periodEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);

    await db.query(`
      INSERT INTO user_usage_tracking (
        user_id, feature_type, period_start, period_end,
        usage_count, limit_count, created_at
      ) VALUES ($1, 'generation', $2, $3, 0, $4, NOW())
      ON CONFLICT (user_id, feature_type, period_start)
      DO UPDATE SET
        usage_count = 0,
        limit_count = $4,
        updated_at = NOW()
    `, [userId, periodStart, periodEnd, credits]);

    console.log(`✅ Usage tracking updated (limit: ${credits})\n`);

    // 8. Final summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ SUCCESS! Manual subscription created');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Summary:');
    console.log(`  User: ${userEmail}`);
    console.log(`  Plan: ${planName} (${credits} posts/month)`);
    console.log(`  Subscription ID: ${subscriptionId}`);
    console.log(`  Stripe Subscription: ${stripeSubId}`);
    console.log(`  Stripe Customer: ${stripeCustomerId}`);
    console.log(`  Credits: ${actualCredits} active`);
    console.log(`  Period ends: ${subscription.current_period_end}\n`);

    console.log('Next Steps:');
    console.log('  1. Verify in frontend: User should see "4 posts left"');
    console.log('  2. Test: Try generating a blog post');
    console.log('  3. Monitor: Check Stripe webhooks for future renewals\n');

  } catch (error) {
    console.error('❌ Error creating subscription:', error);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

createManualSubscription();
