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
    console.log('🚀 Starting Migration 21: Additional Email Templates...\n');

    // Read the migration file
    const migrationPath = join(__dirname, 'database', '21_additional_email_templates.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    // Execute the migration
    console.log('📝 Executing migration SQL...\n');
    await pool.query(migrationSQL);

    console.log('\n✅ Migration 21 completed successfully!\n');

    // Verify templates
    console.log('🔍 Verifying email templates...\n');

    const templateCount = await pool.query('SELECT COUNT(*) as count FROM email_templates WHERE active = TRUE');
    console.log(`✅ Total active templates: ${templateCount.rows[0].count}`);

    const templates = await pool.query(`
      SELECT category, COUNT(*) as count
      FROM email_templates
      WHERE active = TRUE
      GROUP BY category
      ORDER BY category
    `);

    console.log('\n📊 Templates by category:');
    templates.rows.forEach(row => {
      console.log(`   ${row.category}: ${row.count} templates`);
    });

    // List all template names
    console.log('\n📋 All email templates:');
    const allTemplates = await pool.query(`
      SELECT email_type, category
      FROM email_templates
      WHERE active = TRUE
      ORDER BY category, email_type
    `);

    let currentCategory = '';
    allTemplates.rows.forEach(row => {
      if (row.category !== currentCategory) {
        currentCategory = row.category;
        console.log(`\n  ${currentCategory.toUpperCase()}:`);
      }
      console.log(`    - ${row.email_type}`);
    });

    console.log('\n🎉 All email templates successfully seeded!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
