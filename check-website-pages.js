#!/usr/bin/env node

import db from './services/database.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function checkWebsitePages() {
  try {
    console.log('🔍 Checking website_pages table for organization: 9d297834-b620-49a1-b597-02a6b815b7de');
    
    // Check if organization exists
    const orgResult = await db.query(
      'SELECT id, name, website_url, last_analyzed_at FROM organizations WHERE id = $1',
      ['9d297834-b620-49a1-b597-02a6b815b7de']
    );
    
    if (orgResult.rows.length === 0) {
      console.log('❌ Organization not found!');
      return;
    }
    
    const org = orgResult.rows[0];
    console.log('✅ Organization found:');
    console.log(`   Name: ${org.name}`);
    console.log(`   Website: ${org.website_url}`);
    console.log(`   Last analyzed: ${org.last_analyzed_at}`);
    console.log('');
    
    // Check website_pages table
    const pagesQuery = `
      SELECT COUNT(*) as count, page_type, 
             COALESCE(discovered_from, 'unknown') as discovered_from,
             page_classification
      FROM website_pages 
      WHERE organization_id = $1 
      GROUP BY page_type, discovered_from, page_classification
      ORDER BY count DESC
    `;
    
    const pagesResult = await db.query(pagesQuery, ['9d297834-b620-49a1-b597-02a6b815b7de']);
    
    console.log('📊 Website Pages Summary:');
    console.log('=========================');
    if (pagesResult.rows.length === 0) {
      console.log('❌ No pages found in website_pages table!');
    } else {
      console.table(pagesResult.rows);
    }
    
    // Get all pages with details
    const detailsQuery = `
      SELECT id, url, page_type, title, 
             COALESCE(discovered_from, 'unknown') as discovered_from,
             page_classification, scraped_at,
             LENGTH(content) as content_length,
             word_count
      FROM website_pages 
      WHERE organization_id = $1 
      ORDER BY scraped_at DESC
      LIMIT 20
    `;
    
    const detailsResult = await db.query(detailsQuery, ['9d297834-b620-49a1-b597-02a6b815b7de']);
    
    console.log('\n📄 Individual Pages:');
    console.log('====================');
    
    if (detailsResult.rows.length === 0) {
      console.log('❌ No individual pages found!');
    } else {
      detailsResult.rows.forEach((page, index) => {
        console.log(`${index + 1}. ${page.title || 'No title'}`);
        console.log(`   URL: ${page.url}`);
        console.log(`   Type: ${page.page_type} | Classification: ${page.page_classification || 'unknown'}`);
        console.log(`   Discovery: ${page.discovered_from} | Scraped: ${page.scraped_at}`);
        console.log(`   Content: ${page.content_length} chars | Words: ${page.word_count || 'N/A'}`);
        console.log('');
      });
    }
    
    // Check if enhanced schema columns exist
    const schemaQuery = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'website_pages' 
      AND column_name IN ('page_classification', 'discovered_from', 'parent_index_url', 'discovery_priority')
      ORDER BY column_name
    `;
    
    const schemaResult = await db.query(schemaQuery);
    
    console.log('\n🔧 Schema Check:');
    console.log('================');
    console.log('Enhanced blog discovery columns:');
    if (schemaResult.rows.length === 0) {
      console.log('❌ No enhanced columns found - schema migration needed!');
    } else {
      schemaResult.rows.forEach(col => {
        console.log(`✅ ${col.column_name} (${col.data_type})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Check failed:', error.message);
  } finally {
    // No need to end the pool as it's a shared connection
  }
}

// Run the check
checkWebsitePages()
  .then(() => {
    console.log('\n✅ Check completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Check failed:', error.message);
    process.exit(1);
  });