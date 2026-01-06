import db from './services/database.js';
import axios from 'axios';
import { randomUUID } from 'crypto';

const API_BASE = 'http://localhost:3001/api/v1';

// Test session adoption with a real user in the database
async function testRealAdoption() {
  console.log('🧪 Testing session adoption with real user...\n');

  const testSessionId = `real-test-${Date.now()}`;
  const testUserId = randomUUID(); // Generate a proper UUID
  
  try {
    // Step 1: Create a real user in the database
    console.log('👤 Creating test user in database...');
    
    await db.query(`
      INSERT INTO users (id, email, password_hash, first_name, last_name)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      testUserId,
      `test-${Date.now()}@example.com`,
      'hashed_password_placeholder',
      'Test',
      'User'
    ]);
    
    console.log(`✅ Created user with ID: ${testUserId}`);

    // Step 2: Create session data as logged-out user
    console.log('\n📝 Creating audience data for session...');
    
    const audienceData = {
      target_segment: {
        demographics: 'Real test users',
        psychographics: 'Validation focused',
        searchBehavior: 'Thorough testing approach'
      },
      customer_problem: 'Need to verify session adoption works with real users'
    };

    const createResponse = await axios.post(`${API_BASE}/audiences`, audienceData, {
      headers: {
        'x-session-id': testSessionId
      }
    });

    if (!createResponse.data.success) {
      throw new Error('Failed to create audience data');
    }

    console.log(`✅ Created audience with ID: ${createResponse.data.audience.id}`);

    // Step 3: Verify session data exists
    console.log('\n📊 Verifying session data exists...');
    
    const sessionResponse = await axios.get(`${API_BASE}/audiences`, {
      headers: {
        'x-session-id': testSessionId
      }
    });

    console.log(`Found ${sessionResponse.data.audiences.length} audience(s) for session`);

    // Step 4: Test adoption with real user ID
    console.log('\n🔄 Testing adoption with real authenticated user...');
    
    const adoptionResponse = await axios.get(`${API_BASE}/audiences`, {
      headers: {
        'x-mock-user-id': testUserId, // Real user ID that exists in database
        'x-session-id': testSessionId
      }
    });

    console.log('📊 Adoption response:');
    console.log('   Success:', adoptionResponse.data.success);
    console.log('   Audiences found:', adoptionResponse.data.audiences.length);
    console.log('   Session adoption:', adoptionResponse.data.sessionAdoption);

    // Step 5: Verify user can access data without session ID
    console.log('\n👤 Testing user access without session ID...');
    
    const userResponse = await axios.get(`${API_BASE}/audiences`, {
      headers: {
        'x-mock-user-id': testUserId
        // No session ID
      }
    });

    console.log('📊 User data access:');
    console.log('   Success:', userResponse.data.success);
    console.log('   Audiences found:', userResponse.data.audiences.length);

    // Step 6: Verify session data is no longer accessible
    console.log('\n🗑️ Verifying session data is no longer accessible...');
    
    const orphanedSessionResponse = await axios.get(`${API_BASE}/audiences`, {
      headers: {
        'x-session-id': testSessionId
        // No authentication
      }
    });

    console.log('📊 Orphaned session check:');
    console.log('   Success:', orphanedSessionResponse.data.success);
    console.log('   Audiences found:', orphanedSessionResponse.data.audiences.length);

    // Results analysis
    console.log('\n📋 Test Results:');
    
    const adoptionWorked = adoptionResponse.data.sessionAdoption && adoptionResponse.data.sessionAdoption.adopted;
    const userCanAccessData = userResponse.data.audiences.length > 0;
    const sessionDataGone = orphanedSessionResponse.data.audiences.length === 0;
    
    console.log(`✅ Session adoption triggered: ${adoptionWorked ? 'YES' : 'NO'}`);
    console.log(`✅ User can access data: ${userCanAccessData ? 'YES' : 'NO'}`);
    console.log(`✅ Session data properly transferred: ${sessionDataGone ? 'YES' : 'NO'}`);
    
    if (adoptionWorked && userCanAccessData && sessionDataGone) {
      console.log('\n🎉 SUCCESS: Session adoption flow works correctly!');
      return true;
    } else {
      console.log('\n❌ FAILURE: Session adoption flow has issues');
      return false;
    }

  } catch (error) {
    console.error('💥 Test failed:', error.response?.data || error.message);
    return false;
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    try {
      await db.query(`DELETE FROM audiences WHERE session_id = $1 OR user_id = $2`, [testSessionId, testUserId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
      console.log('✅ Cleanup completed');
    } catch (cleanupError) {
      console.error('⚠️ Cleanup failed:', cleanupError);
    }
  }
}

testRealAdoption().catch(error => {
  console.error('💥 Test execution failed:', error);
});