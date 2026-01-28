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
    console.log('🚀 Starting Migration 24: Admin Lead Alerts...\n');

    // Read the migration file
    const migrationPath = join(__dirname, 'database', '24_admin_lead_alerts.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    // Execute the migration
    console.log('📝 Executing migration SQL...\n');
    await pool.query(migrationSQL);

    console.log('\n✅ Migration 24 completed successfully!\n');

    // Verify the inserts
    const result = await pool.query(`
      SELECT email_type, category, active
      FROM email_templates
      WHERE email_type IN ('new_lead_alert', 'lead_preview_alert')
      ORDER BY email_type
    `);

    console.log('📋 Verification:');
    result.rows.forEach(row => {
      console.log(`   ✅ ${row.email_type} (${row.category}) - Active: ${row.active}`);
    });
    console.log('\n✅ Admin lead alert templates created successfully!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
