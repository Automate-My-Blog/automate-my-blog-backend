#!/usr/bin/env node

import fs from 'fs';
import db from './services/database.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function runSchemaUpdate() {
  console.log('🔧 RUNNING SCHEMA UPDATE');
  console.log('========================\n');
  
  try {
    // Read the schema file
    const schemaSQL = fs.readFileSync('./enhanced-content-analysis-schema.sql', 'utf8');
    
    // Split by semicolon and filter out empty statements
    const statements = schemaSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'))
      .filter(stmt => !stmt.match(/^\s*$/));
    
    console.log(`📜 Found ${statements.length} SQL statements to execute\n`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';'; // Add semicolon back
      
      try {
        console.log(`${i + 1}/${statements.length}: Executing statement...`);
        console.log(`   ${statement.substring(0, 60).replace(/\n/g, ' ')}...`);
        
        await db.query(statement);
        console.log(`   ✅ Success`);
        successCount++;
        
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('does not exist')) {
          console.log(`   ⚠️  Warning: ${error.message.split('\n')[0]}`);
        } else {
          console.log(`   ❌ Error: ${error.message.split('\n')[0]}`);
          errorCount++;
        }
      }
      
      console.log('');
    }
    
    console.log('🎉 SCHEMA UPDATE COMPLETE');
    console.log('=========================');
    console.log(`✅ Successful: ${successCount}`);
    console.log(`⚠️  Warnings/Skipped: ${statements.length - successCount - errorCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    
    // Verify the new columns exist
    console.log('\n🔍 VERIFYING NEW COLUMNS');
    console.log('=========================');
    
    const verifyQuery = `
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name IN ('website_pages', 'cta_analysis')
        AND column_name IN (
          'visual_design', 'content_structure', 'ctas_extracted',
          'last_modified_date', 'sitemap_priority', 'sitemap_changefreq',
          'page_type', 'analysis_source', 'scraped_at'
        )
      ORDER BY table_name, column_name;
    `;
    
    const verifyResult = await db.query(verifyQuery);
    
    console.log(`📊 Found ${verifyResult.rows.length} expected columns:`);
    verifyResult.rows.forEach(col => {
      console.log(`   ✅ ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
    });
    
    if (verifyResult.rows.length >= 8) {
      console.log('\n🚀 Schema update successful - ready for enhanced storage!');
    } else {
      console.log('\n⚠️  Some columns may be missing - check error messages above');
    }
    
  } catch (error) {
    console.error('❌ Schema update failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    await db.end();
  }
}

// Run the schema update
runSchemaUpdate()
  .then(() => {
    console.log('\n🔧 Schema update completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Schema update failed:', error.message);
    process.exit(1);
  });