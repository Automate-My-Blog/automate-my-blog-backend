#!/usr/bin/env node

import db from './services/database.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function debugSchema() {
  try {
    console.log('🔍 Debugging Website Pages Schema');
    console.log('=================================\n');
    
    const schemaQuery = `
      SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'website_pages' 
      AND column_name IN ('discovery_priority', 'discovery_confidence')
      ORDER BY column_name
    `;
    
    const schemaResult = await db.query(schemaQuery);
    console.log('📊 Enhanced schema fields:');
    console.table(schemaResult.rows);
    
    // Also check what values the sitemap discovery is trying to insert
    console.log('\n🔍 Sample sitemap post data:');
    
    // Import webscraper to see what data structure it produces
    const webScraperService = await import('./services/webscraper.js');
    const sitemapResult = await webScraperService.default.discoverFromSitemap('https://lumibears.com');
    
    if (sitemapResult.blogPosts.length > 0) {
      const samplePost = sitemapResult.blogPosts[0];
      console.log('Sample post object:');
      console.log(JSON.stringify(samplePost, null, 2));
      
      console.log('\nFields that would be inserted:');
      console.log(`- priority: ${samplePost.priority} (type: ${typeof samplePost.priority})`);
      console.log(`- confidence: ${samplePost.confidence} (type: ${typeof samplePost.confidence})`);
      console.log(`- discoveredFrom: ${samplePost.discoveredFrom}`);
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    console.error(error.stack);
  }
}

// Run the debug
debugSchema()
  .then(() => {
    console.log('\n🚀 Debug completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Debug failed:', error.message);
    process.exit(1);
  });