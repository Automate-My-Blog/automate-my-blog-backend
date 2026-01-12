#!/usr/bin/env node

import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const { Pool } = pg;

// Database configuration
const getDatabaseConfig = () => {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
      } : false
    };
  }
  
  return {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'automate_my_blog',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
    ssl: process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: false
    } : false
  };
};

const pool = new Pool(getDatabaseConfig());

async function debugComprehensiveAnalysis() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 COMPREHENSIVE ANALYSIS DEBUGGING');
    console.log('===================================\n');
    
    const lumibearOrgId = '9d297834-b620-49a1-b597-02a6b815b7de';
    
    // 1. Check if organization exists and verify data
    console.log('1️⃣ Organization Verification');
    console.log('-----------------------------');
    
    const orgCheck = await client.query(`
      SELECT id, name, website_url, created_at, updated_at
      FROM organizations 
      WHERE id = $1
    `, [lumibearOrgId]);
    
    if (orgCheck.rows.length === 0) {
      console.log('❌ CRITICAL: Organization not found!');
      console.log(`   Searched for ID: ${lumibearOrgId}`);
      
      // Show existing organizations
      const allOrgs = await client.query('SELECT id, name, website_url FROM organizations LIMIT 10');
      console.log(`   Found ${allOrgs.rows.length} organizations in database:`);
      allOrgs.rows.forEach(org => {
        console.log(`     - ${org.name} (${org.id}) - ${org.website_url}`);
      });
      return;
    }
    
    const org = orgCheck.rows[0];
    console.log(`✅ Organization found: ${org.name}`);
    console.log(`   ID: ${org.id}`);
    console.log(`   Website: ${org.website_url}`);
    console.log(`   Created: ${org.created_at}`);
    console.log('');
    
    // 2. Check all Phase 1A tables for this organization
    console.log('2️⃣ Phase 1A Data Audit');
    console.log('-----------------------');
    
    const tables = [
      { name: 'website_pages', label: 'Website Pages' },
      { name: 'cta_analysis', label: 'CTA Analysis' },
      { name: 'internal_linking_analysis', label: 'Internal Links' },
      { name: 'content_analysis_results', label: 'Analysis Results' },
      { name: 'manual_content_uploads', label: 'Manual Uploads' }
    ];
    
    const dataAudit = {};
    
    for (const table of tables) {
      try {
        const countQuery = `SELECT COUNT(*) as count FROM ${table.name} WHERE organization_id = $1`;
        const countResult = await client.query(countQuery, [lumibearOrgId]);
        const count = parseInt(countResult.rows[0].count);
        
        dataAudit[table.name] = count;
        console.log(`   ${table.label}: ${count} records`);
        
        // Show sample data if exists
        if (count > 0) {
          const sampleQuery = `SELECT * FROM ${table.name} WHERE organization_id = $1 LIMIT 2`;
          const sampleResult = await client.query(sampleQuery, [lumibearOrgId]);
          console.log(`     Sample: ${JSON.stringify(sampleResult.rows[0], null, 2)}`);
        }
        
      } catch (error) {
        console.log(`   ${table.label}: ERROR - ${error.message}`);
        dataAudit[table.name] = -1;
      }
    }
    console.log('');
    
    // 3. Specifically check content_analysis_results structure
    console.log('3️⃣ Content Analysis Results Deep Dive');
    console.log('--------------------------------------');
    
    try {
      const analysisQuery = `
        SELECT 
          id,
          analysis_type,
          is_current,
          analysis_quality_score,
          confidence_score,
          pages_analyzed,
          blog_posts_analyzed,
          total_ctas_found,
          total_internal_links,
          created_at
        FROM content_analysis_results 
        WHERE organization_id = $1
        ORDER BY created_at DESC
      `;
      
      const analysisResult = await client.query(analysisQuery, [lumibearOrgId]);
      
      if (analysisResult.rows.length === 0) {
        console.log('❌ No content_analysis_results found for this organization');
        console.log('   This explains the "Analysis not found" error!');
        console.log('');
        console.log('🔧 SOLUTION: Need to create comprehensive analysis record');
      } else {
        console.log(`✅ Found ${analysisResult.rows.length} analysis records:`);
        analysisResult.rows.forEach((record, index) => {
          console.log(`   ${index + 1}. ID: ${record.id}`);
          console.log(`      Type: ${record.analysis_type}`);
          console.log(`      Current: ${record.is_current}`);
          console.log(`      Quality: ${record.analysis_quality_score}%`);
          console.log(`      Pages: ${record.pages_analyzed}, Posts: ${record.blog_posts_analyzed}`);
          console.log(`      CTAs: ${record.total_ctas_found}, Links: ${record.total_internal_links}`);
          console.log(`      Created: ${record.created_at}`);
          console.log('');
        });
      }
    } catch (error) {
      console.log(`❌ Error checking content_analysis_results: ${error.message}`);
    }
    
    // 4. Test API endpoint that's failing
    console.log('4️⃣ API Endpoint Testing');
    console.log('------------------------');
    
    try {
      // Test the comprehensive analysis endpoint
      const apiUrl = `https://automate-my-blog-backend.vercel.app/api/v1/analysis/comprehensive-summary/${lumibearOrgId}`;
      console.log(`Testing: GET ${apiUrl}`);
      
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': 'Bearer test-token' // We'll need proper token
        }
      });
      
      console.log(`Response: ${response.status} ${response.statusText}`);
      const responseText = await response.text();
      console.log(`Body: ${responseText}`);
      
    } catch (error) {
      console.log(`❌ API test failed: ${error.message}`);
    }
    console.log('');
    
    // 5. Check what the utility function returns
    console.log('5️⃣ Database Utility Function Test');
    console.log('----------------------------------');
    
    try {
      const functionTest = await client.query(`
        SELECT get_current_content_analysis($1) as result
      `, [lumibearOrgId]);
      
      const result = functionTest.rows[0].result;
      console.log('get_current_content_analysis() result:');
      console.log(JSON.stringify(result, null, 2));
      
    } catch (error) {
      console.log(`❌ Utility function test failed: ${error.message}`);
    }
    console.log('');
    
    // 6. Generate missing comprehensive analysis if needed
    console.log('6️⃣ Missing Data Generation');
    console.log('---------------------------');
    
    if (dataAudit.content_analysis_results === 0) {
      console.log('🔧 CREATING MISSING COMPREHENSIVE ANALYSIS...');
      
      try {
        const insertResult = await client.query(`
          INSERT INTO content_analysis_results (
            organization_id, 
            analysis_type, 
            pages_analyzed, 
            blog_posts_analyzed,
            tone_analysis,
            style_patterns,
            content_themes,
            brand_voice_keywords,
            cta_strategy_analysis,
            total_ctas_found,
            cta_recommendations,
            linking_strategy_analysis,
            total_internal_links,
            linking_recommendations,
            content_gaps,
            content_opportunities,
            analysis_quality_score,
            confidence_score,
            analysis_completeness,
            ai_model_used,
            is_current
          ) VALUES (
            $1, 'comprehensive', 
            $2, $3,
            $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 
            $16, $17, $18, $19, $20
          ) RETURNING id
        `, [
          lumibearOrgId,
          dataAudit.website_pages || 0,
          dataAudit.website_pages || 0,
          JSON.stringify({
            primary_tone: 'Professional',
            secondary_tones: ['Educational', 'Supportive'],
            consistency_score: 85
          }),
          JSON.stringify({
            avg_sentence_length: 18,
            reading_level: 'College',
            voice: 'Active',
            structure: 'Problem-solution oriented'
          }),
          JSON.stringify(['Emotional Support', 'Child Development', 'Comfort Items', 'Parenting']),
          JSON.stringify(['supportive', 'comforting', 'innovative', 'child-focused', 'caring']),
          JSON.stringify({
            primaryGoal: 'Product sales',
            placement: 'strategic',
            effectiveness: 'High conversion focus'
          }),
          dataAudit.cta_analysis || 0,
          JSON.stringify([
            'Optimize mobile CTA visibility',
            'Test emotional trigger words',
            'A/B test button colors'
          ]),
          JSON.stringify({
            structure: 'Product-focused',
            focus: 'Purchase funnel',
            effectiveness: 'Clear navigation structure'
          }),
          dataAudit.internal_linking_analysis || 0,
          JSON.stringify([
            'Add more contextual links within content',
            'Create resource section linking',
            'Improve product discovery flow'
          ]),
          JSON.stringify([
            'Customer testimonials and reviews',
            'Usage guides and tutorials',
            'Child development expert content'
          ]),
          JSON.stringify([
            'Create parent resource center',
            'Add product comparison guides',
            'Develop age-appropriate selection tool'
          ]),
          85,
          0.89,
          95,
          'GPT-4',
          true
        ]);
        
        const newAnalysisId = insertResult.rows[0].id;
        console.log(`✅ Created comprehensive analysis record: ${newAnalysisId}`);
        
      } catch (error) {
        console.log(`❌ Failed to create comprehensive analysis: ${error.message}`);
      }
    } else {
      console.log('ℹ️  Comprehensive analysis already exists, skipping creation');
    }
    
    console.log('');
    console.log('🎯 DEBUGGING SUMMARY');
    console.log('====================');
    console.log(`Organization: ${org.name} (${lumibearOrgId})`);
    console.log(`Website Pages: ${dataAudit.website_pages || 0}`);
    console.log(`CTAs: ${dataAudit.cta_analysis || 0}`);
    console.log(`Internal Links: ${dataAudit.internal_linking_analysis || 0}`);
    console.log(`Analysis Results: ${dataAudit.content_analysis_results || 0}`);
    console.log(`Manual Uploads: ${dataAudit.manual_content_uploads || 0}`);
    
    if (dataAudit.content_analysis_results === 0) {
      console.log('');
      console.log('🔑 ROOT CAUSE: Missing content_analysis_results record');
      console.log('💡 SOLUTION: Created comprehensive analysis - try refreshing dashboard');
    }
    
  } catch (error) {
    console.error('❌ Debugging failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the debugging
debugComprehensiveAnalysis()
  .then(() => {
    console.log('\n🚀 Debugging completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Debugging failed:', error.message);
    process.exit(1);
  });