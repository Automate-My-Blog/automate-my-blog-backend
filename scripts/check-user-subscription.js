import db from '../services/database.js';

/**
 * Check subscription and credits for specific users
 */

async function checkSubscriptions() {
  try {
    console.log('🔍 Checking database for james@frankel.tv and james+test@frankel.tv\n');

    // 1. Get user IDs
    const userResult = await db.query(`
      SELECT id, email, created_at
      FROM users
      WHERE email IN ('james@frankel.tv', 'james+test@frankel.tv')
      ORDER BY email
    `);

    console.log('📧 Users found:', userResult.rows.length);
    userResult.rows.forEach(user => {
      console.log(`  - ${user.email}: ${user.id}`);
    });
    console.log();

    if (userResult.rows.length === 0) {
      console.log('❌ No users found with those emails');
      process.exit(0);
    }

    const userIds = userResult.rows.map(u => u.id);

    // 2. Check subscriptions
    const subResult = await db.query(`
      SELECT
        id, user_id, plan_name, status,
        stripe_subscription_id, stripe_customer_id,
        current_period_start, current_period_end,
        created_at, updated_at
      FROM subscriptions
      WHERE user_id = ANY($1::uuid[])
      ORDER BY created_at DESC
    `, [userIds]);

    console.log('📋 Subscriptions found:', subResult.rows.length);
    if (subResult.rows.length === 0) {
      console.log('  ⚠️  No subscriptions found for these users\n');
    } else {
      subResult.rows.forEach(sub => {
        console.log(`  - Plan: ${sub.plan_name} (${sub.status})`);
        console.log(`    Stripe Sub ID: ${sub.stripe_subscription_id}`);
        console.log(`    Stripe Customer ID: ${sub.stripe_customer_id}`);
        console.log(`    Period: ${sub.current_period_start} → ${sub.current_period_end}`);
        console.log(`    Created: ${sub.created_at}`);
        console.log();
      });
    }

    // 3. Check credits
    const creditsResult = await db.query(`
      SELECT
        id, user_id, source_type, source_id,
        source_description, quantity, value_usd,
        status, priority, created_at, expires_at
      FROM user_credits
      WHERE user_id = ANY($1::uuid[])
      ORDER BY created_at DESC
      LIMIT 20
    `, [userIds]);

    console.log('💳 Credits found:', creditsResult.rows.length);
    if (creditsResult.rows.length === 0) {
      console.log('  ⚠️  No credits found for these users\n');
    } else {
      const grouped = {};
      creditsResult.rows.forEach(credit => {
        const key = `${credit.source_type}_${credit.status}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(credit);
      });

      Object.keys(grouped).forEach(key => {
        const [source, status] = key.split('_');
        console.log(`  ${source} (${status}): ${grouped[key].length} credits`);
        grouped[key].slice(0, 3).forEach(credit => {
          console.log(`    - ${credit.source_description}: $${credit.value_usd}`);
          console.log(`      Created: ${credit.created_at}, Expires: ${credit.expires_at || 'never'}`);
        });
      });
      console.log();
    }

    // 4. Check usage tracking
    const usageResult = await db.query(`
      SELECT
        id, user_id, feature_type,
        period_start, period_end,
        usage_count, limit_count, bonus_usage_count,
        created_at
      FROM user_usage_tracking
      WHERE user_id = ANY($1::uuid[])
      ORDER BY period_start DESC
      LIMIT 5
    `, [userIds]);

    console.log('📈 Usage Tracking Records:', usageResult.rows.length);
    if (usageResult.rows.length === 0) {
      console.log('  ⚠️  No usage tracking found\n');
    } else {
      usageResult.rows.forEach(usage => {
        console.log(`  - ${usage.feature_type}: ${usage.usage_count}/${usage.limit_count} used`);
        console.log(`    Period: ${usage.period_start} → ${usage.period_end}`);
        console.log(`    Bonus: ${usage.bonus_usage_count || 0}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

checkSubscriptions();
