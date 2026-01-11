import db from './services/database.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  try {
    console.log('🔧 Running organization intelligence migration (v2)...');
    const filePath = path.join(__dirname, 'database', '08_organization_intelligence_tables.sql');
    const sqlContent = await fs.readFile(filePath, 'utf8');
    
    // Execute the entire file as one transaction
    // PostgreSQL should handle the DO blocks and multiple statements correctly
    console.log('⏳ Executing migration as single transaction...');
    
    await db.query('BEGIN');
    try {
      await db.query(sqlContent);
      await db.query('COMMIT');
      console.log('✅ Migration committed successfully');
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('❌ Migration failed, rolled back:', error.message);
      throw error;
    }
    
    // Test new tables exist
    console.log('🔍 Verifying migration results...');
    
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
      WHERE table_name = 'organizations' 
      AND column_name IN ('business_type', 'industry_category', 'business_model', 'target_audience', 'brand_voice', 'website_goals', 'last_analyzed_at')
    `);
    
    console.log('📋 New organization columns:', columns.rows.map(r => r.column_name));
    
    // Test organization_intelligence table columns including competitive_intelligence
    const intelColumns = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'organization_intelligence' 
      AND column_name IN ('competitive_intelligence', 'customer_scenarios', 'seo_opportunities', 'content_strategy_recommendations')
      ORDER BY column_name
    `);
    
    console.log('📋 Key organization intelligence columns:', intelColumns.rows.map(r => r.column_name));
    
    if (intelColumns.rows.some(r => r.column_name === 'competitive_intelligence')) {
      console.log('✅ competitive_intelligence column successfully created!');
    } else {
      console.log('❌ competitive_intelligence column not found!');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Full error:', error);
  } finally {
    await db.close();
  }
}

runMigration();