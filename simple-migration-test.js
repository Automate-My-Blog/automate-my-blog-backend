#!/usr/bin/env node
/**
 * Simple Migration Test 11: Audience Persistence Tables
 */

import db from './services/database.js';

async function simpleMigrationTest() {
  console.log('🧪 Simple Migration Test 11');
  console.log('============================\n');
  
  try {
    // Test connection
    console.log('1️⃣ Testing database connection...');
    const result = await db.query('SELECT NOW() as current_time');
    console.log('✅ Connection successful:', result.rows[0].current_time);
    
    // Check for existing tables
    console.log('\n2️⃣ Checking for existing audience tables...');
    const existingTables = await db.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name IN ('audiences', 'seo_keywords') 
      AND table_schema = 'public'
    `);
    
    if (existingTables.rows.length > 0) {
      console.log('⚠️  Tables already exist:', existingTables.rows.map(r => r.table_name));
      console.log('Skipping migration - tables already created');
      return;
    }
    
    console.log('✅ No existing audience tables found - ready for migration');
    
    // Check required tables
    console.log('\n3️⃣ Checking required tables...');
    const requiredTables = await db.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name IN ('users', 'organization_intelligence', 'content_topics', 'content_strategies')
      AND table_schema = 'public'
    `);
    
    const foundTables = requiredTables.rows.map(r => r.table_name);
    console.log('✅ Found required tables:', foundTables.join(', '));
    
    if (foundTables.length < 4) {
      console.log('❌ Missing required tables - cannot proceed with migration');
      return;
    }
    
    console.log('\n✅ All tests passed - ready for migration execution');
    console.log('💡 To run the full migration, execute: node test-migration-11.js');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  } finally {
    await db.close();
  }
}

// Run the test
simpleMigrationTest();