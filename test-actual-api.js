import fetch from 'node-fetch';

/**
 * Test the actual API endpoint that the frontend calls
 * This will test the complete API flow including authentication
 */

async function testActualAPI() {
  console.log('🌐 Testing Actual API Endpoint that Frontend Calls...\n');

  try {
    // Test the leads API endpoint directly
    const apiUrl = 'http://localhost:3001/api/v1/admin/leads';
    
    console.log('=== TESTING LEADS API ENDPOINT ===');
    console.log(`URL: ${apiUrl}`);
    
    // For testing, we'll need authentication. Let me check if there's test credentials
    const testApiKey = process.env.TEST_API_KEY || 'test-key';
    
    console.log('🔐 Testing with basic API call (no auth for now)...');
    
    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Test-Script'
        }
      });
      
      console.log(`📡 Response status: ${response.status}`);
      console.log(`📡 Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2)}`);
      
      if (response.status === 401) {
        console.log('🔒 Authentication required - this is expected');
        console.log('ℹ️  The API requires super admin authentication');
        
        // Test if server is running and responds
        const healthCheck = await fetch('http://localhost:3001/api', {
          method: 'GET'
        });
        
        if (healthCheck.ok) {
          const healthData = await healthCheck.json();
          console.log('✅ Backend server is running');
          console.log(`📊 API info: ${JSON.stringify(healthData, null, 2)}`);
        } else {
          console.log('❌ Backend server health check failed');
        }
        
      } else if (response.ok) {
        const data = await response.json();
        console.log('✅ Unexpected success - API returned data without auth:');
        console.log(JSON.stringify(data, null, 2));
      } else {
        const errorText = await response.text();
        console.log(`❌ API returned error: ${errorText}`);
      }
      
    } catch (fetchError) {
      if (fetchError.code === 'ECONNREFUSED') {
        console.log('🔌 Backend server not running - need to start it');
        console.log('💡 Try running: npm start in backend directory');
      } else {
        console.log(`❌ Fetch error: ${fetchError.message}`);
      }
    }

    // Test if we can call the leads service directly (bypass API layer)
    console.log('\n=== TESTING LEADS SERVICE DIRECTLY ===');
    try {
      const { default: leadService } = await import('./services/leads.js');
      
      console.log('📊 Testing leadService.getLeads() directly...');
      const leadsResult = await leadService.getLeads({
        limit: 5,
        offset: 0,
        status: 'all',
        source: 'all',
        sortBy: 'created_at',
        sortOrder: 'DESC'
      });
      
      console.log(`✅ Leads service returned ${leadsResult.leads.length} leads`);
      
      // Find the test health clinic lead
      const testLead = leadsResult.leads.find(lead => 
        lead.websiteUrl === 'https://testhealthclinic.com'
      );
      
      if (testLead) {
        console.log('\n🎯 Found Test Health Clinic lead in service response:');
        console.log(`  ID: ${testLead.id}`);
        console.log(`  Organization ID: ${testLead.organizationId}`);
        console.log(`  Analysis Confidence: ${testLead.analysisConfidenceScore}`);
        console.log(`  Customer Scenarios: ${testLead.customerScenarios?.length || 0}`);
        console.log(`  Decision Makers: ${testLead.decisionMakers?.length || 0}`);
        
        // Check the exact data types and values
        console.log('\n📋 Detailed Data Analysis:');
        console.log(`  customerScenarios type: ${typeof testLead.customerScenarios}`);
        console.log(`  customerScenarios isArray: ${Array.isArray(testLead.customerScenarios)}`);
        console.log(`  decisionMakers type: ${typeof testLead.decisionMakers}`);
        console.log(`  decisionMakers isArray: ${Array.isArray(testLead.decisionMakers)}`);
        
        if (testLead.analysisConfidenceScore === 0) {
          console.log('  ❌ ISSUE: analysisConfidenceScore is 0 (should be 0.85)');
        }
        if (!testLead.customerScenarios || testLead.customerScenarios.length === 0) {
          console.log('  ❌ ISSUE: customerScenarios is empty (should have 1 scenario)');
        }
        if (!testLead.decisionMakers || testLead.decisionMakers.length === 0) {
          console.log('  ❌ ISSUE: decisionMakers is empty (should have 4 contacts)');
        }
        
        // Show the full lead object structure for debugging
        console.log('\n🔍 Full Lead Object Keys:');
        console.log(Object.keys(testLead).join(', '));
        
      } else {
        console.log('❌ Test Health Clinic lead not found in service response');
        console.log(`Available leads: ${leadsResult.leads.map(l => l.websiteUrl).join(', ')}`);
      }
      
    } catch (serviceError) {
      console.log(`❌ Leads service error: ${serviceError.message}`);
      console.error(serviceError);
    }

    console.log('\n✅ API endpoint testing completed!');

  } catch (error) {
    console.error('❌ API test error:', error);
    throw error;
  }
}

// Run test
testActualAPI()
  .then(() => {
    console.log('\n🎉 API endpoint validation complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 API test failed:', error);
    process.exit(1);
  });