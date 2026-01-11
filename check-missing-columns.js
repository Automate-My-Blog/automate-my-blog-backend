import db from './services/database.js';

async function checkMissingColumns() {
  try {
    console.log('🔍 Checking organization_intelligence table columns...');
    
    // Get actual columns that exist
    const actualColumns = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'organization_intelligence'
      ORDER BY column_name
    `);
    
    const existingColumns = actualColumns.rows.map(r => r.column_name);
    console.log('\n📋 EXISTING columns:');
    existingColumns.forEach(col => console.log(`  ✅ ${col}`));
    
    // Columns that the analysis route expects
    const expectedColumns = [
      'customer_scenarios',
      'business_value_assessment', 
      'customer_language_patterns',
      'search_behavior_insights',
      'seo_opportunities',
      'content_strategy_recommendations',
      'competitive_intelligence',
      'analysis_confidence_score',
      'data_sources',
      'ai_model_used',
      'raw_openai_response',
      'is_current',
      'created_at'
    ];
    
    console.log('\n📋 MISSING columns:');
    const missingColumns = expectedColumns.filter(col => !existingColumns.includes(col));
    
    if (missingColumns.length === 0) {
      console.log('  ✅ No missing columns!');
    } else {
      missingColumns.forEach(col => console.log(`  ❌ ${col}`));
    }
    
    console.log('\n🔧 Columns that need to be added:');
    missingColumns.forEach(col => {
      let type = 'JSONB'; // Default for most analysis data
      if (col === 'analysis_confidence_score') type = 'DECIMAL(3,2)';
      if (col === 'ai_model_used') type = 'VARCHAR(50)';
      if (col === 'is_current') type = 'BOOLEAN DEFAULT TRUE';
      if (col === 'created_at') type = 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP';
      
      console.log(`  ALTER TABLE organization_intelligence ADD COLUMN ${col} ${type};`);
    });
    
  } catch (error) {
    console.error('❌ Check failed:', error.message);
  } finally {
    await db.close();
  }
}

checkMissingColumns();