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
    console.log('🚀 Starting Migration 20: Email System...\n');

    // Read the migration file
    const migrationPath = join(__dirname, 'database', '20_email_system.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    // Execute the migration
    console.log('📝 Executing migration SQL...\n');
    await pool.query(migrationSQL);

    console.log('\n✅ Migration 20 completed successfully!\n');
    console.log('📊 Summary:');
    console.log('   - Created email_logs table');
    console.log('   - Created email_templates table');
    console.log('   - Created lead_nurture_queue table');
    console.log('   - Added email_preferences, unsubscribed_from columns to users');
    console.log('   - Added expiration_warning_sent_at column to user_credits');
    console.log('   - Seeded 5 core email templates with LLM prompts\n');

    // Verify tables exist
    console.log('🔍 Verifying tables...\n');

    const verifyQuery = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('email_logs', 'email_templates', 'lead_nurture_queue')
      ORDER BY table_name;
    `;

    const tables = await pool.query(verifyQuery);
    console.log(`✅ Found ${tables.rows.length}/3 tables:`);
    tables.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

    // Check email templates were seeded
    const templateCount = await pool.query('SELECT COUNT(*) as count FROM email_templates');
    console.log(`\n✅ Seeded ${templateCount.rows[0].count} email templates`);

    const templates = await pool.query('SELECT email_type, category FROM email_templates ORDER BY email_type');
    templates.rows.forEach(row => {
      console.log(`   - ${row.email_type} (${row.category})`);
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
