import db from './services/database.js';

/**
 * Fix user subscriptions - add Free plan subscription to users who don't have one
 */
async function fixUserSubscriptions() {
  try {
    console.log('🔍 Finding users without subscriptions...');

    // Find users without active subscriptions
    const usersWithoutSubs = await db.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, o.id as org_id
      FROM users u
      LEFT JOIN organizations o ON o.id = (
        SELECT om.organization_id
        FROM organization_memberships om
        WHERE om.user_id = u.id
        LIMIT 1
      )
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
      WHERE s.id IS NULL
    `);

    console.log(`📊 Found ${usersWithoutSubs.rows.length} users without subscriptions`);

    for (const user of usersWithoutSubs.rows) {
      console.log(`\n👤 Fixing user: ${user.email} (${user.first_name} ${user.last_name})`);

      // Create Free plan subscription
      await db.query(`
        INSERT INTO subscriptions (
          user_id,
          organization_id,
          plan_name,
          status,
          current_period_start,
          current_period_end,
          created_at
        ) VALUES (
          $1,
          $2,
          'Free',
          'active',
          NOW(),
          NOW() + INTERVAL '1 month',
          NOW()
        )
      `, [user.id, user.org_id]);

      console.log(`✅ Created Free subscription for ${user.email}`);

      // Initialize usage tracking for current month
      const currentMonth = new Date();
      const periodStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const periodEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

      // Check if usage tracking already exists
      const existingUsage = await db.query(`
        SELECT id FROM user_usage_tracking
        WHERE user_id = $1
          AND feature_type = 'generation'
          AND period_start = $2
      `, [user.id, periodStart]);

      if (existingUsage.rows.length === 0) {
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
            $1,
            'generation',
            $2,
            $3,
            0,
            1,
            NOW()
          )
        `, [user.id, periodStart, periodEnd]);

        console.log(`✅ Initialized usage tracking for ${user.email}`);
      } else {
        console.log(`ℹ️  Usage tracking already exists for ${user.email}`);
      }
    }

    console.log('\n✨ All users fixed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing user subscriptions:', error);
    process.exit(1);
  }
}

fixUserSubscriptions();
