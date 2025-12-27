import db from './services/database.js';

// Quick verification script for Vercel PostgreSQL connection
async function verifyConnection() {
  console.log('🔍 Verifying Vercel PostgreSQL connection...\n');
  
  try {
    console.log('Environment check:');
    console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '✅ Set' : '❌ Missing'}`);
    console.log(`   DATABASE_URL format: ${process.env.DATABASE_URL?.includes('vercel') ? '✅ Vercel format' : '⚠️ Not Vercel format'}`);
    
    console.log('\n🔗 Testing connection...');
    const connected = await db.testConnection();
    
    if (connected) {
      console.log('\n📊 Getting database info...');
      const healthStats = await db.getHealthStats();
      
      console.log('Database Details:');
      console.log(`   Size: ${healthStats.databaseSize}`);
      console.log(`   Tables: ${healthStats.tableCount}`);
      console.log(`   Active Connections: ${healthStats.activeConnections}`);
      
      console.log('\n✅ Connection verified successfully!');
      console.log('🚀 Ready to run database setup with: npm run setup-db');
    } else {
      console.log('\n❌ Connection failed');
      console.log('\n🔧 Next steps:');
      console.log('   1. Copy your DATABASE_URL from Vercel dashboard');
      console.log('   2. Update the DATABASE_URL in your .env file');
      console.log('   3. Make sure it includes ?sslmode=require');
      console.log('   4. Run this verification script again');
    }
    
  } catch (error) {
    console.error('\n💥 Verification failed:', error.message);
    
    if (error.message.includes('database') && error.message.includes('does not exist')) {
      console.log('\n🔧 Database does not exist. Check:');
      console.log('   - Database name in connection string');
      console.log('   - Vercel PostgreSQL dashboard');
    } else if (error.message.includes('authentication')) {
      console.log('\n🔧 Authentication failed. Check:');
      console.log('   - Username and password in DATABASE_URL');
      console.log('   - Connection string format');
    } else if (error.message.includes('connect')) {
      console.log('\n🔧 Connection failed. Check:');
      console.log('   - Network connectivity');
      console.log('   - SSL requirement (?sslmode=require)');
      console.log('   - Vercel database status');
    }
  } finally {
    await db.close();
  }
}

verifyConnection().catch(console.error);