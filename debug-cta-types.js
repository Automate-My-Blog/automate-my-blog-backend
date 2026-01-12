#!/usr/bin/env node

import webScraperService from './services/webscraper.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function debugCTATypes() {
  console.log('🔍 CTA TYPES DEBUG');
  console.log('==================\n');
  
  try {
    // Scrape a single blog post to see what CTA types are being extracted
    const testUrl = 'https://lumibears.com/blog/emotional-support-stuffed-animals-for-kids';
    console.log(`🔍 Scraping: ${testUrl}`);
    
    const post = await webScraperService.scrapeBlogPost(testUrl);
    
    console.log(`\n📊 Post analysis:`);
    console.log(`Title: ${post.title}`);
    console.log(`CTAs found: ${post.ctas?.length || 0}`);
    
    if (post.ctas && post.ctas.length > 0) {
      console.log('\n🎯 CTA Types Found:');
      const uniqueTypes = new Set();
      
      post.ctas.forEach((cta, i) => {
        console.log(`${i+1}. "${cta.text}" (Type: "${cta.type}", Placement: "${cta.placement}")`);
        uniqueTypes.add(cta.type);
        
        // Check for problematic values
        if (!cta.type || cta.type.trim() === '') {
          console.log(`   ⚠️  Empty or null type detected`);
        }
        if (cta.type && cta.type.length > 50) {
          console.log(`   ⚠️  Type too long: ${cta.type.length} characters`);
        }
      });
      
      console.log(`\n📋 Unique CTA Types: ${Array.from(uniqueTypes).join(', ')}`);
      
      // Check for any problematic characters or values
      const problematicTypes = Array.from(uniqueTypes).filter(type => 
        !type || 
        type.trim() === '' || 
        type.length > 50 ||
        type.includes('\n') ||
        type.includes('\t') ||
        /[^\w\s\-_]/.test(type)
      );
      
      if (problematicTypes.length > 0) {
        console.log(`\n❌ Problematic CTA Types: ${problematicTypes.join(', ')}`);
      } else {
        console.log(`\n✅ All CTA types look valid`);
      }
    } else {
      console.log('\n❌ No CTAs found');
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run debug
debugCTATypes()
  .then(() => {
    console.log('\n🔍 CTA types debug completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Debug failed:', error.message);
    process.exit(1);
  });