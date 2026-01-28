import db from '../services/database.js';

/**
 * Diagnostic script to check user's subscription and credits
 * Run with: node scripts/diagnose-credits.js <user_email>
 */

const userEmail = process.argv[2];

if (!userEmail) {
  console.error('Usage: node scripts/diagnose-credits.js <user_email>');
  process.exit(1);
}

async function diagnose() {
  try {
    console.log(`\n🔍 Diagnosing credits for: ${userEmail}\n`);

    // 1. Get user ID
    const userResult = await db.query(`
      SELECT id, email FROM users WHERE email = $1
    `, [userEmail]);

    if (userResult.rows.length === 0) {
      console.log('❌ User not found');
      process.exit(1);
    }

    const userId = userResult.rows[0].id;
    console.log(`✅ User ID: ${userId}\n`);

    // 2. Check subscriptions
    console.log('📋 Subscriptions:');
    const subResult = await db.query(`
      SELECT
        id,
        plan_name,
        status,
        stripe_subscription_id,
        stripe_customer_id,
        current_period_start,
        current_period_end,
        created_at,
        updated_at
      FROM subscriptions
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);

    if (subResult.rows.length === 0) {
      console.log('  ⚠️  No subscriptions found');
    } else {
      subResult.rows.forEach((sub, i) => {
        console.log(`  ${i + 1}. Plan: ${sub.plan_name}`);
        console.log(`     Status: ${sub.status}`);
        console.log(`     Stripe Subscription ID: ${sub.stripe_subscription_id}`);
        console.log(`     Stripe Customer ID: ${sub.stripe_customer_id}`);
        console.log(`     Period: ${sub.current_period_start} → ${sub.current_period_end}`);
        console.log(`     Created: ${sub.created_at}`);
        console.log(`     Updated: ${sub.updated_at}`);
        console.log();
      });
    }

    // 3. Check plan_definitions
    console.log('📊 Plan Definitions:');
    const planDefsResult = await db.query(`
      SELECT name, monthly_limit, is_unlimited
      FROM plan_definitions
      ORDER BY name
    `);

    planDefsResult.rows.forEach(plan => {
      console.log(`  - ${plan.name}: ${plan.is_unlimited ? 'Unlimited' : plan.monthly_limit + ' posts'}`);
    });
    console.log();

    // 4. Check user_credits
    console.log('💳 User Credits:');
    const creditsResult = await db.query(`
      SELECT
        id,
        source_type,
        source_id,
        source_description,
        quantity,
        value_usd,
        status,
        priority,
        created_at,
        expires_at,
        used_at,
        used_for_type,
        used_for_id
      FROM user_credits
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);

    if (creditsResult.rows.length === 0) {
      console.log('  ⚠️  No credits found');
    } else {
      console.log(`  Total records: ${creditsResult.rows.length}\n`);

      const groupedByStatus = {};
      creditsResult.rows.forEach(credit => {
        if (!groupedByStatus[credit.status]) {
          groupedByStatus[credit.status] = [];
        }
        groupedByStatus[credit.status].push(credit);
      });

      Object.keys(groupedByStatus).forEach(status => {
        console.log(`  ${status.toUpperCase()} (${groupedByStatus[status].length}):`);
        groupedByStatus[status].forEach(credit => {
          console.log(`    - ID: ${credit.id}`);
          console.log(`      Source: ${credit.source_type} (${credit.source_description})`);
          console.log(`      Source ID: ${credit.source_id}`);
          console.log(`      Quantity: ${credit.quantity}, Value: $${credit.value_usd}`);
          console.log(`      Priority: ${credit.priority}`);
          console.log(`      Created: ${credit.created_at}`);
          if (credit.expires_at) console.log(`      Expires: ${credit.expires_at}`);
          if (credit.used_at) console.log(`      Used: ${credit.used_at}`);
          console.log();
        });
      });
    }

    // 5. Check usage tracking
    console.log('📈 Usage Tracking:');
    const usageResult = await db.query(`
      SELECT
        feature_type,
        period_start,
        period_end,
        usage_count,
        bonus_usage_count,
        bonus_source,
        limit_count
      FROM user_usage_tracking
      WHERE user_id = $1
      ORDER BY period_start DESC
      LIMIT 5
    `, [userId]);

    if (usageResult.rows.length === 0) {
      console.log('  ⚠️  No usage tracking found');
    } else {
      usageResult.rows.forEach(usage => {
        console.log(`  Period: ${usage.period_start} → ${usage.period_end}`);
        console.log(`  Feature: ${usage.feature_type}`);
        console.log(`  Usage: ${usage.usage_count}/${usage.limit_count}`);
        console.log(`  Bonus Usage: ${usage.bonus_usage_count} (source: ${usage.bonus_source})`);
        console.log();
      });
    }

    // 6. Run the actual getUserCredits logic
    console.log('🔄 Running getUserCredits() logic:\n');

    const subCheck = await db.query(`
      SELECT s.plan_name, pd.is_unlimited, s.current_period_end
      FROM subscriptions s
      JOIN plan_definitions pd ON pd.name = s.plan_name
      WHERE s.user_id = $1
        AND s.status = 'active'
        AND s.current_period_end > NOW()
      ORDER BY s.created_at DESC
      LIMIT 1
    `, [userId]);

    console.log('  Active subscription query result:');
    if (subCheck.rows.length === 0) {
      console.log('    ⚠️  No active subscription found (status=active AND current_period_end > NOW())');
    } else {
      console.log(`    ✅ Found: ${subCheck.rows[0].plan_name}`);
      console.log(`       Unlimited: ${subCheck.rows[0].is_unlimited}`);
      console.log(`       Period End: ${subCheck.rows[0].current_period_end}`);
      console.log(`       NOW(): ${new Date().toISOString()}`);
    }
    console.log();

    const creditsCheck = await db.query(`
      SELECT
        source_type,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) as used
      FROM user_credits
      WHERE user_id = $1
        AND (expires_at IS NULL OR expires_at > NOW())
      GROUP BY source_type
    `, [userId]);

    console.log('  Credits query result:');
    if (creditsCheck.rows.length === 0) {
      console.log('    ⚠️  No credits found (not expired)');
    } else {
      creditsCheck.rows.forEach(row => {
        console.log(`    ${row.source_type}: ${row.available} active, ${row.used} used`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

diagnose();
