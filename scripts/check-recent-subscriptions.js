import db from '../services/database.js';

/**
 * Check recent subscriptions and their credits
 * Run with: node scripts/check-recent-subscriptions.js
 */

async function checkRecentSubscriptions() {
  try {
    console.log('\n🔍 Checking recent subscriptions (last 24 hours)...\n');

    // Get recent subscriptions
    const subsResult = await db.query(`
      SELECT
        s.id,
        s.user_id,
        u.email,
        s.plan_name,
        s.status,
        s.stripe_subscription_id,
        s.current_period_start,
        s.current_period_end,
        s.created_at
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.created_at > NOW() - INTERVAL '24 hours'
      ORDER BY s.created_at DESC
    `);

    if (subsResult.rows.length === 0) {
      console.log('❌ No subscriptions created in the last 24 hours');
      process.exit(0);
    }

    console.log(`Found ${subsResult.rows.length} recent subscription(s):\n`);

    for (const sub of subsResult.rows) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📋 Subscription ID: ${sub.id}`);
      console.log(`👤 User: ${sub.email} (${sub.user_id})`);
      console.log(`📦 Plan: ${sub.plan_name}`);
      console.log(`📊 Status: ${sub.status}`);
      console.log(`🔗 Stripe ID: ${sub.stripe_subscription_id}`);
      console.log(`📅 Created: ${sub.created_at}`);
      console.log(`📅 Period: ${sub.current_period_start} → ${sub.current_period_end}`);
      console.log();

      // Check credits for this user
      const creditsResult = await db.query(`
        SELECT
          id,
          source_type,
          source_description,
          quantity,
          status,
          priority,
          created_at,
          expires_at
        FROM user_credits
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [sub.user_id]);

      console.log(`💳 Credits for this user: ${creditsResult.rows.length} total`);

      if (creditsResult.rows.length === 0) {
        console.log('   ⚠️  WARNING: No credits found for this user!');
      } else {
        const active = creditsResult.rows.filter(c => c.status === 'active');
        const used = creditsResult.rows.filter(c => c.status === 'used');
        const expired = creditsResult.rows.filter(c => c.status === 'expired');

        console.log(`   Active: ${active.length}, Used: ${used.length}, Expired: ${expired.length}\n`);

        if (active.length === 0 && sub.status === 'active') {
          console.log('   ⚠️  WARNING: Active subscription but no active credits!');
        }

        console.log('   Recent credits:');
        creditsResult.rows.slice(0, 10).forEach((credit, i) => {
          console.log(`   ${i + 1}. [${credit.status}] ${credit.source_type} - ${credit.source_description}`);
          console.log(`      Quantity: ${credit.quantity}, Priority: ${credit.priority}`);
          console.log(`      Created: ${credit.created_at}`);
          if (credit.expires_at) {
            const expired = new Date(credit.expires_at) < new Date();
            console.log(`      Expires: ${credit.expires_at} ${expired ? '(EXPIRED)' : ''}`);
          }
        });
      }

      console.log();

      // Check if plan_definitions has this plan
      const planDefResult = await db.query(`
        SELECT name, monthly_limit, is_unlimited
        FROM plan_definitions
        WHERE name = $1
      `, [sub.plan_name]);

      if (planDefResult.rows.length === 0) {
        console.log(`   ⚠️  WARNING: Plan "${sub.plan_name}" not found in plan_definitions table!`);
      } else {
        const plan = planDefResult.rows[0];
        console.log(`   ✅ Plan definition exists: ${plan.monthly_limit} posts/month (unlimited: ${plan.is_unlimited})`);
      }

      console.log();
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Check plan_definitions table
    console.log('📊 All Plan Definitions:');
    const allPlansResult = await db.query(`
      SELECT name, monthly_limit, is_unlimited
      FROM plan_definitions
      ORDER BY name
    `);

    allPlansResult.rows.forEach(plan => {
      console.log(`   - ${plan.name}: ${plan.is_unlimited ? 'Unlimited' : plan.monthly_limit + ' posts/month'}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

checkRecentSubscriptions();
