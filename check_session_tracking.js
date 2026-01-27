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

async function checkSession(sessionId) {
  try {
    console.log(`🔍 Checking all tracking for session: ${sessionId}\n`);

    // Get lead for this session
    const lead = await pool.query(`
      SELECT id, session_id, website_url, business_name, created_at
      FROM website_leads
      WHERE session_id = $1
    `, [sessionId]);

    if (lead.rows.length === 0) {
      console.log('❌ No lead found for this session');
      return;
    }

    console.log('📊 Lead Record:');
    console.table(lead.rows);

    // Get all conversion events for this lead
    const events = await pool.query(`
      SELECT
        conversion_step,
        step_completed_at,
        step_data,
        time_from_previous_step,
        total_time_to_conversion
      FROM conversion_tracking
      WHERE website_lead_id = $1
      ORDER BY step_completed_at ASC
    `, [lead.rows[0].id]);

    console.log(`\n📊 Conversion Events (${events.rows.length} total):`);
    if (events.rows.length > 0) {
      console.table(events.rows);
    } else {
      console.log('❌ No conversion events found for this lead');
    }

    console.log('\n✅ Session check complete');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

const sessionId = process.argv[2];
if (!sessionId) {
  console.log('Usage: node check_session_tracking.js <session_id>');
  process.exit(1);
}

checkSession(sessionId);
