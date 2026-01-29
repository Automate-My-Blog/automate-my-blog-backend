/**
 * Strategy Subscription Migrations Runner
 *
 * Runs the three new migration files for strategy subscriptions:
 * 1. 028_strategy_subscriptions.sql
 * 2. 029_enhance_audiences_pricing.sql
 * 3. 030_strategy_usage_log.sql
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../services/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrations = [
  '028_strategy_subscriptions.sql',
  '029_enhance_audiences_pricing.sql',
  '030_strategy_usage_log.sql'
];

async function runMigration(filename) {
  const migrationPath = path.join(__dirname, '..', 'database', 'migrations', filename);

  console.log(`\n📄 Running migration: ${filename}`);
  console.log(`   Path: ${migrationPath}`);

  try {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Execute the entire migration file as a single query
    // PostgreSQL can handle multiple statements separated by semicolons
    console.log(`   Executing migration...`);

    try {
      await db.query(sql);
      console.log(`✅ Migration ${filename} completed successfully`);
      return true;
    } catch (error) {
      // Check if error is due to tables/columns already existing (idempotent)
      if (
        error.code === '42P07' || // table already exists
        error.code === '42701' || // column already exists
        error.message.includes('already exists')
      ) {
        console.log(`⚠️  Migration ${filename} partially completed (some objects already exist)`);
        return true;
      } else {
        throw error;
      }
    }

  } catch (error) {
    console.error(`❌ Migration ${filename} failed:`, error.message);
    console.error(`   Error code: ${error.code}`);
    console.error(`   Hint: ${error.hint || 'N/A'}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Starting Strategy Subscription Migrations');
  console.log('============================================\n');

  // Test database connection first
  console.log('🔍 Testing database connection...');
  const connected = await db.testConnection();

  if (!connected) {
    console.error('\n❌ Cannot connect to database. Please check your connection settings.');
    console.error('   Check DATABASE_URL or DB_* environment variables in .env file');
    process.exit(1);
  }

  console.log('\n✅ Database connection successful\n');

  // Run each migration
  let successCount = 0;
  let failureCount = 0;

  for (const migration of migrations) {
    const success = await runMigration(migration);
    if (success) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  // Summary
  console.log('\n============================================');
  console.log('📊 Migration Summary');
  console.log('============================================');
  console.log(`✅ Successful: ${successCount}/${migrations.length}`);
  console.log(`❌ Failed: ${failureCount}/${migrations.length}`);

  if (failureCount === 0) {
    console.log('\n🎉 All migrations completed successfully!');

    // Show created tables
    console.log('\n📋 Checking created tables...');
    try {
      const result = await db.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name IN ('bundle_subscriptions', 'strategy_purchases', 'strategy_usage_log')
        ORDER BY table_name
      `);

      console.log('   Tables created:');
      result.rows.forEach(row => {
        console.log(`   ✅ ${row.table_name}`);
      });

      // Check audiences table columns
      const audiencesColumns = await db.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'audiences'
        AND column_name IN ('pricing_monthly', 'pricing_annual', 'posts_recommended', 'posts_maximum')
        ORDER BY column_name
      `);

      if (audiencesColumns.rows.length > 0) {
        console.log('\n   Audiences table enhancements:');
        audiencesColumns.rows.forEach(row => {
          console.log(`   ✅ ${row.column_name}`);
        });
      }

    } catch (error) {
      console.error('   Could not verify tables:', error.message);
    }

  } else {
    console.log('\n⚠️  Some migrations failed. Check errors above.');
    process.exit(1);
  }

  // Close database connection
  await db.close();

  console.log('\n✅ Migration runner completed');
}

// Run migrations
main().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
