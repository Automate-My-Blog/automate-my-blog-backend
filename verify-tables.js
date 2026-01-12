import db from './services/database.js';

/**
 * Verify Phase 1A database tables exist
 */
async function verifyDatabaseTables() {
  console.log('🗄️ Verifying Phase 1A Database Tables');
  console.log('='.repeat(40));
  
  try {
    const tableQueries = [
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'website_pages');",
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'cta_analysis');", 
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'internal_linking_analysis');",
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'content_analysis_results');",
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'manual_content_uploads');"
    ];
    
    const tables = ['website_pages', 'cta_analysis', 'internal_linking_analysis', 'content_analysis_results', 'manual_content_uploads'];
    
    for (let i = 0; i < tableQueries.length; i++) {
      const result = await db.query(tableQueries[i]);
      const exists = result.rows[0].exists;
      console.log(`${exists ? '✅' : '❌'} Table '${tables[i]}': ${exists ? 'EXISTS' : 'MISSING'}`);
    }
    
    // Check for utility functions
    console.log('\n🔧 Checking Utility Functions:');
    try {
      await db.query("SELECT get_website_content_summary('test-org-id');");
      console.log('✅ Function get_website_content_summary: EXISTS');
    } catch (error) {
      console.log('❌ Function get_website_content_summary: MISSING');
    }
    
    try {
      await db.query("SELECT get_cta_effectiveness_summary('test-org-id');");
      console.log('✅ Function get_cta_effectiveness_summary: EXISTS');
    } catch (error) {
      console.log('❌ Function get_cta_effectiveness_summary: MISSING');
    }
    
    console.log('\n✅ Database verification complete');
    
  } catch (error) {
    console.error('❌ Database verification failed:', error.message);
  } finally {
    process.exit(0);
  }
}

verifyDatabaseTables();