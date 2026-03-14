import db from './services/database.js';

async function addMissingColumns() {
  try {
    console.log('🔧 Adding remaining missing columns to organization_intelligence...');
    
    const columnsToAdd = [
      { name: 'data_sources', type: 'JSONB' },
      { name: 'ai_model_used', type: 'VARCHAR(50)' }
    ];
    
    for (const column of columnsToAdd) {
      // Check if column exists first
      const exists = await db.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'organization_intelligence' 
          AND column_name = $1
        );
      `, [column.name]);
      
      if (exists.rows[0].exists) {
        console.log(`✅ Column ${column.name} already exists`);
      } else {
        console.log(`🔧 Adding column ${column.name}...`);
        await db.query(`ALTER TABLE organization_intelligence ADD COLUMN ${column.name} ${column.type};`);
        console.log(`✅ Column ${column.name} added successfully`);
      }
    }
    
    // Final verification - test the actual analysis query
    console.log('\n🧪 Testing the analysis endpoint query...');
    
    const testQuery = `
      SELECT 
        o.id as org_id,
        oi.competitive_intelligence,
        oi.data_sources,
        oi.ai_model_used,
        oi.is_current
      FROM organizations o
      LEFT JOIN organization_intelligence oi ON o.id = oi.organization_id AND oi.is_current = TRUE
      LIMIT 1
    `;
    
    const result = await db.query(testQuery);
    console.log('✅ Analysis query executed successfully!');
    console.log('🎉 All required columns now exist!');
    console.log('📡 The /api/v1/analysis/recent endpoint should now work without 500 errors');
    
  } catch (error) {
    console.error('❌ Failed to add missing columns:', error.message);
  } finally {
    await db.close();
  }
}

addMissingColumns();