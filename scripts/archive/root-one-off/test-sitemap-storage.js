#!/usr/bin/env node

import webScraperService from './services/webscraper.js';
import db from './services/database.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testSitemapStorage() {
  try {
    console.log('🧪 TESTING SITEMAP POSTS STORAGE');
    console.log('================================\n');
    
    const organizationId = '9d297834-b620-49a1-b597-02a6b815b7de';
    const websiteUrl = 'https://lumibears.com';
    
    console.log(`🔍 Organization: ${organizationId}`);
    console.log(`🌐 Website: ${websiteUrl}\n`);
    
    // Step 1: Discover from sitemap only
    console.log('1️⃣ Sitemap Discovery');
    console.log('--------------------');
    
    const sitemapResult = await webScraperService.discoverFromSitemap(websiteUrl);
    console.log(`✅ Found ${sitemapResult.totalPostsFound} posts from sitemap`);
    
    if (sitemapResult.blogPosts.length === 0) {
      console.log('❌ No posts found, exiting');
      return;
    }
    
    // Step 2: Store sitemap posts directly
    console.log('\n2️⃣ Storing Sitemap Posts');
    console.log('-------------------------');
    
    let storedCount = 0;
    let errors = [];
    
    for (const post of sitemapResult.blogPosts) {
      try {
        console.log(`📝 Storing: ${post.title}`);
        
        const insertQuery = `
          INSERT INTO website_pages (
            organization_id, url, page_type, title, content, 
            page_classification, discovered_from, 
            discovery_priority, discovery_confidence, 
            scraped_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          ON CONFLICT (organization_id, url) DO UPDATE SET
            title = EXCLUDED.title,
            page_classification = EXCLUDED.page_classification,
            discovered_from = EXCLUDED.discovered_from,
            discovery_priority = EXCLUDED.discovery_priority,
            discovery_confidence = EXCLUDED.discovery_confidence,
            scraped_at = EXCLUDED.scraped_at
        `;
        
        const values = [
          organizationId,
          post.url,
          'blog_post',
          post.title,
          '', // empty content for now
          'blog_post',
          post.discoveredFrom || 'sitemap',
          Math.round((post.priority || 0.5) * 3) || 1, // Convert 0.0-1.0 to 1-3 scale (1=high, 2=medium, 3=low)
          post.confidence || 0.8, // decimal confidence score
        ];
        
        await db.query(insertQuery, values);
        storedCount++;
        
      } catch (error) {
        console.error(`❌ Error storing ${post.url}: ${error.message}`);
        errors.push({ url: post.url, error: error.message });
      }
    }
    
    console.log(`✅ Stored ${storedCount} out of ${sitemapResult.blogPosts.length} posts`);
    if (errors.length > 0) {
      console.log(`❌ ${errors.length} errors occurred:`);
      errors.forEach(err => console.log(`   ${err.url}: ${err.error}`));
    }
    
    // Step 3: Verify storage
    console.log('\n3️⃣ Verifying Storage');
    console.log('--------------------');
    
    const verifyQuery = `
      SELECT COUNT(*) as total_count,
             COUNT(*) FILTER (WHERE page_classification = 'blog_post') as blog_posts,
             COUNT(*) FILTER (WHERE discovered_from = 'sitemap') as sitemap_posts
      FROM website_pages 
      WHERE organization_id = $1
    `;
    
    const verifyResult = await db.query(verifyQuery, [organizationId]);
    console.log('📊 Storage verification:');
    console.table(verifyResult.rows[0]);
    
    // Step 4: Test API query
    console.log('\n4️⃣ Testing API Query');
    console.log('--------------------');
    
    const apiQuery = `
      SELECT id, url, title, page_classification, discovered_from, discovery_priority
      FROM website_pages 
      WHERE organization_id = $1 
        AND page_type = 'blog_post' 
        AND COALESCE(page_classification, 'blog_post') != 'blog_index'
      ORDER BY 
        CASE WHEN COALESCE(page_classification, 'blog_post') = 'blog_post' THEN 1 ELSE 2 END,
        COALESCE(discovery_priority, 2),
        scraped_at DESC
      LIMIT 20
    `;
    
    const apiResult = await db.query(apiQuery, [organizationId]);
    console.log(`✅ API would return ${apiResult.rows.length} posts`);
    
    if (apiResult.rows.length > 0) {
      console.log('\nSample posts:');
      apiResult.rows.slice(0, 5).forEach((post, index) => {
        console.log(`${index + 1}. ${post.title}`);
        console.log(`   URL: ${post.url}`);
        console.log(`   Classification: ${post.page_classification} | Discovery: ${post.discovered_from}`);
        console.log('');
      });
    }
    
    console.log('\n🎉 TEST COMPLETE');
    console.log('================');
    console.log(`✅ Sitemap posts discovered: ${sitemapResult.totalPostsFound}`);
    console.log(`✅ Posts stored successfully: ${storedCount}`);
    console.log(`✅ API-queryable posts: ${apiResult.rows.length}`);
    console.log(`✅ Issue resolved: ${apiResult.rows.length >= 10 ? 'YES' : 'PARTIALLY'}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testSitemapStorage()
  .then(() => {
    console.log('\n🚀 Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test failed:', error.message);
    process.exit(1);
  });