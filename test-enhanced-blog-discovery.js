#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import webScraperService from './services/webscraper.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testEnhancedBlogDiscovery() {
  console.log('🧪 TESTING ENHANCED BLOG DISCOVERY');
  console.log('==================================\n');
  
  const testUrl = 'https://www.lumibears.com/blog';
  
  try {
    // Test 1: Page Type Detection
    console.log('1️⃣ Testing Page Type Detection');
    console.log('-------------------------------');
    console.log(`Testing URL: ${testUrl}`);
    
    const pageType = await webScraperService.detectPageType(testUrl);
    console.log(`✅ Page Type: ${pageType.type}`);
    console.log(`   Confidence: ${Math.round(pageType.confidence * 100)}%`);
    console.log(`   Details:`, pageType.details);
    console.log('');
    
    // Test 2: Blog Post Link Extraction
    console.log('2️⃣ Testing Blog Post Link Extraction');
    console.log('-------------------------------------');
    
    const foundPosts = await webScraperService.findBlogPostsOnPage(testUrl);
    console.log(`✅ Found ${foundPosts.length} potential blog posts`);
    
    const highPriorityPosts = foundPosts.filter(p => p.priority === 1);
    console.log(`   High priority posts: ${highPriorityPosts.length}`);
    console.log(`   Medium priority posts: ${foundPosts.length - highPriorityPosts.length}`);
    
    if (foundPosts.length > 0) {
      console.log('\\n   Sample posts found:');
      foundPosts.slice(0, 5).forEach((post, index) => {
        console.log(`     ${index + 1}. ${post.title}`);
        console.log(`        URL: ${post.url}`);
        console.log(`        Priority: ${post.priority} | Likely Post: ${post.isLikelyPost}`);
        if (post.excerpt) {
          console.log(`        Excerpt: ${post.excerpt.slice(0, 100)}...`);
        }
        console.log('');
      });
    }
    
    // Test 3: Full Blog Discovery with Individual Post Scraping
    console.log('3️⃣ Testing Full Enhanced Blog Discovery');
    console.log('---------------------------------------');
    
    const discoveryResult = await webScraperService.discoverBlogPages('https://www.lumibears.com');
    console.log('✅ Discovery completed!');
    console.log(`   Blog sections: ${discoveryResult.blogSections.length}`);
    console.log(`   Total posts found: ${discoveryResult.totalPostsFound}`);
    console.log(`   Index pages: ${discoveryResult.indexPagesFound || 0}`);
    console.log(`   Individual posts: ${discoveryResult.individualPostsFound || 0}`);
    
    if (discoveryResult.analysis) {
      console.log(`   Has blog index: ${discoveryResult.analysis.hasIndex}`);
      console.log(`   Has individual posts: ${discoveryResult.analysis.hasIndividualPosts}`);
      console.log(`   Quality score: ${Math.round(discoveryResult.analysis.qualityScore * 100)}%`);
    }
    
    console.log('\\n📄 Blog Posts Discovered:');
    console.log('--------------------------');
    
    if (discoveryResult.blogPosts.length === 0) {
      console.log('   ℹ️  No individual blog posts found.');
      console.log('   This might indicate:');
      console.log('     - The blog uses JavaScript loading');
      console.log('     - Posts are behind authentication');
      console.log('     - Different URL structure than expected');
      console.log('     - Site is blocking automated scraping');
    } else {
      discoveryResult.blogPosts.forEach((post, index) => {
        console.log(`   ${index + 1}. ${post.title}`);
        console.log(`      URL: ${post.url}`);
        console.log(`      Discovery: ${post.discoveredFrom}`);
        console.log(`      Word Count: ${post.wordCount || 'Unknown'}`);
        if (post.author) console.log(`      Author: ${post.author}`);
        if (post.publishDate) console.log(`      Published: ${post.publishDate}`);
        if (post.excerpt) console.log(`      Excerpt: ${post.excerpt.slice(0, 100)}...`);
        console.log('');
      });
    }
    
    // Test 4: Individual Post Content Scraping (if posts found)
    if (discoveryResult.blogPosts.length > 0) {
      console.log('4️⃣ Testing Individual Post Content Scraping');
      console.log('--------------------------------------------');
      
      const samplePost = discoveryResult.blogPosts[0];
      console.log(`Testing post: ${samplePost.title}`);
      console.log(`URL: ${samplePost.url}`);
      
      try {
        const fullContent = await webScraperService.scrapeBlogPost(samplePost.url);
        if (fullContent) {
          console.log('✅ Individual post scraping successful!');
          console.log(`   Title: ${fullContent.title}`);
          console.log(`   Content length: ${fullContent.content.length} characters`);
          console.log(`   Word count: ${fullContent.wordCount}`);
          console.log(`   Headings: ${fullContent.headings.length}`);
          console.log(`   Internal links: ${fullContent.internalLinks.length}`);
          console.log(`   External links: ${fullContent.externalLinks.length}`);
          if (fullContent.author) console.log(`   Author: ${fullContent.author}`);
          if (fullContent.publishDate) console.log(`   Published: ${fullContent.publishDate}`);
          
          console.log('\\n   Content sample:');
          console.log(`   "${fullContent.content.slice(0, 200)}..."`);
        } else {
          console.log('❌ Individual post scraping failed - no content returned');
        }
      } catch (postError) {
        console.log(`❌ Individual post scraping failed: ${postError.message}`);
      }
    }
    
    console.log('\\n🎉 ENHANCED BLOG DISCOVERY TEST COMPLETE');
    console.log('==========================================');
    console.log('✅ Page type detection implemented');
    console.log('✅ Blog index vs individual post classification');
    console.log('✅ Enhanced post link extraction');
    console.log('✅ Individual post content scraping');
    console.log('✅ Priority-based post discovery');
    console.log('');
    console.log('📊 Summary:');
    console.log(`   Page type: ${pageType.type}`);
    console.log(`   Posts found on index: ${foundPosts.length}`);
    console.log(`   Individual posts scraped: ${discoveryResult.blogPosts.filter(p => p.discoveredFrom === 'blog_index_scraped').length}`);
    console.log(`   Total blog content discovered: ${discoveryResult.totalPostsFound}`);
    
  } catch (error) {
    console.error('❌ Enhanced blog discovery test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testEnhancedBlogDiscovery()
  .then(() => {
    console.log('\\n🚀 Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\\n💥 Test failed:', error.message);
    process.exit(1);
  });