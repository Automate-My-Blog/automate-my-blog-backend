import db from '../services/database.js';

async function createTestSubscription() {
  try {
    const userId = '6da8c90d-f1be-40e2-a9e3-c2963bf9f9f2';
    const strategyId = '078d3fcd-3275-45fd-b67a-54a462baba0b'; // Energy industry professionals

    console.log('🔍 Checking for existing subscription...');

    // Check if subscription already exists
    const existing = await db.query(
      'SELECT id FROM strategy_purchases WHERE user_id = $1 AND strategy_id = $2',
      [userId, strategyId]
    );

    if (existing.rows.length > 0) {
      console.log('✅ Subscription already exists:', existing.rows[0].id);
      process.exit(0);
    }

    console.log('📝 Creating test subscription...');

    // Create test subscription
    const result = await db.query(`
      INSERT INTO strategy_purchases (
        user_id, strategy_id, status, billing_interval, amount_paid, currency,
        posts_recommended, posts_maximum, posts_used, posts_remaining,
        next_billing_date, created_at, updated_at
      ) VALUES (
        $1, $2, 'active', 'monthly', 29.00, 'usd',
        10, 10, 0, 10,
        NOW() + INTERVAL '30 days', NOW(), NOW()
      )
      RETURNING id, strategy_id, status, created_at
    `, [userId, strategyId]);

    console.log('✅ Test subscription created successfully!');
    console.log('   ID:', result.rows[0].id);
    console.log('   Strategy ID:', result.rows[0].strategy_id);
    console.log('   Status:', result.rows[0].status);
    console.log('   Created:', result.rows[0].created_at);

    await db.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

createTestSubscription();
