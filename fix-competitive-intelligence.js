import db from './services/database.js';

async function fixCompetitiveIntelligenceColumn() {
  try {
    console.log('🔧 Adding missing competitive_intelligence column...');
    
    // Check if column exists first
    const columnExists = await db.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'organization_intelligence' 
        AND column_name = 'competitive_intelligence'
      );
    `);
    
    if (columnExists.rows[0].exists) {
      console.log('✅ competitive_intelligence column already exists');
    } else {
      console.log('🔧 Adding competitive_intelligence column...');
      
      await db.query(`
        ALTER TABLE organization_intelligence 
        ADD COLUMN competitive_intelligence JSONB;
      `);
      
      console.log('✅ competitive_intelligence column added successfully!');
    }
    
    // Verify the fix
    const verification = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'organization_intelligence' 
      AND column_name = 'competitive_intelligence'
    `);
    
    if (verification.rows.length > 0) {
      console.log('✅ VERIFICATION: competitive_intelligence column now exists');
      console.log('🎉 The 500 errors should now be resolved!');
    } else {
      console.log('❌ VERIFICATION FAILED: Column still missing');
    }
    
  } catch (error) {
    console.error('❌ Failed to add competitive_intelligence column:', error.message);
    throw error;
  } finally {
    await db.close();
  }
}

fixCompetitiveIntelligenceColumn();