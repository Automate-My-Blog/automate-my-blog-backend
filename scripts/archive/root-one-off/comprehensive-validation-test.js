#!/usr/bin/env node

// Comprehensive validation test for organization intelligence session adoption
console.log('🔍 COMPREHENSIVE VALIDATION TEST');
console.log('================================');

import fs from 'fs';

console.log('\n📋 ISSUE 1: Field Name Mismatches');
console.log('=================================');

// Check organization_intelligence table structure from migration 08
try {
  const migration08 = fs.readFileSync('./database/08_organization_intelligence_tables.sql', 'utf8');
  
  console.log('✅ Existing organization_intelligence fields (from migration 08):');
  const existingFields = [
    'customer_scenarios',
    'business_value_assessment', 
    'customer_language_patterns',
    'search_behavior_insights',
    'seo_opportunities',
    'content_strategy_recommendations', 
    'competitive_intelligence',
    'analysis_confidence_score',
    'data_sources',
    'ai_model_used',
    'raw_openai_response',
    'is_current'
  ];
  
  existingFields.forEach(field => {
    if (migration08.includes(field)) {
      console.log(`   ✅ ${field}`);
    } else {
      console.log(`   ❌ ${field} - NOT FOUND`);
    }
  });
} catch (error) {
  console.log('❌ Could not read migration 08');
}

console.log('\n❌ My implementation used wrong field names:');
const myWrongFields = [
  'competitive_landscape (should be: competitive_intelligence)',
  'content_opportunities (should be: content_strategy_recommendations)', 
  'seo_insights (should be: seo_opportunities)',
  'conversion_optimization (DOES NOT EXIST)',
  'analysis_methodology (DOES NOT EXIST)'
];

myWrongFields.forEach(field => console.log(`   ❌ ${field}`));

console.log('\n📋 ISSUE 2: Database Function Validation');
console.log('=========================================');

try {
  const migration13 = fs.readFileSync('./database/13_organization_intelligence_session_adoption.sql', 'utf8');
  
  console.log('❌ Function references non-existent fields:');
  const wrongReferences = [
    'competitive_landscape',
    'content_opportunities', 
    'seo_insights',
    'conversion_optimization',
    'analysis_methodology'
  ];
  
  wrongReferences.forEach(field => {
    if (migration13.includes(field)) {
      console.log(`   ❌ Function references: ${field}`);
    }
  });
  
} catch (error) {
  console.log('❌ Could not read migration 13');
}

console.log('\n📋 ISSUE 3: API Endpoint Field Mapping');
console.log('======================================');

try {
  const analysisRoutes = fs.readFileSync('./routes/analysis.js', 'utf8');
  
  console.log('❌ Routes file maps to wrong fields:');
  const wrongMappings = [
    'competitiveLandscape',
    'contentOpportunities',
    'seoInsights', 
    'conversionOptimization',
    'analysisMethodology'
  ];
  
  wrongMappings.forEach(field => {
    if (analysisRoutes.includes(field)) {
      console.log(`   ❌ Routes maps to: ${field}`);
    }
  });
  
} catch (error) {
  console.log('❌ Could not read routes file');
}

console.log('\n📋 ISSUE 4: Backend Save Logic Validation');  
console.log('==========================================');

try {
  const indexJs = fs.readFileSync('./index.js', 'utf8');
  
  console.log('❌ Backend save logic uses wrong field names:');
  const wrongSaveFields = [
    'competitive_landscape',
    'content_opportunities',
    'seo_insights',
    'conversion_optimization', 
    'analysis_methodology'
  ];
  
  wrongSaveFields.forEach(field => {
    if (indexJs.includes(field)) {
      console.log(`   ❌ Backend saves to: ${field}`);
    }
  });
  
} catch (error) {
  console.log('❌ Could not read index.js');
}

console.log('\n📋 ISSUE 5: Missing websiteUrl in Organizations');
console.log('================================================');

try {
  const migration08 = fs.readFileSync('./database/08_organization_intelligence_tables.sql', 'utf8');
  
  if (migration08.includes('ADD COLUMN website_url')) {
    console.log('✅ Organizations table has website_url field');
  } else {
    console.log('❌ Organizations table missing website_url field');
    console.log('   Need to check migration 07: add_website_to_organizations.sql');
  }
} catch (error) {
  console.log('❌ Could not validate website_url field');
}

console.log('\n📋 CRITICAL ISSUES SUMMARY');
console.log('===========================');
console.log('❌ 1. Field name mismatches between implementation and existing schema');
console.log('❌ 2. Database function references non-existent columns');
console.log('❌ 3. API routes map to wrong field names');
console.log('❌ 4. Backend save logic uses wrong field names'); 
console.log('❌ 5. Potential missing website_url in organizations table');

console.log('\n🔧 REQUIRED FIXES');
console.log('==================');
console.log('1. Update database function to use correct field names');
console.log('2. Update API routes field mapping');
console.log('3. Update backend save logic field names');
console.log('4. Verify organizations.website_url exists');
console.log('5. Test actual database connection and queries');

console.log('\n⚠️  DEPLOYMENT RISK: HIGH');
console.log('==========================');
console.log('Current implementation will fail due to:');
console.log('- Database errors (non-existent columns)');
console.log('- API errors (field mapping failures)');
console.log('- Data loss (incorrect field references)');

console.log('\n🧪 NEXT STEPS FOR PROPER VALIDATION');
console.log('====================================');
console.log('1. Fix all field name mismatches');
console.log('2. Test with actual database connection');
console.log('3. Validate all SQL queries execute successfully');
console.log('4. Test complete API flow end-to-end');
console.log('5. Verify session adoption data transfer');

console.log('\nStatus: ❌ IMPLEMENTATION HAS CRITICAL ERRORS - DO NOT DEPLOY');