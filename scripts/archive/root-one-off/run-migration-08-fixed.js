import db from './services/database.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  try {
    console.log('🔧 Running organization intelligence migration (fixed version)...');
    const filePath = path.join(__dirname, 'database', '08_organization_intelligence_tables.sql');
    const sqlContent = await fs.readFile(filePath, 'utf8');
    
    // Split by semicolons and execute each statement separately
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📋 Found ${statements.length} SQL statements to execute`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        try {
          console.log(`⏳ Executing statement ${i + 1}/${statements.length}...`);
          await db.query(statement);
          console.log(`✅ Statement ${i + 1} completed`);
        } catch (error) {
          console.error(`❌ Statement ${i + 1} failed:`, error.message);
          console.log('Statement content:', statement.substring(0, 200) + '...');
          throw error;
        }
      }
    }
    
    console.log('✅ Migration completed successfully');
    
    // Test new tables exist
    const result = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name IN ('organization_contacts', 'organization_intelligence')
    `);
    
    console.log('📋 New tables created:', result.rows.map(r => r.table_name));
    
    // Test new columns in organizations
    const columns = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'organizations' AND column_name IN ('business_type', 'industry_category', 'business_model', 'competitive_intelligence')
    `);
    
    console.log('📋 New org columns:', columns.rows.map(r => r.column_name));
    
    // Test organization_intelligence table columns
    const intelColumns = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'organization_intelligence' 
      ORDER BY column_name
    `);
    
    console.log('📋 Organization intelligence columns:', intelColumns.rows.map(r => r.column_name));
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
  } finally {
    await db.close();
  }
}

runMigration();