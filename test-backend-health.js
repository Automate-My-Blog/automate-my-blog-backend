import fetch from 'node-fetch';

/**
 * Test Backend Health and Accessibility
 */

async function testBackendHealth() {
  console.log('🏥 Testing Backend Health...\n');

  try {
    const productionUrls = [
      'https://automate-my-blog-backend-6uq7w8odm-automate-my-blog.vercel.app/api',
      'https://automate-my-blog-backend-6uq7w8odm-automate-my-blog.vercel.app/health',
      'https://automate-my-blog-backend-6uq7w8odm-automate-my-blog.vercel.app'
    ];

    for (const url of productionUrls) {
      console.log(`🔍 Testing: ${url}`);
      
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Health-Check-Test'
          },
          timeout: 10000
        });
        
        console.log(`  Status: ${response.status}`);
        console.log(`  Content-Type: ${response.headers.get('content-type')}`);
        
        if (response.ok) {
          const text = await response.text();
          console.log(`  Response: ${text.substring(0, 200)}...`);
          
          try {
            const json = JSON.parse(text);
            console.log('  ✅ Valid JSON response');
            if (json.message) console.log(`  Message: ${json.message}`);
            if (json.available_endpoints) {
              console.log(`  Available endpoints: ${Object.keys(json.available_endpoints).length}`);
            }
          } catch {
            console.log('  📄 HTML/Text response (not JSON)');
          }
          
        } else {
          const text = await response.text();
          console.log(`  ❌ Error response: ${text.substring(0, 100)}...`);
        }
        
      } catch (error) {
        console.log(`  ❌ Request failed: ${error.message}`);
      }
      
      console.log('');
    }

    console.log('✅ Backend health check completed!');

  } catch (error) {
    console.error('❌ Health check error:', error);
    throw error;
  }
}

// Run test
testBackendHealth()
  .then(() => {
    console.log('\n🎉 Health check complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Health check failed:', error);
    process.exit(1);
  });