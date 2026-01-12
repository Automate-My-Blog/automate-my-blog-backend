#!/usr/bin/env node

import db from './services/database.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function runSimpleSchemaUpdate() {
  console.log('🔧 SIMPLE SCHEMA UPDATE');
  console.log('=======================\n');
  
  try {
    // Essential column additions
    const updates = [
      {
        name: 'Add enhanced data columns to website_pages',
        query: `
          ALTER TABLE website_pages 
          ADD COLUMN IF NOT EXISTS visual_design JSONB,
          ADD COLUMN IF NOT EXISTS content_structure JSONB,
          ADD COLUMN IF NOT EXISTS ctas_extracted JSONB,
          ADD COLUMN IF NOT EXISTS last_modified_date TIMESTAMP,
          ADD COLUMN IF NOT EXISTS sitemap_priority DECIMAL(3,2),
          ADD COLUMN IF NOT EXISTS sitemap_changefreq VARCHAR(20);
        `
      },
      {
        name: 'Add missing scraped_at column to cta_analysis',
        query: `
          ALTER TABLE cta_analysis 
          ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMP DEFAULT NOW();
        `
      },
      {
        name: 'Add page_type and analysis_source to cta_analysis',
        query: `
          ALTER TABLE cta_analysis 
          ADD COLUMN IF NOT EXISTS page_type VARCHAR(50) DEFAULT 'unknown',
          ADD COLUMN IF NOT EXISTS analysis_source VARCHAR(50) DEFAULT 'manual';
        `
      }
    ];
    
    for (const update of updates) {
      try {
        console.log(`📝 ${update.name}...`);
        await db.query(update.query);
        console.log('   ✅ Success\n');
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log('   ⚠️  Column already exists - skipped\n');
        } else {
          console.log(`   ❌ Error: ${error.message}\n`);
        }
      }
    }
    
    // Verify columns exist
    console.log('🔍 VERIFYING COLUMNS');
    console.log('====================');
    
    const websitePagesColumns = await db.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'website_pages'
        AND column_name IN (
          'visual_design', 'content_structure', 'ctas_extracted',
          'last_modified_date', 'sitemap_priority', 'sitemap_changefreq'
        )
      ORDER BY column_name;
    `);
    
    console.log(`📊 website_pages columns: ${websitePagesColumns.rows.length}/6`);
    websitePagesColumns.rows.forEach(col => {
      console.log(`   ✅ ${col.column_name} (${col.data_type})`);
    });
    
    const ctaAnalysisColumns = await db.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'cta_analysis'
        AND column_name IN ('scraped_at', 'page_type', 'analysis_source')
      ORDER BY column_name;
    `);
    
    console.log(`\n📊 cta_analysis columns: ${ctaAnalysisColumns.rows.length}/3`);
    ctaAnalysisColumns.rows.forEach(col => {
      console.log(`   ✅ ${col.column_name} (${col.data_type})`);
    });
    
    if (websitePagesColumns.rows.length >= 6 && ctaAnalysisColumns.rows.length >= 3) {
      console.log('\n🚀 All required columns exist - ready for enhanced storage!');
    } else {
      console.log('\n⚠️  Some required columns are missing');
    }
    
  } catch (error) {
    console.error('❌ Schema update failed:', error.message);
  } finally {
    // Close database connection properly
    process.exit(0);
  }
}

// Run the schema update
runSimpleSchemaUpdate();