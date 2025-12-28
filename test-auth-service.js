import DatabaseAuthService from './services/auth-database.js';
const authService = new DatabaseAuthService();

// Test authentication service (both database and in-memory modes)
async function testAuthService() {
  console.log('🧪 Testing Authentication Service...\n');
  
  try {
    // Get service status
    if (authService.getStorageStatus) {
      const status = authService.getStorageStatus();
      console.log('📊 Auth Service Status:');
      console.log(`   Mode: ${status.mode}`);
      console.log(`   Database Available: ${status.databaseAvailable}`);
      console.log(`   Use Database: ${status.useDatabaseStorage}`);
      if (status.userCount !== 'N/A') {
        console.log(`   In-Memory Users: ${status.userCount}`);
      }
      console.log('');
    }
    
    // Test 1: User Registration
    console.log('1️⃣ Testing user registration...');
    const testUser = {
      email: 'test@automatemyblog.com',
      password: 'testPassword123!',
      firstName: 'Test',
      lastName: 'User',
      organizationName: 'Test Organization'
    };
    
    let registrationResult;
    try {
      registrationResult = await authService.register(testUser);
      console.log('✅ Registration successful');
      console.log(`   User ID: ${registrationResult.user.id}`);
      console.log(`   Email: ${registrationResult.user.email}`);
      console.log(`   Name: ${registrationResult.user.firstName} ${registrationResult.user.lastName}`);
      console.log(`   Referral Code: ${registrationResult.user.referralCode}`);
      console.log(`   Plan: ${registrationResult.user.planTier}`);
      console.log(`   Access Token: ${registrationResult.accessToken ? '✅ Generated' : '❌ Missing'}`);
    } catch (error) {
      console.log(`❌ Registration failed: ${error.message}`);
      return;
    }
    
    // Test 2: User Login
    console.log('\n2️⃣ Testing user login...');
    try {
      const loginResult = await authService.login(testUser.email, testUser.password);
      console.log('✅ Login successful');
      console.log(`   User ID: ${loginResult.user.id}`);
      console.log(`   Session ID: ${loginResult.sessionId || 'N/A'}`);
      console.log(`   Access Token: ${loginResult.accessToken ? '✅ Valid' : '❌ Missing'}`);
    } catch (error) {
      console.log(`❌ Login failed: ${error.message}`);
    }
    
    // Test 3: Token Verification
    console.log('\n3️⃣ Testing token verification...');
    try {
      const decoded = authService.verifyToken(registrationResult.accessToken);
      console.log('✅ Token verification successful');
      console.log(`   User ID: ${decoded.userId}`);
      console.log(`   Email: ${decoded.email}`);
      console.log(`   Plan: ${decoded.planTier}`);
    } catch (error) {
      console.log(`❌ Token verification failed: ${error.message}`);
    }
    
    // Test 4: Get User by ID
    console.log('\n4️⃣ Testing get user by ID...');
    try {
      const user = await authService.getUserById(registrationResult.user.id);
      console.log('✅ Get user successful');
      console.log(`   Email: ${user.email}`);
      console.log(`   Plan: ${user.planTier}`);
      console.log(`   Status: ${user.billingStatus || 'N/A'}`);
    } catch (error) {
      console.log(`❌ Get user failed: ${error.message}`);
    }
    
    // Test 5: Duplicate Registration (should fail)
    console.log('\n5️⃣ Testing duplicate registration (should fail)...');
    try {
      await authService.register(testUser);
      console.log('❌ Duplicate registration should have failed');
    } catch (error) {
      console.log('✅ Duplicate registration properly rejected:', error.message);
    }
    
    // Test 6: Invalid Login (should fail)
    console.log('\n6️⃣ Testing invalid login (should fail)...');
    try {
      await authService.login(testUser.email, 'wrongpassword');
      console.log('❌ Invalid login should have failed');
    } catch (error) {
      console.log('✅ Invalid login properly rejected:', error.message);
    }
    
    // Test 7: Token Refresh
    console.log('\n7️⃣ Testing token refresh...');
    try {
      const refreshedTokens = await authService.refreshTokens(registrationResult.refreshToken);
      console.log('✅ Token refresh successful');
      console.log(`   New Access Token: ${refreshedTokens.accessToken ? '✅ Generated' : '❌ Missing'}`);
    } catch (error) {
      console.log(`❌ Token refresh failed: ${error.message}`);
    }
    
    // Test 8: Get All Users (admin function)
    console.log('\n8️⃣ Testing get all users...');
    try {
      const allUsers = await authService.getAllUsers();
      console.log('✅ Get all users successful');
      console.log(`   Total users: ${allUsers.length}`);
      if (allUsers.length > 0) {
        console.log(`   First user: ${allUsers[0].email}`);
      }
    } catch (error) {
      console.log(`❌ Get all users failed: ${error.message}`);
    }
    
    console.log('\n🎉 Authentication service test completed!');
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', error);
  } finally {
    // Clean up (for database mode)
    if (authService.isDatabaseMode && authService.isDatabaseMode()) {
      console.log('\n🧹 Cleaning up test data...');
      // Note: In production, you might want to clean up test data
      // For now, we'll leave it for inspection
    }
    
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Test interrupted');
  process.exit(0);
});

// Run the test
testAuthService().catch(console.error);