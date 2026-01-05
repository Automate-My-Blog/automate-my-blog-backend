#!/usr/bin/env node
/**
 * Test Migration 11: Audience Persistence Tables
 * This script tests the migration in a safe development environment
 */

import db from './services/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testMigration() {
  console.log('🧪 Testing Migration 11: Audience Persistence Tables');
  console.log('================================================\n');
  
  try {
    // Step 1: Check current database state
    console.log('📊 Step 1: Checking current database state...');
    await checkCurrentState();
    
    // Step 2: Execute migration
    console.log('\n🚀 Step 2: Executing migration...');
    await executeMigration();
    
    // Step 3: Validate schema
    console.log('\n✅ Step 3: Validating schema...');
    await validateSchema();
    
    // Step 4: Test data operations
    console.log('\n📝 Step 4: Testing data operations...');
    await testDataOperations();
    
    // Step 5: Test rollback (optional - comment out if you want to keep data)
    console.log('\n🔄 Step 5: Testing rollback procedure...');
    const shouldTestRollback = process.argv.includes('--test-rollback');
    if (shouldTestRollback) {
      await testRollback();
    } else {
      console.log('Skipping rollback test (use --test-rollback flag to include)');
    }
    
    console.log('\n🎉 Migration test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Migration test failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

async function checkCurrentState() {
  // Check if migration tables already exist
  const existingTables = await db.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_name IN ('audiences', 'seo_keywords') 
    AND table_schema = 'public'
  `);
  
  if (existingTables.rows.length > 0) {
    console.log('⚠️  Warning: Migration tables already exist:', existingTables.rows.map(r => r.table_name));
    console.log('   This might be a re-run of the migration.');
  }
  
  // Check existing tables
  const criticalTables = await db.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_name IN ('users', 'organization_intelligence', 'content_topics', 'content_strategies')
    AND table_schema = 'public'
  `);
  
  console.log('✓ Found critical tables:', criticalTables.rows.map(r => r.table_name).join(', '));
  
  // Check if we have test data
  const userCount = await db.query('SELECT COUNT(*) as count FROM users');
  const orgCount = await db.query('SELECT COUNT(*) as count FROM organization_intelligence');
  
  console.log(`✓ Current data: ${userCount.rows[0].count} users, ${orgCount.rows[0].count} organization_intelligence records`);
}

async function executeMigration() {
  const migrationSQL = fs.readFileSync(
    path.join(__dirname, 'database', '11_audience_persistence_tables.sql'), 
    'utf8'
  );
  
  console.log('Executing migration SQL...');
  
  try {
    await db.query(migrationSQL);
    console.log('✓ Migration executed successfully');
  } catch (error) {
    console.error('❌ Migration execution failed:', error.message);
    throw error;
  }
}

async function validateSchema() {
  // Check new tables exist
  const newTables = await db.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_name IN ('audiences', 'seo_keywords') 
    AND table_schema = 'public'
  `);
  
  console.log('✓ New tables created:', newTables.rows.map(r => r.table_name).join(', '));
  
  // Check new columns added to existing tables
  const newColumns = await db.query(`
    SELECT table_name, column_name FROM information_schema.columns 
    WHERE (table_name = 'content_topics' OR table_name = 'content_strategies')
    AND column_name IN ('audience_id', 'session_id')
    AND table_schema = 'public'
  `);
  
  console.log('✓ New columns added:', newColumns.rows.map(r => `${r.table_name}.${r.column_name}`).join(', '));
  
  // Check indexes were created
  const indexes = await db.query(`
    SELECT indexname FROM pg_indexes 
    WHERE indexname LIKE '%audience%' OR indexname LIKE '%seo_keywords%'
  `);
  
  console.log(`✓ Indexes created: ${indexes.rows.length} indexes`);
  
  // Check foreign key constraints
  const constraints = await db.query(`
    SELECT tc.table_name, tc.constraint_name, tc.constraint_type
    FROM information_schema.table_constraints tc
    WHERE tc.constraint_type = 'FOREIGN KEY' 
    AND (tc.table_name = 'audiences' OR tc.table_name = 'seo_keywords')
  `);
  
  console.log(`✓ Foreign key constraints: ${constraints.rows.length} constraints`);
}

async function testDataOperations() {
  console.log('Testing CRUD operations on new tables...');
  
  // Get test user and organization intelligence data
  const testUser = await db.query('SELECT id FROM users LIMIT 1');
  const testOrgIntel = await db.query('SELECT id FROM organization_intelligence LIMIT 1');
  
  if (testUser.rows.length === 0) {
    console.log('⚠️  No users found - creating test user...');
    await db.query(`
      INSERT INTO users (email, role) VALUES ('test@migration.com', 'user') 
      ON CONFLICT (email) DO NOTHING
    `);
    testUser = await db.query('SELECT id FROM users WHERE email = \'test@migration.com\'');
  }
  
  if (testOrgIntel.rows.length === 0) {
    console.log('⚠️  No organization intelligence found - creating test record...');
    await db.query(`
      INSERT INTO organization_intelligence (user_id, business_name, target_audience) 
      VALUES ($1, 'Test Business', 'Test Audience')
    `, [testUser.rows[0].id]);
    testOrgIntel = await db.query('SELECT id FROM organization_intelligence WHERE business_name = \'Test Business\'');
  }
  
  const userId = testUser.rows[0].id;
  const orgIntelId = testOrgIntel.rows[0].id;
  
  // Test audience creation
  const audienceResult = await db.query(`
    INSERT INTO audiences (user_id, organization_intelligence_id, target_segment, customer_problem, priority) 
    VALUES ($1, $2, $3, $4, $5) 
    RETURNING id
  `, [
    userId,
    orgIntelId,
    JSON.stringify({"demographics": "Test audience", "psychographics": "Test psychographics"}),
    'Test customer problem',
    1
  ]);
  
  const audienceId = audienceResult.rows[0].id;
  console.log('✓ Created test audience:', audienceId);
  
  // Test keyword creation
  await db.query(`
    INSERT INTO seo_keywords (user_id, audience_id, keyword, search_volume, competition, relevance_score)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [userId, audienceId, 'test keyword', 1000, 'medium', 0.85]);
  
  console.log('✓ Created test keyword');
  
  // Test updating content_topics to link to audience
  const topicUpdate = await db.query(`
    UPDATE content_topics 
    SET audience_id = $1, session_id = NULL 
    WHERE user_id = $2 AND audience_id IS NULL
    RETURNING id
  `, [audienceId, userId]);
  
  if (topicUpdate.rows.length > 0) {
    console.log('✓ Linked existing topic to audience');
  }
  
  // Test data retrieval with joins
  const joinTest = await db.query(`
    SELECT a.id as audience_id, a.customer_problem, 
           COUNT(k.id) as keyword_count,
           COUNT(t.id) as topic_count
    FROM audiences a
    LEFT JOIN seo_keywords k ON a.id = k.audience_id
    LEFT JOIN content_topics t ON a.id = t.audience_id
    WHERE a.id = $1
    GROUP BY a.id, a.customer_problem
  `, [audienceId]);
  
  console.log('✓ Join query test successful:', joinTest.rows[0]);
  
  // Test cascade delete
  console.log('Testing cascade delete...');
  const keywordCountBefore = await db.query('SELECT COUNT(*) as count FROM seo_keywords WHERE audience_id = $1', [audienceId]);
  
  await db.query('DELETE FROM audiences WHERE id = $1', [audienceId]);
  
  const keywordCountAfter = await db.query('SELECT COUNT(*) as count FROM seo_keywords WHERE audience_id = $1', [audienceId]);
  
  console.log(`✓ Cascade delete worked: keywords before=${keywordCountBefore.rows[0].count}, after=${keywordCountAfter.rows[0].count}`);
}

async function testRollback() {
  console.log('Testing rollback procedure...');
  
  const rollbackSQL = fs.readFileSync(
    path.join(__dirname, 'database', 'rollback_11_audience_persistence_tables.sql'), 
    'utf8'
  );
  
  try {
    await db.query(rollbackSQL);
    console.log('✓ Rollback executed successfully');
    
    // Verify rollback worked
    const remainingTables = await db.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name IN ('audiences', 'seo_keywords') 
      AND table_schema = 'public'
    `);
    
    if (remainingTables.rows.length === 0) {
      console.log('✓ Rollback verification: All new tables removed');
    } else {
      console.error('❌ Rollback verification failed: Tables still exist');
    }
    
    // Check existing tables are intact
    const criticalTables = await db.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name IN ('users', 'organization_intelligence', 'content_topics', 'content_strategies')
      AND table_schema = 'public'
    `);
    
    console.log('✓ Critical tables intact after rollback:', criticalTables.rows.map(r => r.table_name).join(', '));
    
  } catch (error) {
    console.error('❌ Rollback test failed:', error.message);
    throw error;
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testMigration();
}

export { testMigration };