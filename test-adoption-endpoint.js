import axios from 'axios';
import db from './services/database.js';
import { randomUUID } from 'crypto';

// Test the /adopt-session endpoint directly to debug the response format issue
async function testAdoptionEndpoint() {
  console.log('🧪 Testing /adopt-session endpoint response format...\n');

  const testSessionId = `endpoint-test-${Date.now()}`;
  const testUserId = randomUUID();
  
  try {
    // Step 1: Create a real user in the database
    console.log('👤 Creating test user in database...');
    
    await db.query(`
      INSERT INTO users (id, email, password_hash, first_name, last_name)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      testUserId,
      `endpoint-test-${Date.now()}@example.com`,
      'hashed_password_placeholder',
      'Endpoint',
      'Test'
    ]);
    
    console.log(`✅ Created user with ID: ${testUserId}`);

    // Step 2: Create session data in database
    console.log('\n📝 Creating test audience data...');
    
    const insertResult = await db.query(`
      INSERT INTO audiences (session_id, target_segment, customer_problem, priority)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [
      testSessionId,
      JSON.stringify({
        demographics: 'Endpoint test users',
        psychographics: 'Response format validation',
        searchBehavior: 'API testing approach'
      }),
      'Need to verify endpoint response format',
      1  // Use integer priority instead of string
    ]);

    console.log(`✅ Created audience with ID: ${insertResult.rows[0].id}`);

    // Step 3: Test the /adopt-session endpoint directly
    console.log('\n🔄 Testing /adopt-session endpoint...');
    
    const adoptionResponse = await axios.post('http://localhost:3001/api/v1/users/adopt-session', {
      session_id: testSessionId
    }, {
      headers: {
        'x-mock-user-id': testUserId,
        'Content-Type': 'application/json'
      }
    });

    console.log('📊 Adoption endpoint response:');
    console.log('   Status:', adoptionResponse.status);
    console.log('   Success:', adoptionResponse.data?.success);
    console.log('   Message:', adoptionResponse.data?.message);
    console.log('   Adopted counts:', adoptionResponse.data?.adopted);
    console.log('   Response data type:', typeof adoptionResponse.data);
    console.log('   Full response:', JSON.stringify(adoptionResponse.data, null, 2));

    // Step 4: Test the production URL endpoint
    console.log('\n🌐 Testing production endpoint...');
    
    try {
      const prodResponse = await axios.post('https://automate-my-blog-backend.vercel.app/api/v1/users/adopt-session', {
        session_id: testSessionId
      }, {
        headers: {
          'x-mock-user-id': testUserId,
          'Content-Type': 'application/json'
        }
      });

      console.log('📊 Production endpoint response:');
      console.log('   Status:', prodResponse.status);
      console.log('   Success:', prodResponse.data?.success);
      console.log('   Message:', prodResponse.data?.message);
      console.log('   Adopted counts:', prodResponse.data?.adopted);
      console.log('   Response data type:', typeof prodResponse.data);
      console.log('   Full response:', JSON.stringify(prodResponse.data, null, 2));

    } catch (prodError) {
      console.log('❌ Production endpoint error:', prodError.response?.status, prodError.response?.statusText);
      console.log('   Error data:', prodError.response?.data);
    }

    return true;

  } catch (error) {
    console.error('💥 Test failed:', error.response?.data || error.message);
    console.error('   Status:', error.response?.status);
    console.error('   Full error:', error);
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

testAdoptionEndpoint().catch(error => {
  console.error('💥 Test execution failed:', error);
});