import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : {
    rejectUnauthorized: false
  }
});

async function testFunnelQuery() {
  try {
    const endDate = new Date().toISOString().split('T')[0]; // Today
    const startDate = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0]; // 30 days ago

    console.log(`🔍 Testing funnel query from ${startDate} to ${endDate}\n`);

    const result = await pool.query(`
      WITH lead_base AS (
        SELECT DISTINCT wl.id, wl.session_id, wl.created_at
        FROM website_leads wl
        WHERE DATE(wl.created_at) >= DATE($1)
          AND DATE(wl.created_at) <= DATE($2)
      ),
      conversion_steps AS (
        SELECT
          lb.id as lead_id,
          MAX(CASE WHEN ct.conversion_step = 'analysis_started' THEN 1 ELSE 0 END) as analysis_started,
          MAX(CASE WHEN ct.conversion_step = 'analysis_completed' THEN 1 ELSE 0 END) as analysis_completed,
          MAX(CASE WHEN ct.conversion_step = 'previews_viewed' THEN 1 ELSE 0 END) as previews_viewed,
          MAX(CASE WHEN ct.conversion_step = 'audience_selected' THEN 1 ELSE 0 END) as audience_selected,
          MAX(CASE WHEN ct.conversion_step = 'registration' THEN 1 ELSE 0 END) as registered,
          MAX(CASE WHEN ct.conversion_step = 'content_generated' THEN 1 ELSE 0 END) as content_generated,
          MAX(CASE WHEN ct.conversion_step = 'project_saved' THEN 1 ELSE 0 END) as project_saved,
          MAX(CASE WHEN ct.conversion_step = 'content_exported' THEN 1 ELSE 0 END) as content_exported,
          MAX(CASE WHEN ct.conversion_step = 'first_payment' THEN 1 ELSE 0 END) as first_payment
        FROM lead_base lb
        LEFT JOIN conversion_tracking ct ON lb.id = ct.website_lead_id
        GROUP BY lb.id
      )
      SELECT
        (SELECT COUNT(*) FROM lead_base) as total_leads,
        (SELECT SUM(analysis_started) FROM conversion_steps) as analysis_started,
        (SELECT SUM(analysis_completed) FROM conversion_steps) as analysis_completed,
        (SELECT SUM(previews_viewed) FROM conversion_steps) as previews_viewed,
        (SELECT SUM(audience_selected) FROM conversion_steps) as audience_selected,
        (SELECT SUM(registered) FROM conversion_steps) as registered,
        (SELECT SUM(content_generated) FROM conversion_steps) as content_generated,
        (SELECT SUM(project_saved) FROM conversion_steps) as project_saved,
        (SELECT SUM(content_exported) FROM conversion_steps) as content_exported,
        (SELECT SUM(first_payment) FROM conversion_steps) as first_payment
    `, [startDate, endDate]);

    console.log('📊 Funnel Query Results:');
    console.table(result.rows[0]);

    // Also check which leads have what steps
    const leadDetails = await pool.query(`
      WITH lead_base AS (
        SELECT DISTINCT wl.id, wl.session_id, wl.website_url, wl.created_at
        FROM website_leads wl
        WHERE DATE(wl.created_at) >= DATE($1)
          AND DATE(wl.created_at) <= DATE($2)
      )
      SELECT
        lb.website_url,
        lb.created_at,
        STRING_AGG(DISTINCT ct.conversion_step, ', ' ORDER BY ct.conversion_step) as steps
      FROM lead_base lb
      LEFT JOIN conversion_tracking ct ON lb.id = ct.website_lead_id
      GROUP BY lb.id, lb.website_url, lb.created_at
      ORDER BY lb.created_at DESC
      LIMIT 20
    `, [startDate, endDate]);

    console.log('\n📊 Recent Leads with Tracking Steps:');
    console.table(leadDetails.rows);

    console.log('\n✅ Test complete');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

testFunnelQuery();
