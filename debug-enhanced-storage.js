#!/usr/bin/env node

import webScraperService from './services/webscraper.js';
import blogAnalyzerService from './services/blog-analyzer.js';
import db from './services/database.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function debugEnhancedStorage() {
  console.log('🔍 ENHANCED DATA STORAGE DEBUG');
  console.log('==============================\n');
  
  const orgId = '9d297834-b620-49a1-b597-02a6b815b7de';
  const testUrl = 'https://lumibears.com/blog/emotional-support-stuffed-animals-for-kids';
  
  try {
    console.log('1️⃣ Direct Post Scraping');
    console.log('========================');
    
    const post = await webScraperService.scrapeBlogPost(testUrl);
    
    console.log(`Title: ${post.title}`);
    console.log(`Content length: ${post.content?.length || 0} chars`);
    console.log(`Word count: ${post.wordCount || 0}`);
    console.log(`CTAs: ${post.ctas?.length || 0}`);
    console.log(`Visual design present: ${post.visualDesign ? 'Yes' : 'No'}`);
    
    if (post.visualDesign) {
      console.log(`  Colors: ${post.visualDesign.colors?.primary?.length || 0} primary colors`);
      console.log(`  Fonts: ${post.visualDesign.typography?.fonts?.length || 0} fonts`);
      console.log(`  Content structure: ${post.visualDesign.contentStructure ? 'Yes' : 'No'}`);
    }
    
    console.log('\n2️⃣ Simulating Storage Values');
    console.log('=============================');
    
    // Simulate what would be stored
    const mockDiscoveredPost = {
      url: 'https://lumibears.com/blog/emotional-support-stuffed-animals-for-kids',
      title: 'Emotional Support Stuffed Animals For Kids',
      lastModified: '2025-01-22',
      priority: 0.8,
      changeFreq: 'monthly',
      discoveredFrom: 'sitemap'
    };
    
    const detailedPost = post; // This is our detailed scraped post
    
    console.log('Storage simulation:');
    console.log(`  URL match: ${webScraperService.urlsMatch(detailedPost.url, mockDiscoveredPost.url)}`);
    console.log(`  Title: ${detailedPost?.title || mockDiscoveredPost.title}`);
    console.log(`  Content: ${(detailedPost?.content || '').length} chars`);
    console.log(`  Visual Design JSON: ${detailedPost?.visualDesign ? 'Present' : 'NULL'}`);
    console.log(`  Content Structure JSON: ${detailedPost?.visualDesign?.contentStructure ? 'Present' : 'NULL'}`);
    console.log(`  CTAs JSON: ${detailedPost?.ctas ? 'Present' : 'NULL'}`);
    console.log(`  Word count: ${detailedPost?.wordCount || 'NULL'}`);
    
    console.log('\n3️⃣ Direct Database Insert Test');
    console.log('===============================');
    
    // Clear any existing record for this specific post
    await db.query('DELETE FROM website_pages WHERE organization_id = $1 AND url = $2', 
      [orgId, testUrl]);
    
    // Try direct insert with enhanced data
    const insertQuery = `
      INSERT INTO website_pages (
        organization_id, url, page_type, title, content, meta_description,
        published_date, author, internal_links, external_links, 
        page_classification, discovered_from, featured_image_url, 
        excerpt, discovery_priority, discovery_confidence, 
        word_count, visual_design, content_structure, ctas_extracted,
        last_modified_date, sitemap_priority, sitemap_changefreq, scraped_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW())
    `;
    
    const values = [
      orgId,
      testUrl,
      'blog_post',
      post.title,
      post.content || '',
      post.metaDescription || '',
      null, // published_date
      post.author || null,
      JSON.stringify(post.internalLinks || []),
      JSON.stringify(post.externalLinks || []),
      'blog_post',
      'sitemap',
      null, // featured_image_url
      post.metaDescription || '',
      2, // discovery_priority
      0.8, // discovery_confidence
      post.wordCount || null,
      post.visualDesign ? JSON.stringify(post.visualDesign) : null,
      post.visualDesign?.contentStructure ? JSON.stringify(post.visualDesign.contentStructure) : null,
      post.ctas ? JSON.stringify(post.ctas) : null,
      new Date('2025-01-22'), // last_modified_date
      0.8, // sitemap_priority
      'monthly', // sitemap_changefreq
    ];
    
    console.log('Inserting with enhanced data...');
    await db.query(insertQuery, values);
    console.log('✅ Insert successful');
    
    console.log('\n4️⃣ Verify Stored Data');
    console.log('=====================');
    
    const verifyQuery = `
      SELECT 
        title, url, content, word_count,
        CASE WHEN visual_design IS NOT NULL THEN 'Yes' ELSE 'No' END as has_visual_design,
        CASE WHEN content_structure IS NOT NULL THEN 'Yes' ELSE 'No' END as has_content_structure,
        CASE WHEN ctas_extracted IS NOT NULL THEN jsonb_array_length(ctas_extracted) ELSE 0 END as ctas_count,
        last_modified_date, sitemap_priority, sitemap_changefreq
      FROM website_pages 
      WHERE organization_id = $1 AND url = $2;
    `;
    
    const verifyResult = await db.query(verifyQuery, [orgId, testUrl]);
    
    if (verifyResult.rows.length > 0) {
      const row = verifyResult.rows[0];
      console.log('✅ Data successfully stored:');
      console.log(`  Title: ${row.title}`);
      console.log(`  Content: ${row.content?.length || 0} chars`);
      console.log(`  Word count: ${row.word_count}`);
      console.log(`  Visual design: ${row.has_visual_design}`);
      console.log(`  Content structure: ${row.has_content_structure}`);
      console.log(`  CTAs: ${row.ctas_count}`);
      console.log(`  Last modified: ${row.last_modified_date}`);
      console.log(`  Priority: ${row.sitemap_priority}`);
      console.log(`  Change freq: ${row.sitemap_changefreq}`);
      
      if (row.has_visual_design === 'Yes' && row.ctas_count > 0) {
        console.log('\n🎉 SUCCESS! Enhanced data is being stored correctly!');
      } else {
        console.log('\n⚠️  Enhanced data storage issue persists');
      }
    } else {
      console.log('❌ No data found after insert');
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    process.exit(0);
  }
}

// Run debug
debugEnhancedStorage();