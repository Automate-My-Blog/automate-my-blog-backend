import db from './services/database.js';

// Test database connection and setup
async function testDatabaseSetup() {
  console.log('🧪 Testing database connection and setup...\n');
  
  try {
    // Test 1: Basic Connection
    console.log('1️⃣ Testing database connection...');
    const connectionResult = await db.testConnection();
    
    if (!connectionResult) {
      console.log('❌ Database connection failed - cannot proceed');
      process.exit(1);
    }
    
    // Test 2: Health Stats
    console.log('\n2️⃣ Checking database health...');
    const healthStats = await db.getHealthStats();
    console.log('📊 Database Health:');
    console.log(`   Active Connections: ${healthStats.activeConnections}`);
    console.log(`   Database Size: ${healthStats.databaseSize}`);
    console.log(`   Tables Count: ${healthStats.tableCount}`);
    console.log(`   Pool Status: ${healthStats.poolTotalCount} total, ${healthStats.poolIdleCount} idle`);
    
    // Test 3: Table Existence Check
    console.log('\n3️⃣ Checking required tables...');
    const tableStatus = await db.checkTables();
    console.log('📋 Table Status:');
    console.log(`   Required: ${tableStatus.totalRequired}`);
    console.log(`   Existing: ${tableStatus.existing.length} - [${tableStatus.existing.slice(0, 3).join(', ')}${tableStatus.existing.length > 3 ? '...' : ''}]`);
    
    if (tableStatus.missing.length > 0) {
      console.log(`   ⚠️  Missing: ${tableStatus.missing.length} - [${tableStatus.missing.join(', ')}]`);
      console.log('\n💡 To create missing tables, run the SQL files in /database/ folder');
      console.log('   Example: psql $DATABASE_URL -f database/01_core_tables.sql');
    } else {
      console.log('   ✅ All required tables exist!');
    }
    
    // Test 4: Simple Query Test
    console.log('\n4️⃣ Testing database queries...');
    const queryResult = await db.query('SELECT 1 as test, $1 as param_test', ['Database Ready!']);
    console.log('✅ Query test passed:', queryResult.rows[0]);
    
    // Test 5: Check if we can access users table (if it exists)
    if (tableStatus.existing.includes('users')) {
      console.log('\n5️⃣ Testing users table access...');
      const userCount = await db.query('SELECT COUNT(*) as count FROM users');
      console.log(`👥 Users in database: ${userCount.rows[0].count}`);
    }
    
    console.log('\n✅ Database setup test completed successfully!');
    console.log('🚀 Ready to proceed with implementation.');
    
  } catch (error) {
    console.error('\n💥 Database setup test failed:', error.message);
    
    // Provide specific guidance based on error
    if (error.message.includes('database "automatemyblog" does not exist')) {
      console.log('\n🔧 Fix: Create the database:');
      console.log('   createdb automatemyblog');
      console.log('   Or update DATABASE_URL in .env to point to existing database');
    } else if (error.message.includes('role') && error.message.includes('does not exist')) {
      console.log('\n🔧 Fix: Create the database user or update credentials in .env');
    } else if (error.message.includes('connection')) {
      console.log('\n🔧 Fix: Ensure PostgreSQL is running and accessible');
      console.log('   Local: brew services start postgresql');
      console.log('   Remote: Check your database hosting service');
    }
    
    process.exit(1);
  } finally {
    // Close the connection
    await db.close();
  }
}

// Run the test
testDatabaseSetup();