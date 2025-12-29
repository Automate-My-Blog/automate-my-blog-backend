import db from './services/database.js';

async function runSimpleTest() {
  try {
    console.log('🔧 Testing simple migration commands...');
    
    // Test 1: Add a simple column to organizations
    try {
      await db.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'business_type') THEN
                ALTER TABLE organizations ADD COLUMN business_type VARCHAR(255);
            END IF;
        END $$;
      `);
      console.log('✅ Added business_type column');
    } catch (error) {
      console.log('⚠️ business_type column issue:', error.message);
    }
    
    // Test 2: Create organization_contacts table
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS organization_contacts (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
            name VARCHAR(255),
            title VARCHAR(255),
            role_type VARCHAR(50) DEFAULT 'unknown',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('✅ Created organization_contacts table');
    } catch (error) {
      console.log('⚠️ organization_contacts table issue:', error.message);
    }
    
    // Test 3: Check what we created
    const tables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name IN ('organization_contacts', 'organizations')
    `);
    
    console.log('📋 Tables found:', tables.rows.map(r => r.table_name));
    
    // Test 4: Check organization columns
    const columns = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'organizations'
    `);
    
    console.log('📋 Organization columns:', columns.rows.map(r => r.column_name));
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await db.close();
  }
}

runSimpleTest();