import db from './services/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Run migration 15: Fix SEO Analysis Post Linkage
 */
async function runMigration() {
  try {
    console.log('🔄 Running Migration 15: Fix SEO Analysis Post Linkage');
    console.log('   This changes the unique constraint from (content_hash, user_id) to (post_id, user_id)');
    console.log('   So each post gets its own analysis instead of sharing analyses for identical content.\n');

    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'database', '15_fix_seo_analysis_post_constraint.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Execute the migration
    console.log('📝 Executing migration SQL...');
    await db.query(migrationSQL);

    console.log('✅ Migration 15 completed successfully!');
    console.log('\nChanges made:');
    console.log('  ✓ Dropped old constraint: unique_user_content (content_hash, user_id)');
    console.log('  ✓ Added new constraint: unique_post_analysis (post_id, user_id)');
    console.log('  ✓ Made post_id NOT NULL (each analysis must link to a post)');
    console.log('  ✓ Added index for better query performance');
    console.log('\nResult: Each post now has its own analysis that gets updated on re-analysis.');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('\nError details:', error.message);

    if (error.message.includes('violates not-null constraint')) {
      console.error('\n💡 Tip: Some analyses have NULL post_id. The migration should handle this,');
      console.error('   but if it fails, you may need to manually clean up or delete those records.');
    }

    process.exit(1);
  }
}

runMigration();
