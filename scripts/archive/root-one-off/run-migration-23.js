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
    console.log('🚀 Starting Migration 23: Fix Email Templates...\n');

    // Read the migration file
    const migrationPath = join(__dirname, 'database', '23_fix_email_templates.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    // Execute the migration
    console.log('📝 Executing migration SQL...\n');
    await pool.query(migrationSQL);

    console.log('\n✅ Migration 23 completed successfully!\n');

    // Verify the update
    const result = await pool.query(`
      SELECT
        email_type,
        LEFT(system_prompt, 100) as system_prompt_preview,
        updated_at
      FROM email_templates
      WHERE email_type = 'low_credit_warning'
    `);

    console.log('📋 Verification:');
    console.log(`   Email Type: ${result.rows[0].email_type}`);
    console.log(`   System Prompt: ${result.rows[0].system_prompt_preview}...`);
    console.log(`   Updated At: ${result.rows[0].updated_at}`);
    console.log('\n✅ Template updated successfully!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
