import db from '../services/database.js';

async function testSubscribedQuery() {
  console.log('🔍 Testing /subscribed query...');

  // Test user ID from the logs (the one who just subscribed)
  const testUserId = '4d2c5e1f-8a3b-4c7d-9e2f-1a5b8c9d3e4f'; // Replace with actual if needed

  try {
    console.log(`📊 Testing query for user: ${testUserId}`);

    const result = await db.query(
      `SELECT
        sp.*,
        a.id as strategy_id,
        a.pitch,
        a.target_segment,
        a.customer_problem,
        a.seo_keywords,
        a.image_url,
        a.pricing_monthly,
        a.pricing_annual
      FROM strategy_purchases sp
      INNER JOIN audiences a ON sp.strategy_id = a.id
      WHERE sp.user_id = $1 AND sp.status = 'active'
      ORDER BY sp.created_at DESC`,
      [testUserId]
    );

    console.log('✅ Query successful!');
    console.log(`📊 Found ${result.rows.length} subscriptions`);
    console.log('Subscriptions:', JSON.stringify(result.rows, null, 2));

  } catch (error) {
    console.error('❌ Query failed:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      stack: error.stack
    });
  }

  // Check if table exists
  try {
    console.log('\n🔍 Checking if strategy_purchases table exists...');
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'strategy_purchases'
      );
    `);
    console.log('Table exists:', tableCheck.rows[0].exists);

    // Count total records
    const count = await db.query('SELECT COUNT(*) FROM strategy_purchases');
    console.log('Total subscriptions in table:', count.rows[0].count);

    // Show recent subscriptions
    const recent = await db.query('SELECT * FROM strategy_purchases ORDER BY created_at DESC LIMIT 5');
    console.log('Recent subscriptions:', JSON.stringify(recent.rows, null, 2));

  } catch (error) {
    console.error('❌ Table check failed:', error.message);
  }

  process.exit(0);
}

testSubscribedQuery();
