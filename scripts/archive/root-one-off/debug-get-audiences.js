import axios from 'axios';

// Debug the GET /audiences endpoint to see why it's returning 0 results after adoption
async function debugGetAudiences() {
  console.log('🔍 Testing GET /audiences endpoint behavior...\n');
  
  try {
    // Use a valid JWT token from the user's session
    const token = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJlNDEyODc4Yy1lODE5LTRlODEtODVhZS01OGQ4ZWQ5OGE0NjMiLCJlbWFpbCI6InRlc3QxNzY3NjY5ODM1NzgzQGV4YW1wbGUuY29tIiwiaWF0IjoxNzY3NjY5ODM3LCJleHAiOjE3Njg0NDk4Mzd9.ufVStv_LctJHy-iTSqBIZe2n5QHZDS5HA8oTqrcJaUU';
    
    console.log('📡 Making GET request to /audiences...');
    console.log('   With session ID:', 'session_1767660567746_rbo6j7qye');
    
    const response = await axios.get('https://automate-my-blog-backend.vercel.app/api/v1/audiences?limit=20', {
      headers: {
        'Authorization': token,
        'x-session-id': 'session_1767660567746_rbo6j7qye',
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ GET /audiences response:');
    console.log('   Status:', response.status);
    console.log('   Audiences count:', response.data?.audiences?.length || 0);
    console.log('   Success:', response.data?.success);
    console.log('   Session adoption info:', response.data?.sessionAdoption);
    console.log('   Full response:', JSON.stringify(response.data, null, 2));

    if (response.data?.audiences?.length === 0) {
      console.log('\n❌ ISSUE CONFIRMED: GET /audiences returns 0 results');
      console.log('   This explains why the frontend verification fails');
    } else {
      console.log('\n✅ SUCCESS: GET /audiences returns data');
    }

  } catch (error) {
    console.log('❌ Error calling GET /audiences:');
    console.log('   Status:', error.response?.status);
    console.log('   Error data:', JSON.stringify(error.response?.data, null, 2));
  }
}

debugGetAudiences().catch(error => {
  console.error('💥 Debug execution failed:', error.message);
});