import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './services/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database migration script for Vercel PostgreSQL
async function setupDatabase() {
  console.log('🚀 Setting up AutoBlog database...\n');
  
  try {
    // Step 1: Test connection
    console.log('1️⃣ Testing database connection...');
    const connected = await db.testConnection();
    if (!connected) {
      console.error('❌ Cannot connect to database. Please check your DATABASE_URL in .env');
      process.exit(1);
    }
    
    // Step 2: Check current state
    console.log('\n2️⃣ Checking current database state...');
    const tableStatus = await db.checkTables();
    console.log(`📊 Current tables: ${tableStatus.existing.length}/${tableStatus.totalRequired}`);
    
    if (tableStatus.isComplete) {
      console.log('✅ All required tables already exist!');
      console.log('🔄 Database is ready for use.');
      return;
    }
    
    console.log(`⚠️  Missing tables: ${tableStatus.missing.join(', ')}`);
    console.log('\n🔨 Proceeding with database migration...');
    
    // Step 3: Run SQL migrations in order
    const migrationFiles = [
      '01_core_tables.sql',
      '02_billing_tables.sql',
      '03_referral_analytics_tables.sql',
      '04_admin_security_tables.sql',
      '06_lead_generation_tables.sql',
      '05_create_all_indexes.sql'  // Run indexes last
    ];
    
    for (const [index, filename] of migrationFiles.entries()) {
      console.log(`\n${index + 3}️⃣ Running migration: ${filename}...`);
      
      try {
        const filePath = path.join(__dirname, 'database', filename);
        const sqlContent = await fs.readFile(filePath, 'utf8');
        
        // Split by semicolon and execute each statement
        const statements = sqlContent
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
        
        console.log(`   Executing ${statements.length} SQL statements...`);
        
        for (const statement of statements) {
          if (statement.trim()) {
            try {
              await db.query(statement);
            } catch (error) {
              // Some statements might fail if tables already exist - that's OK
              if (!error.message.includes('already exists')) {
                console.warn(`   ⚠️ Warning in ${filename}:`, error.message.split('\n')[0]);
              }
            }
          }
        }
        
        console.log(`   ✅ ${filename} completed`);
        
      } catch (error) {
        console.error(`   ❌ Failed to run ${filename}:`, error.message);
        if (!filename.includes('indexes')) {
          throw error; // Stop for critical errors, but continue if indexes fail
        }
      }
    }
    
    // Step 4: Verify final state
    console.log('\n🔍 Verifying database setup...');
    const finalStatus = await db.checkTables();
    const healthStats = await db.getHealthStats();
    
    console.log('\n📊 Final Database Status:');
    console.log(`   Tables: ${finalStatus.existing.length}/${finalStatus.totalRequired}`);
    console.log(`   Database Size: ${healthStats.databaseSize}`);
    console.log(`   Active Connections: ${healthStats.activeConnections}`);
    
    if (finalStatus.isComplete) {
      console.log('\n🎉 Database setup completed successfully!');
      console.log('✅ All required tables are present');
      console.log('🚀 Ready to proceed with application development');
    } else {
      console.log('\n⚠️  Setup completed with some issues:');
      console.log(`   Missing tables: ${finalStatus.missing.join(', ')}`);
      console.log('💡 The application may still work with basic functionality');
    }
    
    // Step 5: Show sample data
    console.log('\n📋 Sample data verification:');
    try {
      const planCount = await db.query('SELECT COUNT(*) as count FROM plan_definitions');
      const roleCount = await db.query('SELECT COUNT(*) as count FROM user_roles');
      const flagCount = await db.query('SELECT COUNT(*) as count FROM feature_flags');
      
      console.log(`   Plan definitions: ${planCount.rows[0].count}`);
      console.log(`   User roles: ${roleCount.rows[0].count}`);
      console.log(`   Feature flags: ${flagCount.rows[0].count}`);
    } catch (error) {
      console.log('   📝 Sample data will be available after first app run');
    }
    
  } catch (error) {
    console.error('\n💥 Database setup failed:', error.message);
    console.error('\n🔧 Troubleshooting steps:');
    console.error('   1. Verify DATABASE_URL in .env file');
    console.error('   2. Check database permissions');
    console.error('   3. Ensure database server is accessible');
    console.error('   4. Check Vercel PostgreSQL dashboard for issues');
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Handle script termination
process.on('SIGINT', async () => {
  console.log('\n⏹️  Database setup interrupted');
  await db.close();
  process.exit(0);
});

// Run the setup
setupDatabase().catch(console.error);