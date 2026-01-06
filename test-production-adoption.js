import axios from 'axios';

// Test the production /adopt-session endpoint directly to see what it returns
async function testProductionAdoption() {
  console.log('🧪 Testing production /adopt-session endpoint...\n');
  
  const testSessionId = `prod-debug-${Date.now()}`;
  
  try {
    // Create a fake JWT token for testing (this won't work but will show us the error)
    const fakeToken = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0LXVzZXItaWQifQ.fake';
    
    console.log('📡 Calling production endpoint...');
    
    const response = await axios.post('https://automate-my-blog-backend.vercel.app/api/v1/users/adopt-session', {
      session_id: testSessionId
    }, {
      headers: {
        'Authorization': fakeToken,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Response received:');
    console.log('   Status:', response.status);
    console.log('   Data:', JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.log('❌ Error response:');
    console.log('   Status:', error.response?.status);
    console.log('   Error data:', JSON.stringify(error.response?.data, null, 2));
    
    if (error.response?.status === 401) {
      console.log('\n🔍 This confirms the endpoint requires authentication');
      console.log('   The issue is likely that the optionalAuthMiddleware change did not deploy');
    }
  }
}

testProductionAdoption().catch(error => {
  console.error('💥 Test execution failed:', error.message);
});