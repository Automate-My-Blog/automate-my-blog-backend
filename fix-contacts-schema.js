import db from './services/database.js';

async function fixContactsSchema() {
  try {
    console.log('🔧 Fixing organization_contacts table schema...');
    
    // Add missing columns to match the full schema design
    await db.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organization_contacts' AND column_name = 'email') THEN
              ALTER TABLE organization_contacts ADD COLUMN email VARCHAR(255);
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organization_contacts' AND column_name = 'phone') THEN
              ALTER TABLE organization_contacts ADD COLUMN phone VARCHAR(50);
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organization_contacts' AND column_name = 'department') THEN
              ALTER TABLE organization_contacts ADD COLUMN department VARCHAR(100);
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organization_contacts' AND column_name = 'seniority_level') THEN
              ALTER TABLE organization_contacts ADD COLUMN seniority_level VARCHAR(50) DEFAULT 'unknown';
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organization_contacts' AND column_name = 'confidence_level') THEN
              ALTER TABLE organization_contacts ADD COLUMN confidence_level DECIMAL(3,2) DEFAULT 0.5;
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organization_contacts' AND column_name = 'data_source') THEN
              ALTER TABLE organization_contacts ADD COLUMN data_source VARCHAR(50) DEFAULT 'website_analysis';
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organization_contacts' AND column_name = 'updated_at') THEN
              ALTER TABLE organization_contacts ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
          END IF;
      END $$;
    `);
    
    console.log('✅ Added missing columns to organization_contacts');
    
    // Verify the schema
    const columns = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'organization_contacts' 
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Current organization_contacts schema:');
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type})${col.column_default ? ' DEFAULT ' + col.column_default : ''}`);
    });
    
  } catch (error) {
    console.error('❌ Error fixing schema:', error.message);
  } finally {
    await db.close();
  }
}

fixContactsSchema();