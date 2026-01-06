import axios from 'axios';

const API_BASE = 'http://localhost:3001/api/v1';

// Direct test of the adoption logic
async function testAdoptionDirect() {
  console.log('🔬 Testing session adoption logic directly...\n');

  const testSessionId = `test-session-${Date.now()}`;
  const mockUserId = '12345678-1234-4234-8234-' + Date.now().toString().slice(-12);

  try {
    // Step 1: Create session data
    console.log('📝 Creating test session data...');
    const audienceData = {
      target_segment: {
        demographics: 'Test users',
        psychographics: 'Testing focused',
        searchBehavior: 'Looking for bugs'
      },
      customer_problem: 'Need to test session adoption'
    };

    const createResponse = await axios.post(`${API_BASE}/audiences`, audienceData, {
      headers: {
        'x-session-id': testSessionId
      }
    });

    console.log('✅ Session data created:', createResponse.data.success);

    // Step 2: Test authenticated request with session ID (should trigger adoption)
    console.log('\n🔄 Testing authenticated request with session ID...');
    const adoptionResponse = await axios.get(`${API_BASE}/audiences`, {
      headers: {
        'x-mock-user-id': mockUserId,
        'x-session-id': testSessionId
      }
    });

    console.log('📊 Response from authenticated request:');
    console.log('   Success:', adoptionResponse.data.success);
    console.log('   Audiences found:', adoptionResponse.data.audiences.length);
    console.log('   Session adoption info:', adoptionResponse.data.sessionAdoption);

    // Step 3: Test if we can access data as user without session ID
    console.log('\n👤 Testing user data access without session ID...');
    const userResponse = await axios.get(`${API_BASE}/audiences`, {
      headers: {
        'x-mock-user-id': mockUserId
      }
    });

    console.log('📊 User data response:');
    console.log('   Success:', userResponse.data.success);
    console.log('   Audiences found:', userResponse.data.audiences.length);

    // Step 4: Check if session data still exists
    console.log('\n🗂️ Checking if session data still exists...');
    const sessionResponse = await axios.get(`${API_BASE}/audiences`, {
      headers: {
        'x-session-id': testSessionId
      }
    });

    console.log('📊 Session data response:');
    console.log('   Success:', sessionResponse.data.success);
    console.log('   Audiences found:', sessionResponse.data.audiences.length);

    // Analysis
    console.log('\n📋 Analysis:');
    if (adoptionResponse.data.sessionAdoption && adoptionResponse.data.sessionAdoption.adopted) {
      console.log('✅ Session adoption triggered successfully');
    } else {
      console.log('❌ Session adoption did not trigger');
    }

    if (userResponse.data.audiences.length > 0) {
      console.log('✅ User can access data without session ID');
    } else {
      console.log('❌ User cannot access data without session ID');
    }

    if (sessionResponse.data.audiences.length === 0) {
      console.log('✅ Session data properly adopted (no longer accessible via session)');
    } else {
      console.log('❌ Session data still accessible via session ID');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testAdoptionDirect().catch(error => {
  console.error('💥 Test execution failed:', error);
});