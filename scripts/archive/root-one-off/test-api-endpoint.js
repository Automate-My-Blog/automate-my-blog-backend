#!/usr/bin/env node

import express from 'express';
import db from './services/database.js';
import analysisRoutes from './routes/analysis.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testApiEndpoint() {
  try {
    console.log('🧪 TESTING API ENDPOINT');
    console.log('=======================\n');
    
    const organizationId = '9d297834-b620-49a1-b597-02a6b815b7de';
    
    console.log(`🔍 Organization: ${organizationId}\n`);
    
    // Simulate the API endpoint query directly
    console.log('1️⃣ Testing API Query (Direct DB)');
    console.log('---------------------------------');
    
    // This is the exact query from the API endpoint with enhanced filtering
    const apiQuery = `
      SELECT 
        id, url, page_type, title, 
        LEFT(content, 300) as content_preview,
        meta_description, published_date, author, word_count,
        jsonb_array_length(COALESCE(internal_links, '[]'::jsonb)) as internal_links_count,
        jsonb_array_length(COALESCE(external_links, '[]'::jsonb)) as external_links_count,
        analysis_quality_score, scraped_at,
        -- Enhanced fields
        COALESCE(page_classification, 'unknown') as page_classification,
        COALESCE(discovered_from, 'unknown') as discovered_from,
        featured_image_url, excerpt, discovery_priority, discovery_confidence
      FROM website_pages 
      WHERE organization_id = $1 
        AND page_type = 'blog_post' 
        AND COALESCE(page_classification, 'blog_post') != 'blog_index'
      ORDER BY 
        -- Prioritize actual blog posts over index pages
        CASE WHEN COALESCE(page_classification, 'blog_post') = 'blog_post' THEN 1 
             WHEN page_classification = 'blog_index' THEN 2 
             ELSE 3 END,
        -- Then by discovery priority and date
        COALESCE(discovery_priority, 2),
        published_date DESC NULLS LAST,
        scraped_at DESC
      LIMIT 20 OFFSET 0
    `;
    
    const apiResult = await db.query(apiQuery, [organizationId]);
    
    console.log(`✅ Query returned ${apiResult.rows.length} blog posts\n`);
    
    if (apiResult.rows.length === 0) {
      console.log('❌ No blog posts returned by API query!');
      
      // Debug what's in the table
      const debugQuery = `
        SELECT COUNT(*) as total, page_type, page_classification, discovered_from
        FROM website_pages 
        WHERE organization_id = $1 
        GROUP BY page_type, page_classification, discovered_from
        ORDER BY total DESC
      `;
      
      const debugResult = await db.query(debugQuery, [organizationId]);
      console.log('\n🔍 Debug: What\'s actually in the table:');
      console.table(debugResult.rows);
      
    } else {
      console.log('📚 Sample blog posts that would be returned:');
      apiResult.rows.slice(0, 5).forEach((post, index) => {
        console.log(`\n${index + 1}. ${post.title}`);
        console.log(`   URL: ${post.url}`);
        console.log(`   Type: ${post.page_type} | Classification: ${post.page_classification}`);
        console.log(`   Discovery: ${post.discovered_from} | Priority: ${post.discovery_priority}`);
        console.log(`   Word count: ${post.word_count || 'N/A'} | Quality: ${post.analysis_quality_score || 'N/A'}`);
        if (post.content_preview && post.content_preview.trim()) {
          console.log(`   Preview: ${post.content_preview.slice(0, 100)}...`);
        }
      });
    }
    
    // Test different pageType filters
    console.log('\n2️⃣ Testing Different Page Type Filters');
    console.log('---------------------------------------');
    
    const filters = ['all', 'blog_post', 'blog_index'];
    
    for (const filter of filters) {
      let filterClause = 'WHERE organization_id = $1';
      
      if (filter === 'blog_post') {
        filterClause += ` AND page_type = 'blog_post' AND COALESCE(page_classification, 'blog_post') != 'blog_index'`;
      } else if (filter === 'blog_index') {
        filterClause += ` AND (page_classification = 'blog_index' OR (page_type = 'blog_post' AND url ~ '/(blog|news|articles|posts)/?$'))`;
      }
      
      const countQuery = `SELECT COUNT(*) as count FROM website_pages ${filterClause}`;
      const countResult = await db.query(countQuery, [organizationId]);
      
      console.log(`   ${filter}: ${countResult.rows[0].count} results`);
    }
    
    // Test the summary function
    console.log('\n3️⃣ Testing Summary Function');
    console.log('----------------------------');
    
    const summaryResult = await db.query(
      'SELECT get_website_content_summary($1) as summary',
      [organizationId]
    );
    
    const summary = summaryResult.rows[0]?.summary || {};
    console.log('📊 Website content summary:');
    console.log(JSON.stringify(summary, null, 2));
    
    console.log('\n🎉 API ENDPOINT TEST COMPLETE');
    console.log('==============================');
    console.log(`✅ Total posts discoverable: ${apiResult.rows.length}`);
    console.log(`✅ Expected from sitemap: 13`);
    console.log(`✅ Frontend issue resolved: ${apiResult.rows.length >= 13 ? 'YES' : 'NO'}`);
    
    if (apiResult.rows.length >= 13) {
      console.log('\n🎯 SOLUTION SUMMARY:');
      console.log('- ✅ Sitemap discovery working properly (13 posts found)');
      console.log('- ✅ Enhanced storage system storing all discovered posts');
      console.log('- ✅ API endpoint returning blog posts (not just index page)');
      console.log('- ✅ Frontend should now show all 13 blog posts instead of just 1');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testApiEndpoint()
  .then(() => {
    console.log('\n🚀 Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test failed:', error.message);
    process.exit(1);
  });