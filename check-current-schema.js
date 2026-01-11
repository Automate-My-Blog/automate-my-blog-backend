import db from './services/database.js';

async function checkCurrentSchema() {
  try {
    console.log('🔍 Checking current database schema...');
    
    // Check organizations table columns
    console.log('\n📋 ORGANIZATIONS TABLE:');
    const orgColumns = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'organizations'
      ORDER BY column_name
    `);
    
    console.log('Current columns:');
    orgColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    
    // Check if organization_intelligence table exists
    console.log('\n📋 ORGANIZATION_INTELLIGENCE TABLE:');
    const tableExists = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'organization_intelligence'
      );
    `);
    
    if (tableExists.rows[0].exists) {
      console.log('✅ Table exists');
      const intelColumns = await db.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'organization_intelligence'
        ORDER BY column_name
      `);
      
      console.log('Current columns:');
      intelColumns.rows.forEach(col => {
        console.log(`  - ${col.column_name} (${col.data_type})`);
      });
      
      // Check specifically for competitive_intelligence
      const hasCompetitive = intelColumns.rows.some(col => col.column_name === 'competitive_intelligence');
      console.log(`\n🎯 competitive_intelligence column: ${hasCompetitive ? '✅ EXISTS' : '❌ MISSING'}`);
      
    } else {
      console.log('❌ Table does not exist');
    }
    
    // Check organization_contacts table
    console.log('\n📋 ORGANIZATION_CONTACTS TABLE:');
    const contactsExists = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'organization_contacts'
      );
    `);
    
    console.log(`Status: ${contactsExists.rows[0].exists ? '✅ EXISTS' : '❌ MISSING'}`);
    
  } catch (error) {
    console.error('❌ Schema check failed:', error.message);
  } finally {
    await db.close();
  }
}

checkCurrentSchema();