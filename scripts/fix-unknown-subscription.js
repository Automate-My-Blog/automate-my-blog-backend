import db from '../services/database.js';

/**
 * Fix subscription that was created with plan_name='Unknown'
 * Update it to 'Starter' and create the missing 4 credits
 */

async function fixSubscription() {
  try {
    const userEmail = 'james@frankel.tv';
    const stripeSubId = 'sub_1StCqu6S2Lijk9r3UKh3KzZu';

    console.log('🔧 Fixing Unknown Subscription\n');

    // 1. Get user ID
    const userResult = await db.query(`
      SELECT id FROM users WHERE email = $1
    `, [userEmail]);

    if (userResult.rows.length === 0) {
      console.error('❌ User not found');
      process.exit(1);
    }

    const userId = userResult.rows[0].id;
    console.log(`✅ Found user: ${userId}\n`);

    // 2. Find the subscription
    const subResult = await db.query(`
      SELECT id, plan_name, status FROM subscriptions
      WHERE user_id = $1 AND stripe_subscription_id = $2
    `, [userId, stripeSubId]);

    if (subResult.rows.length === 0) {
      console.error('❌ Subscription not found');
      process.exit(1);
    }

    const subscription = subResult.rows[0];
    const subscriptionId = subscription.id;
    console.log(`📋 Found subscription: ${subscriptionId}`);
    console.log(`   Current plan: ${subscription.plan_name}`);
    console.log(`   Status: ${subscription.status}\n`);

    // 3. Update subscription to Starter
    await db.query(`
      UPDATE subscriptions
      SET plan_name = 'Starter',
          updated_at = NOW()
      WHERE id = $1
    `, [subscriptionId]);

    console.log(`✅ Updated plan_name to 'Starter'\n`);

    // 4. Check if credits already exist
    const existingCredits = await db.query(`
      SELECT COUNT(*) as count
      FROM user_credits
      WHERE user_id = $1
        AND source_type = 'subscription'
        AND source_id = $2
    `, [userId, subscriptionId]);

    const creditCount = parseInt(existingCredits.rows[0].count);
    console.log(`💳 Existing subscription credits: ${creditCount}`);

    if (creditCount >= 4) {
      console.log('✅ Credits already exist, skipping creation\n');
    } else {
      const creditsToCreate = 4 - creditCount;
      console.log(`📝 Creating ${creditsToCreate} missing credits...\n`);

      for (let i = 0; i < creditsToCreate; i++) {
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
        console.log(`   ✅ Created credit ${i + 1}/${creditsToCreate}`);
      }
    }

    // 5. Verify final state
    const finalCheck = await db.query(`
      SELECT COUNT(*) as count
      FROM user_credits
      WHERE user_id = $1
        AND source_type = 'subscription'
        AND status = 'active'
    `, [userId]);

    const finalCount = parseInt(finalCheck.rows[0].count);
    console.log(`\n🔍 Final verification: ${finalCount} active subscription credits`);

    // 6. Update usage tracking
    const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const periodEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);

    await db.query(`
      INSERT INTO user_usage_tracking (
        user_id, feature_type, period_start, period_end,
        usage_count, limit_count, created_at
      ) VALUES ($1, 'generation', $2, $3, 0, 4, NOW())
      ON CONFLICT (user_id, feature_type, period_start)
      DO UPDATE SET
        limit_count = 4,
        updated_at = NOW()
    `, [userId, periodStart, periodEnd]);

    console.log(`✅ Updated usage tracking\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ SUCCESS! Subscription fixed');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('User should now see "4 posts left" in dashboard');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

fixSubscription();
