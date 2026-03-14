import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './services/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Run specific migration: Add structured analysis fields
async function runMigration() {
  console.log('🚀 Running Migration 09: Add structured analysis fields...\n');
  
  try {
    // Test connection
    console.log('1️⃣ Testing database connection...');
    const connected = await db.testConnection();
    if (!connected) {
      console.error('❌ Cannot connect to database. Please check your DATABASE_URL in .env');
      process.exit(1);
    }
    console.log('✅ Database connection successful');
    
    // Check if migration already run (check for new columns)
    console.log('\n2️⃣ Checking if migration already applied...');
    try {
      const checkResult = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'projects' 
        AND column_name IN ('keywords', 'description', 'decision_makers', 'business_model')
      `);
      
      if (checkResult.rows.length > 0) {
        console.log('✅ Migration appears to already be applied - some new columns exist');
        console.log('🔄 Skipping migration (already applied)');
        return;
      }
    } catch (error) {
      console.log('📝 Unable to check migration status, proceeding with migration...');
    }
    
    // Run migration
    console.log('\n3️⃣ Running migration 09...');
    const migrationPath = path.join(__dirname, 'database', '09_add_structured_analysis_fields.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf8');
    
    await db.query(migrationSQL);
    console.log('✅ Migration 09 completed successfully');
    
    // Verify migration
    console.log('\n4️⃣ Verifying migration...');
    const verifyResult = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'projects' 
      AND column_name IN ('keywords', 'description', 'decision_makers', 'end_users', 'business_model', 'website_goals', 'blog_strategy', 'search_behavior', 'connection_message')
      ORDER BY column_name
    `);
    
    console.log(`✅ Added columns: ${verifyResult.rows.map(row => row.column_name).join(', ')}`);
    console.log('\n🎉 Migration 09 completed successfully!');
    console.log('📝 Projects table now includes structured OpenAI analysis fields');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run migration
runMigration();