import authService from './services/auth.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testAuthDirect() {
  console.log('🧪 Testing Auth Service Database Integration...\n');
  
  try {
    // Get storage status
    const authStatus = authService.getStorageStatus();
    console.log('📊 Auth Service Status:', authStatus);
    
    // Force database connection test
    if (authService.testDatabaseConnection) {
      await authService.testDatabaseConnection();
    }
    
    // Test login (user should already exist from previous test)
    console.log('\n1️⃣ Testing login...');
    const userData = {
      email: 'test-direct@automatemyblog.com',
      password: 'testPassword123!',
      firstName: 'Test', 
      lastName: 'Direct',
      organizationName: 'Direct Test Org'
    };
    
    const loginResult = await authService.login(userData.email, userData.password);
    console.log('✅ Login result:', {
      userId: loginResult.user.id,
      email: loginResult.user.email,
      organizationName: loginResult.user.organizationName,
      organizationId: loginResult.user.organizationId,
      organizationRole: loginResult.user.organizationRole,
      billingStatus: loginResult.user.billingStatus,
      usageLimit: loginResult.user.usageLimit,
      currentUsage: loginResult.user.currentUsage
    });
    
    console.log('\n🎉 Auth database integration test completed!');
    
  } catch (error) {
    console.error('💥 Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    process.exit(0);
  }
}

testAuthDirect();