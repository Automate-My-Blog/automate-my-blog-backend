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

async function checkTracking() {
  try {
    console.log('🔍 Checking database for tracking data...\n');

    // Check recent organizations
    console.log('📊 Recent Organizations:');
    const orgs = await pool.query(`
      SELECT id, name, session_id, website_url, created_at
      FROM organizations
      ORDER BY created_at DESC
      LIMIT 5
    `);
    console.table(orgs.rows);
    console.log(`Total orgs with session_id: ${orgs.rows.filter(r => r.session_id).length}\n`);

    // Check recent leads
    console.log('📊 Recent Website Leads:');
    const leads = await pool.query(`
      SELECT id, session_id, website_url, business_name, organization_id, created_at
      FROM website_leads
      ORDER BY created_at DESC
      LIMIT 5
    `);
    console.table(leads.rows);
    console.log(`Total leads with session_id: ${leads.rows.filter(r => r.session_id).length}\n`);

    // Check conversion tracking
    console.log('📊 Conversion Tracking Summary:');
    const tracking = await pool.query(`
      SELECT
        COUNT(*) as total_events,
        COUNT(DISTINCT website_lead_id) as unique_leads,
        COUNT(DISTINCT conversion_step) as unique_steps
      FROM conversion_tracking
    `);
    console.table(tracking.rows);

    // Check recent conversion events
    console.log('\n📊 Recent Conversion Events:');
    const recentEvents = await pool.query(`
      SELECT
        ct.conversion_step,
        ct.step_completed_at,
        ct.session_id,
        wl.website_url,
        wl.business_name
      FROM conversion_tracking ct
      LEFT JOIN website_leads wl ON ct.website_lead_id = wl.id
      ORDER BY ct.step_completed_at DESC
      LIMIT 20
    `);
    console.table(recentEvents.rows);

    // Check breakdown by conversion step
    console.log('\n📊 Conversion Steps Breakdown:');
    const stepBreakdown = await pool.query(`
      SELECT
        conversion_step,
        COUNT(*) as count,
        MAX(step_completed_at) as latest_event
      FROM conversion_tracking
      GROUP BY conversion_step
      ORDER BY count DESC
    `);
    console.table(stepBreakdown.rows);

    // Check for specific conversion ID
    if (process.argv[2]) {
      console.log(`\n🔍 Looking for specific conversion ID: ${process.argv[2]}`);
      const specificConversion = await pool.query(`
        SELECT * FROM conversion_tracking WHERE id = $1
      `, [process.argv[2]]);
      if (specificConversion.rows.length > 0) {
        console.log('✅ Found:');
        console.table(specificConversion.rows);
      } else {
        console.log('❌ Not found in conversion_tracking table');
      }
    }

    console.log('\n✅ Database check complete');

  } catch (error) {
    console.error('❌ Error checking database:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

checkTracking();
