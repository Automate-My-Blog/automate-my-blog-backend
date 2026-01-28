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

async function debugFunnelQuery() {
  try {
    console.log('🔍 Debugging funnel query...\n');

    // Check total leads
    const totalLeads = await pool.query(`
      SELECT COUNT(*) as count FROM website_leads
    `);
    console.log(`📊 Total website_leads: ${totalLeads.rows[0].count}`);

    // Check total conversion events
    const totalEvents = await pool.query(`
      SELECT COUNT(*) as count FROM conversion_tracking
    `);
    console.log(`📊 Total conversion_tracking events: ${totalEvents.rows[0].count}`);

    // Check conversion step breakdown
    const stepBreakdown = await pool.query(`
      SELECT conversion_step, COUNT(*) as count
      FROM conversion_tracking
      GROUP BY conversion_step
      ORDER BY count DESC
    `);
    console.log('\n📊 Conversion steps breakdown:');
    console.table(stepBreakdown.rows);

    // Check if conversion_tracking has website_lead_id that matches website_leads.id
    const orphanedEvents = await pool.query(`
      SELECT
        ct.conversion_step,
        ct.website_lead_id,
        ct.session_id,
        CASE WHEN wl.id IS NULL THEN 'ORPHANED' ELSE 'LINKED' END as status
      FROM conversion_tracking ct
      LEFT JOIN website_leads wl ON ct.website_lead_id = wl.id
      ORDER BY ct.step_completed_at DESC
      LIMIT 20
    `);
    console.log('\n📊 Recent conversion events (with link status):');
    console.table(orphanedEvents.rows);

    // Count orphaned vs linked
    const linkStats = await pool.query(`
      SELECT
        CASE WHEN wl.id IS NULL THEN 'ORPHANED' ELSE 'LINKED' END as status,
        COUNT(*) as count
      FROM conversion_tracking ct
      LEFT JOIN website_leads wl ON ct.website_lead_id = wl.id
      GROUP BY CASE WHEN wl.id IS NULL THEN 'ORPHANED' ELSE 'LINKED' END
    `);
    console.log('\n📊 Link status summary:');
    console.table(linkStats.rows);

    // Check if there are recent leads with matching session_ids
    const recentLeadsWithSessions = await pool.query(`
      SELECT id, session_id, website_url, created_at
      FROM website_leads
      WHERE session_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.log('\n📊 Recent leads with session_ids:');
    console.table(recentLeadsWithSessions.rows);

    console.log('\n✅ Debug complete');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

debugFunnelQuery();
