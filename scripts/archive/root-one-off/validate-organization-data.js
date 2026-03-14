import db from './services/database.js';

/**
 * Comprehensive Database Validation for Organization Intelligence Data
 * This script validates the exact state of the database to understand root causes
 */

async function validateDatabaseState() {
  console.log('🔍 Starting comprehensive database validation...\n');

  try {
    // 1. Check if tables exist
    console.log('=== TABLE EXISTENCE VALIDATION ===');
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('organizations', 'organization_intelligence', 'organization_contacts', 'website_leads')
      ORDER BY table_name;
    `;
    const tables = await db.query(tablesQuery);
    console.log('✅ Existing tables:', tables.rows.map(r => r.table_name));

    // 2. Check organization intelligence table structure
    console.log('\n=== ORGANIZATION_INTELLIGENCE TABLE STRUCTURE ===');
    const structureQuery = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'organization_intelligence' 
      ORDER BY ordinal_position;
    `;
    const structure = await db.query(structureQuery);
    console.log('📋 Table structure:');
    structure.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });

    // 3. Check specific test lead data
    console.log('\n=== TEST HEALTH CLINIC DATA VALIDATION ===');
    const testLeadQuery = `
      SELECT 
        wl.id,
        wl.business_name,
        wl.website_url,
        wl.organization_id,
        wl.analysis_data,
        wl.created_at
      FROM website_leads wl 
      WHERE wl.website_url = 'https://testhealthclinic.com'
      ORDER BY wl.created_at DESC
      LIMIT 1;
    `;
    const testLead = await db.query(testLeadQuery);
    console.log('📊 Test Health Clinic lead data:');
    if (testLead.rows.length > 0) {
      const lead = testLead.rows[0];
      console.log(`  Lead ID: ${lead.id}`);
      console.log(`  Organization ID: ${lead.organization_id}`);
      console.log(`  Business Name: ${lead.business_name}`);
      console.log(`  Has Analysis Data: ${!!lead.analysis_data}`);
      
      if (lead.analysis_data) {
        try {
          const analysisData = JSON.parse(lead.analysis_data);
          console.log(`  Analysis Data Keys: ${Object.keys(analysisData).join(', ')}`);
          console.log(`  Has Scenarios: ${!!analysisData.scenarios}`);
          console.log(`  Has Decision Makers: ${!!analysisData.decisionMakers}`);
        } catch (e) {
          console.log('  ❌ Error parsing analysis_data JSON');
        }
      }
    } else {
      console.log('  ❌ No test health clinic data found');
    }

    // 4. Check organization data
    if (testLead.rows.length > 0 && testLead.rows[0].organization_id) {
      console.log('\n=== ORGANIZATION DATA VALIDATION ===');
      const orgId = testLead.rows[0].organization_id;
      
      const orgQuery = `
        SELECT * FROM organizations WHERE id = $1;
      `;
      const org = await db.query(orgQuery, [orgId]);
      
      if (org.rows.length > 0) {
        const orgData = org.rows[0];
        console.log(`✅ Organization found: ${orgData.name}`);
        console.log(`  Business Type: ${orgData.business_type}`);
        console.log(`  Industry: ${orgData.industry_category}`);
        console.log(`  Company Size: ${orgData.company_size}`);
        console.log(`  Last Analyzed: ${orgData.last_analyzed_at}`);
      } else {
        console.log('❌ No organization found for organization_id');
      }

      // 5. Check organization intelligence data
      console.log('\n=== ORGANIZATION INTELLIGENCE DATA VALIDATION ===');
      const intelligenceQuery = `
        SELECT 
          id,
          customer_scenarios,
          business_value_assessment,
          analysis_confidence_score,
          is_current,
          created_at
        FROM organization_intelligence 
        WHERE organization_id = $1
        ORDER BY created_at DESC;
      `;
      const intelligence = await db.query(intelligenceQuery, [orgId]);
      
      console.log(`📊 Intelligence records found: ${intelligence.rows.length}`);
      if (intelligence.rows.length > 0) {
        intelligence.rows.forEach((intel, index) => {
          console.log(`\n  Record ${index + 1}:`);
          console.log(`    ID: ${intel.id}`);
          console.log(`    Confidence Score: ${intel.analysis_confidence_score}`);
          console.log(`    Is Current: ${intel.is_current}`);
          console.log(`    Created: ${intel.created_at}`);
          console.log(`    Has Customer Scenarios: ${!!intel.customer_scenarios}`);
          console.log(`    Has Business Value Assessment: ${!!intel.business_value_assessment}`);
          
          if (intel.customer_scenarios) {
            try {
              const scenarios = typeof intel.customer_scenarios === 'string' 
                ? JSON.parse(intel.customer_scenarios) 
                : intel.customer_scenarios;
              console.log(`    Scenarios Count: ${Array.isArray(scenarios) ? scenarios.length : 'Not array'}`);
              console.log(`    Scenarios Type: ${typeof scenarios}`);
            } catch (e) {
              console.log(`    ❌ Error parsing customer_scenarios: ${e.message}`);
            }
          }
        });
      } else {
        console.log('  ❌ No intelligence data found');
      }

      // 6. Check organization contacts/decision makers
      console.log('\n=== ORGANIZATION CONTACTS DATA VALIDATION ===');
      const contactsQuery = `
        SELECT 
          id,
          name,
          title,
          role_type,
          confidence_level
        FROM organization_contacts 
        WHERE organization_id = $1
        ORDER BY confidence_level DESC;
      `;
      const contacts = await db.query(contactsQuery, [orgId]);
      
      console.log(`👥 Contacts found: ${contacts.rows.length}`);
      contacts.rows.forEach((contact, index) => {
        console.log(`  Contact ${index + 1}:`);
        console.log(`    Name: ${contact.name}`);
        console.log(`    Title: ${contact.title}`);
        console.log(`    Role Type: ${contact.role_type}`);
        console.log(`    Confidence: ${contact.confidence_level}`);
      });

      // 7. Test database functions
      console.log('\n=== DATABASE FUNCTIONS VALIDATION ===');
      
      // Test decision makers function
      const decisionMakersQuery = `
        SELECT get_organization_decision_makers($1) as decision_makers;
      `;
      const decisionMakers = await db.query(decisionMakersQuery, [orgId]);
      console.log('📞 Decision Makers Function Result:');
      console.log(`  Type: ${typeof decisionMakers.rows[0].decision_makers}`);
      console.log(`  Value: ${JSON.stringify(decisionMakers.rows[0].decision_makers, null, 2)}`);

      // 8. Test the actual leads query used by the API
      console.log('\n=== API QUERY SIMULATION ===');
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
          -- Organization intelligence summary
          oi.customer_scenarios,
          oi.business_value_assessment,
          oi.analysis_confidence_score,
          -- Decision makers
          get_organization_decision_makers(o.id) as decision_makers
        FROM website_leads wl
        LEFT JOIN organizations o ON wl.organization_id = o.id
        LEFT JOIN lead_scoring ls ON wl.id = ls.website_lead_id
        LEFT JOIN organization_intelligence oi ON o.id = oi.organization_id AND oi.is_current = TRUE
        WHERE wl.website_url = 'https://testhealthclinic.com'
        ORDER BY wl.created_at DESC
        LIMIT 1;
      `;
      const apiResult = await db.query(apiQuery);
      
      if (apiResult.rows.length > 0) {
        const row = apiResult.rows[0];
        console.log('✅ API Query Result:');
        console.log(`  Organization ID: ${row.organization_id}`);
        console.log(`  Organization Name: ${row.organization_name}`);
        console.log(`  Analysis Confidence Score: ${row.analysis_confidence_score}`);
        console.log(`  Customer Scenarios Type: ${typeof row.customer_scenarios}`);
        console.log(`  Decision Makers Type: ${typeof row.decision_makers}`);
        console.log(`  Lead Score: ${row.lead_score}`);
        
        // Show exact values for debugging
        console.log('\n📋 Exact Field Values:');
        console.log(`  customer_scenarios: ${row.customer_scenarios}`);
        console.log(`  decision_makers: ${row.decision_makers}`);
        console.log(`  analysis_confidence_score: ${row.analysis_confidence_score}`);
      } else {
        console.log('❌ API query returned no results');
      }
    }

    console.log('\n✅ Database validation completed!');

  } catch (error) {
    console.error('❌ Database validation error:', error);
    throw error;
  }
}

// Run validation
validateDatabaseState()
  .then(() => {
    console.log('\n🎉 Validation complete - check output above for root cause analysis');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Validation failed:', error);
    process.exit(1);
  });