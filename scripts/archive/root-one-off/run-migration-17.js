import db from './services/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Run migration 17: Add data_source tracking to CTA analysis
 */
async function runMigration() {
  try {
    console.log('🔄 Running Migration 17: Add data_source tracking to CTA analysis');
    console.log('   This adds a data_source column to track whether CTAs were scraped or manually entered.\n');

    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'database', '17_add_cta_data_source.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Execute the migration
    console.log('📝 Executing migration SQL...');
    await db.query(migrationSQL);

    console.log('✅ Migration 17 completed successfully!');
    console.log('\nChanges made:');
    console.log('  ✓ Added data_source column (VARCHAR, CHECK constraint)');
    console.log('  ✓ Backfilled existing records with data_source = \'scraped\'');
    console.log('  ✓ Set column to NOT NULL');
    console.log('  ✓ Added index for filtering by data_source');
    console.log('\nResult: CTA origin is now tracked (scraped vs manual)');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('\nError details:', error.message);

    if (error.message.includes('column "data_source" of relation "cta_analysis" already exists')) {
      console.log('\n💡 Tip: Column already exists. Migration may have already run.');
      process.exit(0);
    }

    process.exit(1);
  }
}

runMigration();
