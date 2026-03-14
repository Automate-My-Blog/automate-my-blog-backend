import db from './services/database.js';

async function testAnalysisEndpoint() {
  try {
    console.log('🧪 Testing analysis endpoint database query...');
    
    // Test the exact query that was failing in the analysis route
    const result = await db.query(`
      SELECT 
        o.id as org_id,
        o.name as organization_name,
        o.website_url,
        COALESCE(o.business_type, '') as business_type,
        COALESCE(o.industry_category, '') as industry_category,
        COALESCE(o.business_model, '') as business_model,
        COALESCE(o.company_size, '') as company_size,
        COALESCE(o.description, '') as description,
        COALESCE(o.target_audience, '') as target_audience,
        COALESCE(o.brand_voice, '') as brand_voice,
        COALESCE(o.website_goals, '') as website_goals,
        COALESCE(o.last_analyzed_at, o.updated_at) as last_analyzed_at,
        o.updated_at as org_updated_at,
        
        oi.customer_scenarios,
        oi.business_value_assessment,
        oi.customer_language_patterns,
        oi.search_behavior_insights,
        oi.seo_opportunities,
        oi.content_strategy_recommendations,
        oi.competitive_intelligence,
        oi.analysis_confidence_score,
        oi.data_sources,
        oi.ai_model_used,
        oi.raw_openai_response,
        oi.is_current,
        oi.created_at as intelligence_created_at
        
      FROM organizations o
      LEFT JOIN organization_intelligence oi ON o.id = oi.organization_id AND oi.is_current = TRUE
      WHERE o.owner_user_id IS NOT NULL 
      ORDER BY COALESCE(o.last_analyzed_at, o.updated_at) DESC
      LIMIT 5
    `);
    
    console.log(`✅ Query executed successfully! Found ${result.rows.length} organizations`);
    
    if (result.rows.length > 0) {
      const sample = result.rows[0];
      console.log('\n📋 Sample organization data:');
      console.log(`  - Name: ${sample.organization_name}`);
      console.log(`  - Website: ${sample.website_url}`);
      console.log(`  - Business Type: ${sample.business_type}`);
      console.log(`  - Target Audience: ${sample.target_audience}`);
      console.log(`  - Has Intelligence Data: ${!!sample.competitive_intelligence ? '✅ Yes' : '❌ No'}`);
      console.log(`  - Competitive Intelligence: ${sample.competitive_intelligence ? 'Present' : 'NULL'}`);
    } else {
      console.log('ℹ️ No organizations found (this is normal for a new database)');
    }
    
    // Test that competitive_intelligence column definitely exists
    const columnTest = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'organization_intelligence' 
      AND column_name = 'competitive_intelligence'
    `);
    
    if (columnTest.rows.length > 0) {
      console.log('✅ competitive_intelligence column confirmed to exist');
      console.log('🎉 The database schema fix was successful!');
      console.log('📡 The /api/v1/analysis/recent endpoint should now work without 500 errors');
    } else {
      console.log('❌ competitive_intelligence column still missing - fix failed');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('💡 If this fails, the 500 errors will persist');
  } finally {
    await db.close();
  }
}

testAnalysisEndpoint();