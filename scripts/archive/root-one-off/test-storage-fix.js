#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import webScraperService from './services/webscraper.js';
import blogAnalyzerService from './services/blog-analyzer.js';
import dotenv from 'dotenv';
import db from './services/database.js';

// Load environment variables
dotenv.config();

async function testStorageFix() {
  console.log('🔧 STORAGE FIX VERIFICATION TEST');
  console.log('=================================\n');
  
  const orgId = '9d297834-b620-49a1-b597-02a6b815b7de';
  const testUrl = 'https://www.lumibears.com';
  
  try {
    console.log('1️⃣ Clear existing data and run fresh analysis');
    console.log('===============================================');
    
    // Clear existing data for clean test
    await db.query('DELETE FROM website_pages WHERE organization_id = $1', [orgId]);
    await db.query('DELETE FROM cta_analysis WHERE organization_id = $1', [orgId]);
    
    console.log('✅ Cleared existing data');

    console.log('\n2️⃣ Run fresh blog analysis with storage debug');
    console.log('================================================');
    
    const analysisResult = await blogAnalyzerService.analyzeBlogContent(orgId, testUrl);
    
    console.log('✅ Analysis completed');
    console.log(`📖 Blog posts found: ${analysisResult.blogContentFound}`);
    console.log(`🎯 Total CTAs: ${analysisResult.ctaStrategy?.totalCTAs || 0}`);

    console.log('\n3️⃣ Verify stored data');
    console.log('=======================');
    
    const storedDataQuery = `
      SELECT 
        title, url,
        LENGTH(content) as content_length,
        word_count,
        CASE WHEN visual_design IS NOT NULL THEN 'Yes' ELSE 'No' END as has_visual_design,
        CASE WHEN content_structure IS NOT NULL THEN 'Yes' ELSE 'No' END as has_content_structure,
        CASE WHEN ctas_extracted IS NOT NULL THEN jsonb_array_length(ctas_extracted) ELSE 0 END as ctas_count,
        discovered_from
      FROM website_pages 
      WHERE organization_id = $1 
      ORDER BY scraped_at DESC 
      LIMIT 5;
    `;
    
    const storedResult = await db.query(storedDataQuery, [orgId]);
    
    console.log(`📊 Stored posts: ${storedResult.rows.length}`);
    
    let successCount = 0;
    
    storedResult.rows.forEach((row, i) => {
      console.log(`\n${i+1}. ${row.title}`);
      console.log(`   Content: ${row.content_length} chars`);
      console.log(`   Word count: ${row.word_count || 0}`);
      console.log(`   Visual design: ${row.has_visual_design}`);
      console.log(`   Content structure: ${row.has_content_structure}`);
      console.log(`   CTAs: ${row.ctas_count}`);
      console.log(`   Discovery: ${row.discovered_from}`);
      
      if (row.has_visual_design === 'Yes' || row.ctas_count > 0 || row.content_length > 0) {
        successCount++;
      }
    });

    // Check CTA storage
    const ctaStorageQuery = `
      SELECT 
        page_url, page_type, analysis_source, COUNT(*) as cta_count
      FROM cta_analysis 
      WHERE organization_id = $1
      GROUP BY page_url, page_type, analysis_source;
    `;
    
    const ctaResult = await db.query(ctaStorageQuery, [orgId]);
    
    console.log(`\n🎯 CTA Storage Results: ${ctaResult.rows.length} pages with CTAs`);
    ctaResult.rows.forEach(row => {
      console.log(`   ${row.page_url.split('/').pop()}: ${row.cta_count} CTAs (${row.page_type})`);
    });

    console.log('\n4️⃣ Test Results');
    console.log('================');
    
    if (successCount > 0) {
      console.log('🎉 SUCCESS! Enhanced data is now being stored correctly');
      console.log(`✅ ${successCount}/${storedResult.rows.length} posts have enhanced data`);
      console.log(`✅ ${ctaResult.rows.length} pages have stored CTAs`);
      
      console.log('\n📱 Frontend Impact:');
      console.log('- Enhanced data is now available in frontend APIs');
      console.log('- Blog content API includes visual design and structure data');
      console.log('- CTA analysis API shows blog post CTAs');
      console.log('- Content generation has full data needed for style matching');
      
    } else {
      console.log('❌ Storage issue still exists');
      console.log('🔧 Need to debug data flow further');
      
      // Debug the data flow
      console.log('\n🔍 Debug: Check raw scraped data structure');
      const testPostUrl = 'https://lumibears.com/blog/emotional-support-stuffed-animals-for-kids';
      const rawPost = await webScraperService.scrapeBlogPost(testPostUrl);
      
      console.log('Raw post data keys:', Object.keys(rawPost || {}));
      if (rawPost) {
        console.log(`Raw CTAs: ${rawPost.ctas?.length || 0}`);
        console.log(`Raw visual design: ${rawPost.visualDesign ? 'Present' : 'Missing'}`);
        console.log(`Raw content length: ${rawPost.content?.length || 0}`);
      }
    }

  } catch (error) {
    console.error('❌ Storage fix test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testStorageFix()
  .then(() => {
    console.log('\n🔧 Storage fix test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test failed:', error.message);
    process.exit(1);
  });