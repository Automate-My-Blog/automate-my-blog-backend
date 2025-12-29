import db from './services/database.js';

/**
 * Test API Response Format vs Frontend Expectations
 * This validates the exact API response structure that the frontend receives
 */

async function testAPIResponse() {
  console.log('🧪 Testing API Response Format vs Frontend Expectations...\n');

  try {
    // Test the exact query used in the leads service
    console.log('=== TESTING LEADS SERVICE QUERY ===');
    const apiQuery = `
      SELECT 
        wl.*,
        -- Organization data
        o.id as organization_id,
        o.name as organization_name,
        o.business_model,
        o.company_size as org_company_size,
        o.target_audience as org_target_audience,
        o.brand_voice as org_brand_voice,
        -- Lead scoring data
        ls.overall_score as lead_score,
        ls.business_size_score,
        ls.industry_fit_score,
        ls.engagement_score,
        ls.content_quality_score,
        ls.scoring_factors,
        -- Organization intelligence summary
        oi.customer_scenarios,
        oi.business_value_assessment,
        oi.analysis_confidence_score,
        -- Decision makers
        get_organization_decision_makers(o.id) as decision_makers,
        -- Conversion data
        CASE WHEN wl.converted_to_user_id IS NOT NULL THEN TRUE ELSE FALSE END as is_converted,
        wl.converted_at,
        COUNT(ct.id) as conversion_steps_count,
        EXTRACT(EPOCH FROM (COALESCE(wl.converted_at, NOW()) - wl.created_at)) / 86400 as days_in_funnel
      FROM website_leads wl
      LEFT JOIN organizations o ON wl.organization_id = o.id
      LEFT JOIN lead_scoring ls ON wl.id = ls.website_lead_id
      LEFT JOIN organization_intelligence oi ON o.id = oi.organization_id AND oi.is_current = TRUE
      LEFT JOIN users u ON wl.converted_to_user_id = u.id
      LEFT JOIN conversion_tracking ct ON wl.id = ct.website_lead_id
      WHERE wl.website_url = 'https://testhealthclinic.com'
      GROUP BY wl.id, o.id, o.name, o.business_model, o.company_size, o.target_audience, o.brand_voice,
               ls.overall_score, ls.business_size_score, ls.industry_fit_score, 
               ls.engagement_score, ls.content_quality_score, ls.scoring_factors, 
               oi.customer_scenarios, oi.business_value_assessment, oi.analysis_confidence_score,
               u.email
      ORDER BY wl.created_at DESC
      LIMIT 1;
    `;

    const rawResult = await db.query(apiQuery);
    console.log('📊 Raw Database Response:');
    if (rawResult.rows.length > 0) {
      const row = rawResult.rows[0];
      
      console.log('\n=== RAW FIELD VALUES ===');
      console.log(`customer_scenarios type: ${typeof row.customer_scenarios}`);
      console.log(`customer_scenarios value: ${JSON.stringify(row.customer_scenarios)}`);
      console.log(`decision_makers type: ${typeof row.decision_makers}`);
      console.log(`decision_makers value: ${JSON.stringify(row.decision_makers)}`);
      console.log(`analysis_confidence_score type: ${typeof row.analysis_confidence_score}`);
      console.log(`analysis_confidence_score value: ${row.analysis_confidence_score}`);

      // Test what happens when we process this data like the leads service does
      console.log('\n=== LEADS SERVICE DATA PROCESSING SIMULATION ===');
      const processedLead = {
        // Lead information
        id: row.id,
        websiteUrl: row.website_url,
        businessName: row.business_name,
        businessType: row.business_type,
        industry: row.industry_category,
        estimatedCompanySize: row.estimated_company_size,
        leadSource: row.lead_source,
        leadScore: parseInt(row.lead_score || 0),
        status: row.status,
        isConverted: row.is_converted,
        convertedAt: row.converted_at,
        conversionStepsCount: parseInt(row.conversion_steps_count || 0),
        daysInFunnel: parseFloat(row.days_in_funnel || 0).toFixed(1),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        referrerUrl: row.referrer_url,
        
        // Organization data
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        businessModel: row.business_model,
        companySize: row.org_company_size,
        targetAudience: row.org_target_audience,
        brandVoice: row.org_brand_voice,
        
        // Business intelligence
        decisionMakers: row.decision_makers || [],
        customerScenarios: row.customer_scenarios || [],
        businessValueAssessment: row.business_value_assessment || {},
        analysisConfidenceScore: parseFloat(row.analysis_confidence_score || 0),
        
        // Backward compatibility
        analysisData: row.analysis_data
      };

      console.log('✅ Processed Lead Object (as sent to frontend):');
      console.log(`  organizationId: ${processedLead.organizationId}`);
      console.log(`  analysisConfidenceScore: ${processedLead.analysisConfidenceScore}`);
      console.log(`  customerScenarios type: ${typeof processedLead.customerScenarios}`);
      console.log(`  customerScenarios length: ${processedLead.customerScenarios?.length || 'undefined'}`);
      console.log(`  customerScenarios value: ${JSON.stringify(processedLead.customerScenarios)}`);
      console.log(`  decisionMakers type: ${typeof processedLead.decisionMakers}`);
      console.log(`  decisionMakers length: ${processedLead.decisionMakers?.length || 'undefined'}`);
      console.log(`  decisionMakers value: ${JSON.stringify(processedLead.decisionMakers)}`);

      // Test what frontend business intelligence render would see
      console.log('\n=== FRONTEND BUSINESS INTELLIGENCE COMPONENT SIMULATION ===');
      const confidence = processedLead.analysisConfidenceScore || 0;
      const scenariosCount = processedLead.customerScenarios?.length || 0;
      const decisionMakersCount = processedLead.decisionMakers?.length || 0;
      
      console.log('🎨 Frontend would display:');
      console.log(`  Confidence: ${(confidence * 100).toFixed(0)}%`);
      console.log(`  Scenarios Count: ${scenariosCount}`);
      console.log(`  Decision Makers Count: ${decisionMakersCount}`);
      
      if (scenariosCount === 0) {
        console.log('  ❌ PROBLEM: No scenarios displayed (should be 1)');
      }
      if (decisionMakersCount === 0) {
        console.log('  ❌ PROBLEM: No decision makers displayed (should be 4)');
      }
      if (confidence === 0) {
        console.log('  ❌ PROBLEM: 0% confidence displayed (should be 85%)');
      }

      // Test individual JSON parsing
      console.log('\n=== JSON PARSING TESTS ===');
      console.log('Testing customer_scenarios parsing:');
      try {
        if (typeof row.customer_scenarios === 'string') {
          console.log('  - Raw value is string, attempting JSON.parse...');
          const parsedScenarios = JSON.parse(row.customer_scenarios);
          console.log(`  - Parsed successfully: ${Array.isArray(parsedScenarios)} array with ${parsedScenarios.length} items`);
        } else if (Array.isArray(row.customer_scenarios)) {
          console.log(`  - Raw value is already array with ${row.customer_scenarios.length} items`);
        } else {
          console.log(`  - Raw value type: ${typeof row.customer_scenarios}, value: ${row.customer_scenarios}`);
        }
      } catch (e) {
        console.log(`  ❌ JSON parsing failed: ${e.message}`);
      }

      console.log('\nTesting decision_makers parsing:');
      try {
        if (typeof row.decision_makers === 'string') {
          console.log('  - Raw value is string, attempting JSON.parse...');
          const parsedDecisionMakers = JSON.parse(row.decision_makers);
          console.log(`  - Parsed successfully: ${Array.isArray(parsedDecisionMakers)} array with ${parsedDecisionMakers.length} items`);
        } else if (Array.isArray(row.decision_makers)) {
          console.log(`  - Raw value is already array with ${row.decision_makers.length} items`);
        } else {
          console.log(`  - Raw value type: ${typeof row.decision_makers}, value: ${row.decision_makers}`);
        }
      } catch (e) {
        console.log(`  ❌ JSON parsing failed: ${e.message}`);
      }
    } else {
      console.log('❌ No data found for test health clinic');
    }

    console.log('\n✅ API response testing completed!');

  } catch (error) {
    console.error('❌ API response test error:', error);
    throw error;
  }
}

// Run test
testAPIResponse()
  .then(() => {
    console.log('\n🎉 API response validation complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 API response test failed:', error);
    process.exit(1);
  });