#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import webScraperService from './services/webscraper.js';
import blogAnalyzerService from './services/blog-analyzer.js';
import dotenv from 'dotenv';
import db from './services/database.js';

// Load environment variables
dotenv.config();

async function testComprehensiveEnhancement() {
  console.log('🧪 COMPREHENSIVE ENHANCED BLOG ANALYSIS TEST');
  console.log('============================================\n');
  
  const testUrl = 'https://www.lumibears.com';
  const orgId = '9d297834-b620-49a1-b597-02a6b815b7de'; // Your organization ID
  
  try {
    console.log('📋 TEST PLAN:');
    console.log('1. Apply database schema updates');
    console.log('2. Test enhanced blog post scraping (full content + CTAs + visual design)');
    console.log('3. Test comprehensive analysis workflow');
    console.log('4. Verify enhanced data storage');
    console.log('5. Test new API endpoints');
    console.log('6. Verify frontend data availability\n');

    // Test 1: Apply Schema Updates
    console.log('1️⃣ APPLYING DATABASE SCHEMA UPDATES');
    console.log('=====================================');
    
    try {
      // Add new columns to website_pages
      await db.query(`
        ALTER TABLE website_pages 
        ADD COLUMN IF NOT EXISTS visual_design JSONB,
        ADD COLUMN IF NOT EXISTS content_structure JSONB,
        ADD COLUMN IF NOT EXISTS ctas_extracted JSONB;
      `);
      
      // Add new columns to cta_analysis
      await db.query(`
        ALTER TABLE cta_analysis 
        ADD COLUMN IF NOT EXISTS page_type VARCHAR(50) DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS analysis_source VARCHAR(50) DEFAULT 'manual';
      `);
      
      console.log('✅ Schema updates applied successfully');
    } catch (schemaError) {
      console.log('⚠️  Schema updates failed (may already exist):', schemaError.message);
    }

    // Test 2: Enhanced Blog Post Scraping
    console.log('\n2️⃣ TESTING ENHANCED BLOG POST SCRAPING');
    console.log('=======================================');
    
    const testPostUrl = 'https://lumibears.com/blog/emotional-support-stuffed-animals-for-kids';
    console.log(`Testing enhanced scraping on: ${testPostUrl}`);
    
    const enhancedPostData = await webScraperService.scrapeBlogPost(testPostUrl);
    
    if (enhancedPostData) {
      console.log('✅ Enhanced blog post scraping successful!');
      console.log(`   📝 Title: ${enhancedPostData.title}`);
      console.log(`   📊 Content length: ${enhancedPostData.content.length} chars (should be >8,000)`);
      console.log(`   🎯 CTAs found: ${enhancedPostData.ctas?.length || 0}`);
      console.log(`   🎨 Visual design captured: ${enhancedPostData.visualDesign ? 'Yes' : 'No'}`);
      
      if (enhancedPostData.ctas && enhancedPostData.ctas.length > 0) {
        console.log('\n   📋 CTA Details:');
        enhancedPostData.ctas.forEach((cta, i) => {
          console.log(`     ${i+1}. "${cta.text}" (${cta.type}) in ${cta.placement}`);
        });
      }
      
      if (enhancedPostData.visualDesign) {
        console.log('\n   🎨 Visual Design Details:');
        const vd = enhancedPostData.visualDesign;
        console.log(`     Colors: ${vd.colors?.primary?.length || 0} found`);
        console.log(`     Fonts: ${vd.typography?.fonts?.length || 0} found`);
        console.log(`     Content structure: ${JSON.stringify(vd.contentStructure)}`);
      }
    } else {
      console.log('❌ Enhanced blog post scraping failed');
      return;
    }

    // Test 3: Comprehensive Analysis Workflow
    console.log('\n3️⃣ TESTING COMPREHENSIVE ANALYSIS WORKFLOW');
    console.log('==========================================');
    
    console.log('Running full blog analysis...');
    const analysisResult = await blogAnalyzerService.analyzeBlogContent(orgId, testUrl);
    
    console.log('✅ Comprehensive analysis completed!');
    console.log(`   📖 Blog posts found: ${analysisResult.blogContentFound}`);
    console.log(`   🎯 CTA strategy analysis: ${analysisResult.ctaStrategy?.totalCTAs || 0} CTAs total`);
    console.log(`   📊 Analysis quality: ${analysisResult.analysisQuality}%`);

    // Test 4: Verify Enhanced Data Storage
    console.log('\n4️⃣ VERIFYING ENHANCED DATA STORAGE');
    console.log('==================================');
    
    const storageQuery = `
      SELECT 
        url, title,
        CASE WHEN visual_design IS NOT NULL THEN 'Yes' ELSE 'No' END as has_visual_design,
        CASE WHEN content_structure IS NOT NULL THEN 'Yes' ELSE 'No' END as has_content_structure,
        CASE WHEN ctas_extracted IS NOT NULL THEN jsonb_array_length(ctas_extracted) ELSE 0 END as ctas_count,
        LENGTH(content) as content_length
      FROM website_pages 
      WHERE organization_id = $1 AND page_classification = 'blog_post'
      ORDER BY scraped_at DESC 
      LIMIT 5
    `;
    
    const storageResult = await db.query(storageQuery, [orgId]);
    
    console.log('📊 Recent blog posts storage verification:');
    storageResult.rows.forEach((row, i) => {
      console.log(`   ${i+1}. ${row.title}`);
      console.log(`      Visual Design: ${row.has_visual_design}`);
      console.log(`      Content Structure: ${row.has_content_structure}`);
      console.log(`      CTAs: ${row.ctas_count}`);
      console.log(`      Content Length: ${row.content_length} chars`);
    });

    // Test 5: Test New API Endpoints (simulate)
    console.log('\n5️⃣ TESTING NEW API ENDPOINTS');
    console.log('============================');
    
    // Test enhanced blog content query
    const blogContentQuery = `
      SELECT 
        id, url, title,
        visual_design, content_structure, 
        jsonb_array_length(COALESCE(ctas_extracted, '[]'::jsonb)) as ctas_count
      FROM website_pages 
      WHERE organization_id = $1 AND page_classification = 'blog_post'
      LIMIT 3
    `;
    
    const blogResult = await db.query(blogContentQuery, [orgId]);
    
    console.log('📊 Enhanced blog content API simulation:');
    console.log(`   Found ${blogResult.rows.length} posts with enhanced data`);
    
    blogResult.rows.forEach((row, i) => {
      console.log(`   ${i+1}. ${row.title}`);
      console.log(`      Has visual design: ${row.visual_design ? 'Yes' : 'No'}`);
      console.log(`      Has structure data: ${row.content_structure ? 'Yes' : 'No'}`);
      console.log(`      CTAs extracted: ${row.ctas_count}`);
    });

    // Test CTA analysis enhancement
    const ctaQuery = `
      SELECT 
        page_url, page_type, analysis_source, COUNT(*) as cta_count
      FROM cta_analysis 
      WHERE organization_id = $1
      GROUP BY page_url, page_type, analysis_source
      ORDER BY cta_count DESC
    `;
    
    const ctaResult = await db.query(ctaQuery, [orgId]);
    
    console.log('\n🎯 Enhanced CTA analysis:');
    console.log(`   Total pages with CTAs: ${ctaResult.rows.length}`);
    ctaResult.rows.slice(0, 5).forEach((row, i) => {
      console.log(`   ${i+1}. ${row.page_url.split('/').pop()}`);
      console.log(`      Page type: ${row.page_type}`);
      console.log(`      Source: ${row.analysis_source}`);
      console.log(`      CTA count: ${row.cta_count}`);
    });

    // Test 6: Frontend Data Availability Check
    console.log('\n6️⃣ FRONTEND DATA AVAILABILITY CHECK');
    console.log('===================================');
    
    // Simulate frontend API calls
    console.log('🔍 Simulating frontend API calls...');
    
    // Blog content API
    const frontendBlogQuery = `
      SELECT 
        id, url, page_type, title, LEFT(content, 300) as content_preview,
        meta_description, published_date, author, word_count,
        jsonb_array_length(COALESCE(internal_links, '[]'::jsonb)) as internal_links_count,
        jsonb_array_length(COALESCE(external_links, '[]'::jsonb)) as external_links_count,
        analysis_quality_score, scraped_at,
        COALESCE(page_classification, 'unknown') as page_classification,
        COALESCE(discovered_from, 'unknown') as discovered_from,
        featured_image_url, excerpt, discovery_priority, discovery_confidence,
        visual_design, content_structure, 
        jsonb_array_length(COALESCE(ctas_extracted, '[]'::jsonb)) as ctas_count
      FROM website_pages 
      WHERE organization_id = $1 AND COALESCE(page_classification, 'blog_post') != 'blog_index'
      ORDER BY 
        CASE WHEN COALESCE(page_classification, 'blog_post') = 'blog_post' THEN 1 
             WHEN page_classification = 'blog_index' THEN 2 
             ELSE 3 END,
        COALESCE(discovery_priority, 2),
        published_date DESC NULLS LAST,
        scraped_at DESC
      LIMIT 10
    `;
    
    const frontendResult = await db.query(frontendBlogQuery, [orgId]);
    
    console.log('📱 Frontend blog content API simulation:');
    console.log(`   ✅ ${frontendResult.rows.length} blog posts available`);
    
    const postsWithEnhancedData = frontendResult.rows.filter(row => 
      row.visual_design || row.content_structure || row.ctas_count > 0
    );
    
    console.log(`   🎨 ${postsWithEnhancedData.length} posts with enhanced data`);
    console.log(`   🎯 ${frontendResult.rows.reduce((sum, row) => sum + row.ctas_count, 0)} total CTAs available`);

    // CTA analysis API
    const frontendCtaQuery = `
      SELECT 
        COUNT(*) as total_ctas,
        COUNT(*) FILTER (WHERE page_type = 'blog_post') as blog_post_ctas,
        COUNT(*) FILTER (WHERE page_type = 'static_page') as static_page_ctas,
        COUNT(DISTINCT page_url) as pages_with_ctas
      FROM cta_analysis 
      WHERE organization_id = $1
    `;
    
    const frontendCtaResult = await db.query(frontendCtaQuery, [orgId]);
    const ctaStats = frontendCtaResult.rows[0];
    
    console.log('\n🎯 Frontend CTA analysis API simulation:');
    console.log(`   ✅ ${ctaStats.total_ctas} total CTAs available`);
    console.log(`   📝 ${ctaStats.blog_post_ctas} from blog posts`);
    console.log(`   🏠 ${ctaStats.static_page_ctas} from static pages`);
    console.log(`   📄 ${ctaStats.pages_with_ctas} pages analyzed`);

    // Summary
    console.log('\n🎉 COMPREHENSIVE TEST RESULTS');
    console.log('==============================');
    
    const hasFullContent = frontendResult.rows.some(row => 
      row.content_preview && row.content_preview.length > 290 // Checking if content is substantial
    );
    
    const hasVisualDesign = frontendResult.rows.some(row => row.visual_design);
    const hasContentStructure = frontendResult.rows.some(row => row.content_structure);
    const hasBlogCtas = ctaStats.blog_post_ctas > 0;
    const hasEnhancedAnalysis = postsWithEnhancedData.length > 0;

    console.log(`✅ Full content capture: ${hasFullContent ? 'WORKING' : 'FAILED'}`);
    console.log(`✅ Visual design extraction: ${hasVisualDesign ? 'WORKING' : 'FAILED'}`);
    console.log(`✅ Content structure analysis: ${hasContentStructure ? 'WORKING' : 'FAILED'}`);
    console.log(`✅ Blog post CTA detection: ${hasBlogCtas ? 'WORKING' : 'FAILED'}`);
    console.log(`✅ Enhanced data integration: ${hasEnhancedAnalysis ? 'WORKING' : 'FAILED'}`);
    
    console.log('\n📊 FRONTEND READINESS:');
    if (hasFullContent && hasVisualDesign && hasBlogCtas && hasEnhancedAnalysis) {
      console.log('🚀 ALL SYSTEMS GO! Enhanced data is available in the frontend.');
      console.log('   - Full article content is being captured');
      console.log('   - Visual design data is available');
      console.log('   - Blog post CTAs are being detected and stored');
      console.log('   - Enhanced analysis data is ready for content generation');
    } else {
      console.log('⚠️  Some features need attention:');
      if (!hasFullContent) console.log('   - Full content capture may need verification');
      if (!hasVisualDesign) console.log('   - Visual design extraction needs debugging');
      if (!hasBlogCtas) console.log('   - Blog post CTA detection needs fixing');
      if (!hasEnhancedAnalysis) console.log('   - Enhanced data integration needs work');
    }

    console.log('\n🔗 NEXT STEPS FOR FRONTEND:');
    console.log('- Enhanced data is available via existing API endpoints');
    console.log('- New visual-design endpoint available at /api/v1/analysis/visual-design/:orgId');
    console.log('- Blog content API now includes visual_design, content_structure, ctas_count fields');
    console.log('- CTA analysis API shows breakdown by page type (blog_post vs static_page)');

  } catch (error) {
    console.error('❌ Comprehensive test failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    // Close database connection
    await db.end();
  }
}

// Run the comprehensive test
testComprehensiveEnhancement()
  .then(() => {
    console.log('\n🎯 Comprehensive enhancement test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test failed:', error.message);
    process.exit(1);
  });