import db from './services/database.js';
import fetch from 'node-fetch';

/**
 * Production Diagnosis - Test Exact Frontend Issue
 * This script tests what the frontend actually receives from production
 */

async function diagnoseProductionIssue() {
  console.log('🔍 Diagnosing Production Frontend Issue...\n');

  try {
    // 1. Test database state (already confirmed working)
    console.log('=== DATABASE STATE CONFIRMATION ===');
    const testLeadQuery = `
      SELECT 
        wl.id,
        wl.organization_id,
        wl.business_name,
        oi.analysis_confidence_score,
        oi.customer_scenarios,
        get_organization_decision_makers(wl.organization_id) as decision_makers
      FROM website_leads wl
      LEFT JOIN organizations o ON wl.organization_id = o.id
      LEFT JOIN organization_intelligence oi ON o.id = oi.organization_id AND oi.is_current = TRUE
      WHERE wl.website_url = 'https://testhealthclinic.com'
      ORDER BY wl.created_at DESC
      LIMIT 1;
    `;
    
    const dbResult = await db.query(testLeadQuery);
    if (dbResult.rows.length > 0) {
      const row = dbResult.rows[0];
      console.log('✅ Database has correct data:');
      console.log(`  Confidence Score: ${row.analysis_confidence_score}`);
      console.log(`  Has Customer Scenarios: ${!!row.customer_scenarios}`);
      console.log(`  Has Decision Makers: ${!!row.decision_makers}`);
    } else {
      console.log('❌ No test data found in database');
      return;
    }

    // 2. Test leads service directly (bypass API authentication) 
    console.log('\n=== LEADS SERVICE DIRECT TEST ===');
    const { default: leadService } = await import('./services/leads.js');
    
    const serviceResult = await leadService.getLeads({
      limit: 10,
      offset: 0,
      status: 'all',
      source: 'all',
      search: 'testhealthclinic.com'
    });
    
    const testLead = serviceResult.leads.find(lead => 
      lead.websiteUrl === 'https://testhealthclinic.com'
    );
    
    if (testLead) {
      console.log('✅ Leads service returns correct data:');
      console.log(`  Organization ID: ${testLead.organizationId}`);
      console.log(`  Analysis Confidence Score: ${testLead.analysisConfidenceScore}`);
      console.log(`  Customer Scenarios Count: ${testLead.customerScenarios?.length || 0}`);
      console.log(`  Decision Makers Count: ${testLead.decisionMakers?.length || 0}`);
      
      // This is exactly what should be sent to frontend
      console.log('\n📋 EXACT DATA THAT SHOULD REACH FRONTEND:');
      console.log(JSON.stringify({
        organizationId: testLead.organizationId,
        analysisConfidenceScore: testLead.analysisConfidenceScore,
        customerScenarios: testLead.customerScenarios,
        decisionMakers: testLead.decisionMakers
      }, null, 2));
      
    } else {
      console.log('❌ Leads service did not return test health clinic data');
      console.log(`Available leads: ${serviceResult.leads.map(l => l.websiteUrl).slice(0, 3)}`);
    }

    // 3. The issue must be one of these:
    console.log('\n=== ROOT CAUSE ANALYSIS ===');
    console.log('🎯 Given that database and service both work correctly, the issue must be:');
    console.log('');
    console.log('POSSIBILITY 1: Production backend not updated with latest code');
    console.log('  - Frontend calls production backend API');
    console.log('  - Production backend returns old data structure without organization intelligence');
    console.log('  - Frontend receives leads but without the enhanced fields');
    console.log('');
    console.log('POSSIBILITY 2: Duplicate API endpoints causing wrong implementation to run');
    console.log('  - Express.js uses first matching route');
    console.log('  - If duplicate routes exist, wrong one might be handling requests');
    console.log('');
    console.log('POSSIBILITY 3: Frontend caching old API responses');
    console.log('  - Browser or service worker caching old API data');
    console.log('  - Need to clear cache or hard refresh');
    
    // 4. Provide solution recommendations
    console.log('\n=== RECOMMENDED SOLUTIONS ===');
    console.log('🔧 Step 1: Fix duplicate API endpoints (already identified in index.js)');
    console.log('🔧 Step 2: Verify latest backend code is deployed to production');
    console.log('🔧 Step 3: Hard refresh frontend to clear API cache');
    console.log('🔧 Step 4: Test production API endpoint directly');

    console.log('\n✅ Diagnosis completed!');

  } catch (error) {
    console.error('❌ Diagnosis error:', error);
    throw error;
  }
}

// Run diagnosis
diagnoseProductionIssue()
  .then(() => {
    console.log('\n🎉 Production diagnosis complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Diagnosis failed:', error);
    process.exit(1);
  });