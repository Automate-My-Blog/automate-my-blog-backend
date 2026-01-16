import db from './services/database.js';

/**
 * Clear cached SEO analyses to force regeneration with new prompt
 */
async function clearSEOCache() {
  try {
    console.log('🧹 Clearing cached SEO analyses...');

    // Get count before deletion
    const countResult = await db.query(
      'SELECT COUNT(*) as count FROM comprehensive_seo_analyses'
    );
    const beforeCount = parseInt(countResult.rows[0].count);

    console.log(`📊 Found ${beforeCount} cached analyses`);

    // Delete all cached analyses
    const result = await db.query(
      'DELETE FROM comprehensive_seo_analyses RETURNING id'
    );

    console.log(`✅ Deleted ${result.rowCount} cached analyses`);
    console.log('🎉 Cache cleared! Next analyses will use the new scoring prompt.');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing cache:', error);
    process.exit(1);
  }
}

clearSEOCache();
