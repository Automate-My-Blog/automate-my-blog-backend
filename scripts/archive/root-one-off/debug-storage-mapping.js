#!/usr/bin/env node

import webScraperService from './services/webscraper.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function debugStorageMapping() {
  console.log('🔍 STORAGE MAPPING DEBUG');
  console.log('========================\n');
  
  try {
    // Step 1: Get blog discovery data
    console.log('1️⃣ Blog Discovery Phase');
    console.log('========================');
    
    const blogDiscovery = await webScraperService.discoverBlogPages('https://www.lumibears.com');
    console.log(`📖 Discovered posts: ${blogDiscovery.blogPosts.length}`);
    
    if (blogDiscovery.blogPosts.length > 0) {
      console.log('\n📋 Discovered post sample:');
      console.log(JSON.stringify(blogDiscovery.blogPosts[0], null, 2));
    }

    // Step 2: Get detailed posts
    console.log('\n2️⃣ Detailed Scraping Phase');
    console.log('============================');
    
    const urlsToScrape = blogDiscovery.blogPosts.slice(0, 3).map(post => post.url);
    console.log(`🔍 URLs to scrape: ${urlsToScrape.length}`);
    urlsToScrape.forEach((url, i) => console.log(`   ${i+1}. ${url}`));
    
    const detailedPosts = await webScraperService.scrapeBlogPosts(urlsToScrape);
    console.log(`📝 Detailed posts returned: ${detailedPosts.length}`);
    
    if (detailedPosts.length > 0) {
      console.log('\n📋 Detailed post sample:');
      const sample = detailedPosts[0];
      console.log(`URL: ${sample.url}`);
      console.log(`Title: ${sample.title}`);
      console.log(`Content length: ${sample.content?.length || 0}`);
      console.log(`Visual design: ${sample.visualDesign ? 'Present' : 'Missing'}`);
      console.log(`CTAs: ${sample.ctas?.length || 0}`);
      console.log(`Word count: ${sample.wordCount || 0}`);
    }

    // Step 3: Check URL matching
    console.log('\n3️⃣ URL Matching Analysis');
    console.log('=========================');
    
    for (const discoveredPost of blogDiscovery.blogPosts.slice(0, 3)) {
      const detailedPost = detailedPosts.find(dp => dp.url === discoveredPost.url);
      console.log(`\n📄 ${discoveredPost.url}`);
      console.log(`   Discovered: ✅`);
      console.log(`   Detailed: ${detailedPost ? '✅' : '❌'}`);
      
      if (detailedPost) {
        console.log(`   Content: ${detailedPost.content?.length || 0} chars`);
        console.log(`   Visual Design: ${detailedPost.visualDesign ? 'Present' : 'Missing'}`);
        console.log(`   CTAs: ${detailedPost.ctas?.length || 0}`);
      } else {
        console.log(`   ❌ URL mismatch - detailed post not found`);
      }
    }

    // Step 4: Storage mapping simulation
    console.log('\n4️⃣ Storage Mapping Simulation');
    console.log('==============================');
    
    for (const post of blogDiscovery.blogPosts.slice(0, 2)) {
      const detailedPost = detailedPosts.find(dp => dp.url === post.url);
      
      console.log(`\n📄 Processing: ${post.url}`);
      console.log('Values that would be stored:');
      console.log(`   Title: ${detailedPost?.title || post.title || 'Unknown'}`);
      console.log(`   Content: ${(detailedPost?.content || post.content || '').length} chars`);
      console.log(`   Visual Design: ${detailedPost?.visualDesign ? 'JSON Data' : 'NULL'}`);
      console.log(`   Content Structure: ${detailedPost?.visualDesign?.contentStructure ? 'JSON Data' : 'NULL'}`);
      console.log(`   CTAs: ${detailedPost?.ctas ? `${detailedPost.ctas.length} CTAs` : 'NULL'}`);
      console.log(`   Word Count: ${detailedPost?.wordCount || post.wordCount || 'NULL'}`);
      console.log(`   Last Modified: ${post.lastModified || 'NULL'}`);
      console.log(`   Priority: ${post.priority || 'NULL'}`);
      console.log(`   Change Freq: ${post.changeFreq || 'NULL'}`);
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run debug
debugStorageMapping()
  .then(() => {
    console.log('\n🔍 Storage mapping debug completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Debug failed:', error.message);
    process.exit(1);
  });