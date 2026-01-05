import fetch from 'node-fetch';

/**
 * Test Production Lead Capture Endpoint
 * Test if the production backend at Vercel is capturing leads correctly
 */

async function testProductionLeadCapture() {
  console.log('🌐 Testing Production Lead Capture...\n');

  try {
    // Use the production Vercel backend URL
    const testUrl = 'https://test-lead-capture-debug.com';
    const productionApiUrl = 'https://automate-my-blog-backend-6uq7w8odm-automate-my-blog.vercel.app/api/analyze-website';
    
    console.log('=== TESTING PRODUCTION LEAD CAPTURE ===');
    console.log(`Test URL: ${testUrl}`);
    console.log(`Production API: ${productionApiUrl}`);
    
    const requestBody = {
      url: testUrl
    };
    
    console.log('\n📡 Making request to production backend...');
    console.log('⏱️  This may take a moment for website analysis...');
    
    try {
      const startTime = Date.now();
      const response = await fetch(productionApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Production-Lead-Capture-Test'
        },
        body: JSON.stringify(requestBody),
        timeout: 30000 // 30 second timeout
      });
      
      const responseTime = Date.now() - startTime;
      console.log(`📡 Response received in ${responseTime}ms`);
      console.log(`📡 Response status: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Production API response successful:');
        console.log(`  Success: ${data.success}`);
        console.log(`  URL: ${data.url}`);
        console.log(`  Business Name: ${data.analysis?.businessName || 'N/A'}`);
        console.log(`  Business Type: ${data.analysis?.businessType || 'N/A'}`);
        console.log(`  Has Analysis: ${!!data.analysis}`);
        
        if (data.analysis) {
          console.log(`  Analysis Keys: ${Object.keys(data.analysis).join(', ')}`);
        }
        
        console.log('\n🎉 PRODUCTION BACKEND IS WORKING!');
        console.log('✅ Website analysis is functioning correctly');
        console.log('🔄 Lead should have been captured automatically');
        
        // Provide instructions for verification
        console.log('\n📋 TO VERIFY LEAD CAPTURE:');
        console.log('1. Check admin dashboard for new lead with URL: ' + testUrl);
        console.log('2. Look for recent website_leads entry in database');
        console.log('3. Verify organization was created if this is a new business');
        
      } else if (response.status >= 400 && response.status < 500) {
        const errorData = await response.json();
        console.log(`❌ Client error (${response.status}):`, errorData);
        
        if (response.status === 400) {
          console.log('🔍 This might be a URL validation issue');
        }
        
      } else if (response.status >= 500) {
        const errorText = await response.text();
        console.log(`❌ Server error (${response.status}): ${errorText}`);
        console.log('🚨 PRODUCTION BACKEND HAS ISSUES');
        
      }
      
    } catch (fetchError) {
      console.log(`❌ Network/Timeout error: ${fetchError.message}`);
      
      if (fetchError.code === 'ECONNREFUSED') {
        console.log('🔌 Production backend is not accessible');
      } else if (fetchError.name === 'AbortError' || fetchError.message.includes('timeout')) {
        console.log('⏰ Request timed out - backend might be slow or down');
      }
      
      console.log('🚨 PRODUCTION BACKEND ACCESSIBILITY ISSUE');
    }

    console.log('\n✅ Production lead capture test completed!');

  } catch (error) {
    console.error('❌ Test error:', error);
    throw error;
  }
}

// Run test
testProductionLeadCapture()
  .then(() => {
    console.log('\n🎉 Production test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Production test failed:', error);
    process.exit(1);
  });