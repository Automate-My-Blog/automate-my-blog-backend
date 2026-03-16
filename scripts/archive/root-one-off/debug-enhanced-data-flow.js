#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import webScraperService from './services/webscraper.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function debugEnhancedDataFlow() {
  console.log('🔍 DEBUG: Enhanced Data Flow Analysis');
  console.log('=====================================\n');
  
  const testPostUrl = 'https://lumibears.com/blog/emotional-support-stuffed-animals-for-kids';
  
  try {
    console.log('1️⃣ Testing Individual Blog Post Scraping');
    console.log('==========================================');
    console.log(`Testing URL: ${testPostUrl}\n`);
    
    const postData = await webScraperService.scrapeBlogPost(testPostUrl);
    
    if (!postData) {
      console.log('❌ No post data returned from scraping');
      return;
    }
    
    console.log('✅ Post data structure received:');
    console.log(`📝 Title: "${postData.title}"`);
    console.log(`📊 Content length: ${postData.content?.length || 0} characters`);
    console.log(`🔤 Word count: ${postData.wordCount || 0}`);
    console.log(`📄 Headings: ${postData.headings?.length || 0}`);
    console.log(`🔗 Internal links: ${postData.internalLinks?.length || 0}`);
    console.log(`🌐 External links: ${postData.externalLinks?.length || 0}`);
    
    // Check CTAs
    console.log(`\n🎯 CTA Analysis:`);
    if (postData.ctas) {
      console.log(`   ✅ CTAs found: ${postData.ctas.length}`);
      postData.ctas.forEach((cta, i) => {
        console.log(`   ${i+1}. "${cta.text}" (${cta.type}) - ${cta.placement}`);
        if (cta.href) console.log(`      → ${cta.href}`);
      });
    } else {
      console.log(`   ❌ No CTAs in post data`);
    }
    
    // Check Visual Design
    console.log(`\n🎨 Visual Design Analysis:`);
    if (postData.visualDesign) {
      console.log(`   ✅ Visual design data captured`);
      const vd = postData.visualDesign;
      
      if (vd.colors && vd.colors.primary) {
        console.log(`   🎨 Colors found: ${vd.colors.primary.length}`);
        vd.colors.primary.slice(0, 5).forEach((color, i) => {
          console.log(`      ${i+1}. ${color}`);
        });
      }
      
      if (vd.typography && vd.typography.fonts) {
        console.log(`   🔤 Fonts found: ${vd.typography.fonts.length}`);
        vd.typography.fonts.slice(0, 3).forEach((font, i) => {
          console.log(`      ${i+1}. ${font}`);
        });
      }
      
      if (vd.contentStructure) {
        console.log(`   📊 Content structure:`);
        Object.entries(vd.contentStructure).forEach(([key, value]) => {
          console.log(`      ${key}: ${value}`);
        });
      }
      
    } else {
      console.log(`   ❌ No visual design data in post data`);
    }
    
    console.log('\n2️⃣ Testing Multiple Post Scraping');
    console.log('==================================');
    
    const testUrls = [
      'https://lumibears.com/blog/emotional-support-stuffed-animals-for-kids',
      'https://lumibears.com/blog/wellness-companion-teddy-bear-for-children'
    ];
    
    console.log(`Testing ${testUrls.length} URLs via scrapeBlogPosts...\n`);
    
    const multipleResults = await webScraperService.scrapeBlogPosts(testUrls);
    
    console.log(`✅ Multiple posts scraping completed`);
    console.log(`📊 Results: ${multipleResults.length} posts processed\n`);
    
    multipleResults.forEach((post, i) => {
      console.log(`Post ${i+1}: ${post.title}`);
      console.log(`   Content: ${post.content?.length || 0} chars`);
      console.log(`   CTAs: ${post.ctas?.length || 0}`);
      console.log(`   Visual Design: ${post.visualDesign ? 'Yes' : 'No'}`);
      console.log(`   Structure: ${post.visualDesign?.contentStructure ? 'Yes' : 'No'}`);
    });

    console.log('\n3️⃣ Data Structure Validation');
    console.log('==============================');
    
    const firstPost = multipleResults[0];
    if (firstPost) {
      console.log('🔍 Detailed first post analysis:');
      console.log(`Raw post keys: ${Object.keys(firstPost).join(', ')}`);
      
      if (firstPost.visualDesign) {
        console.log(`Visual design keys: ${Object.keys(firstPost.visualDesign).join(', ')}`);
        if (firstPost.visualDesign.contentStructure) {
          console.log(`Content structure keys: ${Object.keys(firstPost.visualDesign.contentStructure).join(', ')}`);
        }
      }
    }
    
    console.log('\n🎯 DIAGNOSIS:');
    console.log('=============');
    
    if (postData.ctas && postData.ctas.length > 0) {
      console.log('✅ CTA extraction is working correctly');
    } else {
      console.log('❌ CTA extraction is not working - check page evaluation logic');
    }
    
    if (postData.visualDesign) {
      console.log('✅ Visual design extraction is working correctly');
    } else {
      console.log('❌ Visual design extraction is not working - check page evaluation logic');
    }
    
    if (postData.content && postData.content.length > 8000) {
      console.log('✅ Full content capture is working correctly');
    } else {
      console.log('❌ Content is still being truncated or not captured');
    }
    
    console.log('\n📋 Next Steps:');
    if (!postData.ctas || !postData.visualDesign) {
      console.log('🔧 Issue is in the blog post scraping function page evaluation');
      console.log('   - Check browser/page context');
      console.log('   - Verify page evaluation functions are running');
      console.log('   - Test with simpler page first');
    } else {
      console.log('🔧 Issue is likely in the storage/database layer');
      console.log('   - Data is being extracted correctly');
      console.log('   - Problem is in storeAnalysisResults function');
      console.log('   - Check database field mapping');
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the debug
debugEnhancedDataFlow()
  .then(() => {
    console.log('\n🔍 Debug completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Debug failed:', error.message);
    process.exit(1);
  });