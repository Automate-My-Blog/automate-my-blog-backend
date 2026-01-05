import fetch from 'node-fetch';

/**
 * Test Lead Capture Endpoint
 * Test the POST /api/analyze-website endpoint to see if lead capture is working
 */

async function testLeadCaptureEndpoint() {
  console.log('🧪 Testing Lead Capture Endpoint...\n');

  try {
    const testUrl = 'https://example-test-business.com';
    const apiEndpoint = 'http://localhost:3001/api/analyze-website';
    
    console.log('=== TESTING LEAD CAPTURE ENDPOINT ===');
    console.log(`Test URL: ${testUrl}`);
    console.log(`API Endpoint: ${apiEndpoint}`);
    
    const requestBody = {
      url: testUrl
    };
    
    console.log('\n📡 Making request to lead capture endpoint...');
    
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Lead-Capture-Test-Script'
        },
        body: JSON.stringify(requestBody)
      });
      
      console.log(`📡 Response status: ${response.status}`);
      console.log(`📡 Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2)}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ API response successful:');
        console.log(`  Success: ${data.success}`);
        console.log(`  URL: ${data.url}`);
        console.log(`  Business Name: ${data.analysis?.businessName || 'N/A'}`);
        console.log(`  Business Type: ${data.analysis?.businessType || 'N/A'}`);
        console.log(`  Analysis Keys: ${Object.keys(data.analysis || {}).join(', ')}`);
        
        // Now check if a lead was actually created
        console.log('\n🔍 Checking if lead was captured in database...');
        
        const { default: db } = await import('./services/database.js');
        
        const leadCheck = await db.query(`
          SELECT 
            id, 
            website_url, 
            business_name, 
            lead_source, 
            status,
            organization_id,
            created_at
          FROM website_leads 
          WHERE website_url = $1 
          ORDER BY created_at DESC 
          LIMIT 1
        `, [testUrl]);
        
        if (leadCheck.rows.length > 0) {
          const lead = leadCheck.rows[0];
          console.log('✅ Lead found in database:');
          console.log(`  Lead ID: ${lead.id}`);
          console.log(`  Business Name: ${lead.business_name}`);
          console.log(`  Lead Source: ${lead.lead_source}`);
          console.log(`  Status: ${lead.status}`);
          console.log(`  Organization ID: ${lead.organization_id || 'None'}`);
          console.log(`  Created: ${lead.created_at}`);
          
          console.log('\n🎉 LEAD CAPTURE IS WORKING!');
        } else {
          console.log('❌ No lead found in database for test URL');
          console.log('🚨 LEAD CAPTURE FAILED - API succeeded but no lead was stored');
        }
        
      } else {
        const errorText = await response.text();
        console.log(`❌ API returned error: ${response.status}`);
        console.log(`Error response: ${errorText}`);
      }
      
    } catch (fetchError) {
      if (fetchError.code === 'ECONNREFUSED') {
        console.log('🔌 Backend server not running locally');
        console.log('💡 This could be the issue - backend needs to be running to capture leads');
        console.log('');
        console.log('🎯 POSSIBLE ROOT CAUSE IDENTIFIED:');
        console.log('If the production backend is down or not responding,');
        console.log('lead capture requests would fail silently.');
      } else {
        console.log(`❌ Fetch error: ${fetchError.message}`);
      }
    }

    console.log('\n✅ Lead capture endpoint testing completed!');

  } catch (error) {
    console.error('❌ Test error:', error);
    throw error;
  }
}

// Run test
testLeadCaptureEndpoint()
  .then(() => {
    console.log('\n🎉 Lead capture endpoint test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Test failed:', error);
    process.exit(1);
  });