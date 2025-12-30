import db from './services/database.js';

/**
 * Test the fixed getLeadDetails method to ensure it returns organization intelligence data
 */

async function testLeadDetailsFix() {
  console.log('🧪 Testing Fixed getLeadDetails Method...\n');

  try {
    // First, find the Test Health Clinic lead ID
    const leadQuery = await db.query(`
      SELECT id, business_name FROM website_leads 
      WHERE website_url = 'https://testhealthclinic.com'
      ORDER BY created_at DESC 
      LIMIT 1
    `);

    if (leadQuery.rows.length === 0) {
      console.log('❌ No test health clinic lead found');
      return;
    }

    const leadId = leadQuery.rows[0].id;
    const businessName = leadQuery.rows[0].business_name;
    console.log(`✅ Found lead: ${businessName} (ID: ${leadId})`);

    // Test the fixed getLeadDetails method
    const { default: leadService } = await import('./services/leads.js');
    
    console.log('\n📊 Testing getLeadDetails with organization intelligence...');
    const leadDetails = await leadService.getLeadDetails(leadId);
    
    console.log('✅ getLeadDetails returned data:');
    console.log(`  Lead ID: ${leadDetails.id}`);
    console.log(`  Business Name: ${leadDetails.businessName}`);
    console.log(`  Organization ID: ${leadDetails.organizationId}`);
    console.log(`  Analysis Confidence Score: ${leadDetails.analysisConfidenceScore}`);
    console.log(`  Customer Scenarios Count: ${leadDetails.customerScenarios?.length || 0}`);
    console.log(`  Decision Makers Count: ${leadDetails.decisionMakers?.length || 0}`);
    console.log(`  Organization Name: ${leadDetails.organizationName}`);
    console.log(`  Business Model: ${leadDetails.businessModel}`);
    console.log(`  Target Audience: ${leadDetails.targetAudience}`);
    console.log(`  Brand Voice: ${leadDetails.brandVoice}`);
    
    // Check if this matches the expected results
    console.log('\n🎯 Expected vs Actual Results:');
    console.log(`  Expected Confidence: 0.85, Actual: ${leadDetails.analysisConfidenceScore}`);
    console.log(`  Expected Scenarios: 1, Actual: ${leadDetails.customerScenarios?.length || 0}`);
    console.log(`  Expected Decision Makers: 4, Actual: ${leadDetails.decisionMakers?.length || 0}`);
    console.log(`  Expected Organization ID: Present, Actual: ${leadDetails.organizationId ? 'Present' : 'Missing'}`);
    
    // Verify the frontend will now receive the correct data
    if (leadDetails.analysisConfidenceScore === 0.85 && 
        leadDetails.customerScenarios?.length === 1 && 
        leadDetails.decisionMakers?.length === 4 &&
        leadDetails.organizationId) {
      console.log('\n✅ SUCCESS: getLeadDetails now returns all organization intelligence data!');
      console.log('🎉 The detail modal should now show:');
      console.log('  - 85% Analysis Confidence');
      console.log('  - 1 Customer Scenario');
      console.log('  - 4 Decision Makers');
      console.log('  - Organization profile information');
    } else {
      console.log('\n❌ ISSUE: getLeadDetails still not returning expected data');
      console.log('Data returned:', JSON.stringify({
        organizationId: leadDetails.organizationId,
        analysisConfidenceScore: leadDetails.analysisConfidenceScore,
        customerScenariosLength: leadDetails.customerScenarios?.length,
        decisionMakersLength: leadDetails.decisionMakers?.length
      }, null, 2));
    }

    console.log('\n✅ Lead details fix test completed!');

  } catch (error) {
    console.error('❌ Test error:', error);
    throw error;
  }
}

// Run test
testLeadDetailsFix()
  .then(() => {
    console.log('\n🎉 Lead details test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Test failed:', error);
    process.exit(1);
  });