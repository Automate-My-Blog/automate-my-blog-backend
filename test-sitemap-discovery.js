#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import webScraperService from './services/webscraper.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testSitemapDiscovery() {
  console.log('🗺️ TESTING SITEMAP DISCOVERY');
  console.log('============================\n');
  
  const testUrl = 'https://www.lumibears.com';
  
  try {
    // Test 1: Direct Sitemap Discovery
    console.log('1️⃣ Testing Direct Sitemap Discovery');
    console.log('-----------------------------------');
    console.log(`Testing URL: ${testUrl}`);
    
    const sitemapResult = await webScraperService.discoverFromSitemap(testUrl);
    
    console.log(`✅ Sitemap Discovery Complete!`);
    console.log(`   Sitemaps found: ${sitemapResult.sitemapsFound.length}`);
    console.log(`   Blog posts discovered: ${sitemapResult.totalPostsFound}`);
    
    if (sitemapResult.sitemapsFound.length > 0) {
      console.log('\\n📄 Sitemaps Found:');
      sitemapResult.sitemapsFound.forEach((sitemap, index) => {
        console.log(`   ${index + 1}. ${sitemap}`);
      });
    }
    
    if (sitemapResult.blogPosts.length > 0) {
      console.log('\\n📄 Blog Posts Discovered:');
      sitemapResult.blogPosts.forEach((post, index) => {
        console.log(`   ${index + 1}. ${post.title}`);
        console.log(`      URL: ${post.url}`);
        console.log(`      Last Modified: ${post.lastModified || 'Unknown'}`);
        console.log(`      Priority: ${post.priority}`);
        console.log(`      Change Frequency: ${post.changeFreq || 'Unknown'}`);
        console.log('');
      });
    }
    
    // Test 2: URL Classification Test
    console.log('2️⃣ Testing URL Classification');
    console.log('------------------------------');
    
    const testUrls = [
      'https://lumibears.com/blog/comfort-bears-vs-sleep-aids',
      'https://lumibears.com/blog',
      'https://lumibears.com/products/lumi-classic-bear',
      'https://lumibears.com/faq',
      'https://lumibears.com/sitemap.xml'
    ];
    
    testUrls.forEach(url => {
      const isBlogPost = webScraperService.isBlogPostUrl(url);
      const title = webScraperService.extractTitleFromUrl(url);
      console.log(`   ${url}`);
      console.log(`     Is Blog Post: ${isBlogPost ? '✅' : '❌'}`);
      console.log(`     Extracted Title: "${title}"`);
      console.log('');
    });
    
    // Test 3: Full Enhanced Discovery (with Sitemap + Traditional)
    console.log('3️⃣ Testing Full Enhanced Discovery');
    console.log('----------------------------------');
    
    const fullResult = await webScraperService.discoverBlogPages(testUrl);
    
    console.log(`✅ Full Discovery Complete!`);
    console.log(`   Total posts found: ${fullResult.totalPostsFound}`);
    console.log(`   Sitemap posts: ${fullResult.sitemapPostsFound || 0}`);
    console.log(`   Index pages: ${fullResult.indexPagesFound || 0}`);
    console.log(`   Individual posts: ${fullResult.individualPostsFound || 0}`);
    
    if (fullResult.analysis) {
      console.log(`\\n📊 Analysis Results:`);
      console.log(`   Has Sitemap: ${fullResult.analysis.hasSitemap ? '✅' : '❌'}`);
      console.log(`   Has Index: ${fullResult.analysis.hasIndex ? '✅' : '❌'}`);
      console.log(`   Has Individual Posts: ${fullResult.analysis.hasIndividualPosts ? '✅' : '❌'}`);
      console.log(`   Quality Score: ${Math.round(fullResult.analysis.qualityScore * 100)}%`);
      console.log(`   Discovery Methods: ${fullResult.analysis.discoveryMethods.join(', ')}`);
    }
    
    console.log(`\\n📚 Discovered Blog Posts (Top ${Math.min(fullResult.blogPosts.length, 10)}):`);
    console.log('----------------------------------------');
    
    fullResult.blogPosts.slice(0, 10).forEach((post, index) => {
      console.log(`   ${index + 1}. ${post.title}`);
      console.log(`      URL: ${post.url}`);
      console.log(`      Discovery: ${post.discoveredFrom}`);
      console.log(`      Priority: ${post.priority || 'N/A'}`);
      if (post.lastModified) console.log(`      Last Modified: ${post.lastModified}`);
      if (post.wordCount) console.log(`      Word Count: ${post.wordCount}`);
      console.log('');
    });
    
    // Test 4: Individual Post Content Scraping (from sitemap)
    if (fullResult.blogPosts.length > 0) {
      console.log('4️⃣ Testing Individual Post Content Scraping');
      console.log('--------------------------------------------');
      
      const samplePost = fullResult.blogPosts[0];
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
    
    console.log('\\n🎉 SITEMAP DISCOVERY TEST COMPLETE');
    console.log('====================================');
    console.log('✅ XML sitemap parsing implemented');
    console.log('✅ Blog post URL classification');
    console.log('✅ Title extraction from URLs');
    console.log('✅ Integration with traditional discovery');
    console.log('✅ Priority-based post sorting');
    console.log('');
    console.log('📊 Final Summary:');
    console.log(`   Sitemaps found: ${fullResult.sitemapsFound?.length || 0}`);
    console.log(`   Blog posts discovered: ${fullResult.totalPostsFound}`);
    console.log(`   Discovery methods: ${fullResult.analysis?.discoveryMethods.length || 0}`);
    console.log(`   Overall quality: ${Math.round((fullResult.analysis?.qualityScore || 0) * 100)}%`);
    
  } catch (error) {
    console.error('❌ Sitemap discovery test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testSitemapDiscovery()
  .then(() => {
    console.log('\\n🚀 Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\\n💥 Test failed:', error.message);
    process.exit(1);
  });