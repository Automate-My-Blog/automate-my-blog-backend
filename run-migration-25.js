import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : {
    rejectUnauthorized: false
  }
});

async function runMigration() {
  try {
    console.log('🚀 Starting Migration 25: Improve Admin Alerts...\n');

    const migrationPath = join(__dirname, 'database', '25_improve_admin_alerts.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    console.log('📝 Executing migration SQL...\n');
    await pool.query(migrationSQL);

    console.log('\n✅ Migration 25 completed successfully!\n');

    // Verify the updates
    const result = await pool.query(`
      SELECT 
        email_type,
        LEFT(system_prompt, 60) as prompt_preview,
        temperature,
        updated_at
      FROM email_templates
      WHERE email_type IN ('new_lead_alert', 'lead_preview_alert')
      ORDER BY email_type
    `);

    console.log('📋 Verification:');
    result.rows.forEach(row => {
      console.log(`   ✅ ${row.email_type}`);
      console.log(`      Prompt: ${row.prompt_preview}...`);
      console.log(`      Temperature: ${row.temperature}`);
      console.log(`      Updated: ${row.updated_at}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
