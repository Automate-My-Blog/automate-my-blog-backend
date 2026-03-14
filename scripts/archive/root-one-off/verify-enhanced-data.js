#!/usr/bin/env node

import db from './services/database.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function verifyEnhancedData() {
  console.log('🔍 ENHANCED DATA VERIFICATION');
  console.log('=============================\n');
  
  const orgId = '9d297834-b620-49a1-b597-02a6b815b7de';
  
  try {
    console.log('1️⃣ Checking Database Schema');
    console.log('============================');
    
    // Check if enhanced columns exist
    const schemaCheck = await db.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'website_pages' 
        AND column_name IN ('visual_design', 'content_structure', 'ctas_extracted')
      ORDER BY column_name;
    `);
    
    console.log('📊 Enhanced columns in website_pages:');
    schemaCheck.rows.forEach(col => {
      console.log(`   ✅ ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
    });
    
    if (schemaCheck.rows.length === 0) {
      console.log('❌ Enhanced columns not found - schema update needed');
      return;
    }

    console.log('\n2️⃣ Checking Enhanced Data Availability');
    console.log('========================================');
    
    const dataQuery = `
      SELECT 
        title, url, page_classification, discovered_from,
        CASE WHEN visual_design IS NOT NULL THEN 'Yes' ELSE 'No' END as has_visual_design,
        CASE WHEN content_structure IS NOT NULL THEN 'Yes' ELSE 'No' END as has_content_structure,
        CASE WHEN ctas_extracted IS NOT NULL THEN jsonb_array_length(ctas_extracted) ELSE 0 END as ctas_count,
        LENGTH(content) as content_length,
        word_count,
        scraped_at
      FROM website_pages 
      WHERE organization_id = $1 
        AND page_classification = 'blog_post'
      ORDER BY scraped_at DESC 
      LIMIT 10;
    `;
    
    const dataResult = await db.query(dataQuery, [orgId]);
    
    console.log(`📊 Found ${dataResult.rows.length} blog posts:`);
    
    let postsWithVisualDesign = 0;
    let postsWithContentStructure = 0; 
    let totalCTAs = 0;
    let postsWithContent = 0;
    
    dataResult.rows.forEach((row, i) => {
      console.log(`\n${i+1}. ${row.title}`);
      console.log(`   URL: ${row.url.split('/').pop()}`);
      console.log(`   Discovery: ${row.discovered_from}`);
      console.log(`   Visual Design: ${row.has_visual_design}`);
      console.log(`   Content Structure: ${row.has_content_structure}`);
      console.log(`   CTAs: ${row.ctas_count}`);
      console.log(`   Content: ${row.content_length} chars`);
      console.log(`   Word Count: ${row.word_count || 0}`);
      
      if (row.has_visual_design === 'Yes') postsWithVisualDesign++;
      if (row.has_content_structure === 'Yes') postsWithContentStructure++;
      if (row.content_length > 100) postsWithContent++;
      totalCTAs += parseInt(row.ctas_count);
    });

    console.log('\n3️⃣ Enhanced Data Summary');
    console.log('=========================');
    console.log(`📊 Total blog posts: ${dataResult.rows.length}`);
    console.log(`🎨 Posts with visual design: ${postsWithVisualDesign}`);
    console.log(`📋 Posts with content structure: ${postsWithContentStructure}`);
    console.log(`🎯 Total CTAs extracted: ${totalCTAs}`);
    console.log(`📝 Posts with substantial content: ${postsWithContent}`);

    if (postsWithVisualDesign > 0) {
      console.log('\n🎨 Visual Design Sample:');
      const designSample = await db.query(`
        SELECT visual_design 
        FROM website_pages 
        WHERE organization_id = $1 AND visual_design IS NOT NULL 
        LIMIT 1;
      `, [orgId]);
      
      if (designSample.rows.length > 0) {
        const design = designSample.rows[0].visual_design;
        console.log(`   Colors: ${design.colors?.primary?.length || 0} found`);
        console.log(`   Fonts: ${design.typography?.fonts?.length || 0} found`);
        console.log(`   Structure: ${JSON.stringify(design.contentStructure)}`);
      }
    }

    if (totalCTAs > 0) {
      console.log('\n🎯 CTA Analysis:');
      const ctaQuery = `
        SELECT page_type, analysis_source, COUNT(*) as count
        FROM cta_analysis 
        WHERE organization_id = $1
        GROUP BY page_type, analysis_source;
      `;
      
      const ctaResult = await db.query(ctaQuery, [orgId]);
      ctaResult.rows.forEach(row => {
        console.log(`   ${row.page_type} (${row.analysis_source}): ${row.count} CTAs`);
      });
    }

    console.log('\n4️⃣ Frontend API Simulation');
    console.log('============================');
    
    // Simulate the actual frontend API query
    const frontendQuery = `
      SELECT 
        id, url, page_type, title, LEFT(content, 300) as content_preview,
        meta_description, published_date, author, word_count,
        jsonb_array_length(COALESCE(internal_links, '[]'::jsonb)) as internal_links_count,
        jsonb_array_length(COALESCE(external_links, '[]'::jsonb)) as external_links_count,
        analysis_quality_score, scraped_at,
        COALESCE(page_classification, 'unknown') as page_classification,
        COALESCE(discovered_from, 'unknown') as discovered_from,
        featured_image_url, excerpt, discovery_priority, discovery_confidence,
        visual_design, content_structure, 
        jsonb_array_length(COALESCE(ctas_extracted, '[]'::jsonb)) as ctas_count
      FROM website_pages 
      WHERE organization_id = $1 
        AND COALESCE(page_classification, 'blog_post') != 'blog_index'
      ORDER BY 
        CASE WHEN COALESCE(page_classification, 'blog_post') = 'blog_post' THEN 1 
             WHEN page_classification = 'blog_index' THEN 2 
             ELSE 3 END,
        COALESCE(discovery_priority, 2),
        published_date DESC NULLS LAST,
        scraped_at DESC
      LIMIT 5;
    `;
    
    const frontendResult = await db.query(frontendQuery, [orgId]);
    
    console.log('📱 Frontend API simulation results:');
    console.log(`   ✅ ${frontendResult.rows.length} posts returned`);
    
    const enhancedPosts = frontendResult.rows.filter(row => 
      row.visual_design || row.content_structure || row.ctas_count > 0
    );
    
    console.log(`   🎨 ${enhancedPosts.length} posts with enhanced data`);
    console.log(`   🎯 ${frontendResult.rows.reduce((sum, row) => sum + row.ctas_count, 0)} total CTAs`);

    console.log('\n🎉 ENHANCED SYSTEM STATUS');
    console.log('==========================');
    
    if (enhancedPosts.length > 0 && totalCTAs > 0) {
      console.log('🚀 SUCCESS! Enhanced blog analysis system is working!');
      console.log('✅ Enhanced data is being captured and stored');
      console.log('✅ CTAs are being detected and stored');
      console.log('✅ Visual design data is available');
      console.log('✅ Content structure data is available');
      console.log('✅ Data is ready for frontend consumption');
      
      console.log('\n📱 FRONTEND INTEGRATION:');
      console.log('- Enhanced data is available in existing API endpoints');
      console.log('- visual_design field contains colors, typography, layout');
      console.log('- content_structure field contains paragraph counts, formatting');
      console.log('- ctas_count shows number of CTAs per post');
      console.log('- CTA details available via CTA analysis API');
    } else {
      console.log('⚠️  Enhanced system needs attention:');
      if (enhancedPosts.length === 0) console.log('❌ No enhanced data found');
      if (totalCTAs === 0) console.log('❌ No CTAs stored');
      console.log('🔧 Consider re-running analysis or checking data flow');
    }
    
  } catch (error) {
    console.error('❌ Enhanced data verification failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    await db.end();
  }
}

// Run verification
verifyEnhancedData()
  .then(() => {
    console.log('\n🔍 Enhanced data verification completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Verification failed:', error.message);
    process.exit(1);
  });