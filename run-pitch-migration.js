#!/usr/bin/env node

import fs from 'fs';
import db from './services/database.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function runPitchMigration() {
  console.log('🔧 RUNNING PITCH COLUMN MIGRATION');
  console.log('==================================\n');

  try {
    // Read the migration file
    const migrationSQL = fs.readFileSync('./database/18_add_pitch_to_audiences.sql', 'utf8');

    console.log('📜 Migration SQL:');
    console.log(migrationSQL);
    console.log('\n🚀 Executing migration...\n');

    // Execute the migration
    await db.query(migrationSQL);

    console.log('✅ Migration executed successfully!\n');

    // Verify the pitch column exists
    console.log('🔍 VERIFYING PITCH COLUMN');
    console.log('=========================');

    const verifyQuery = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'audiences'
        AND column_name = 'pitch';
    `;

    const verifyResult = await db.query(verifyQuery);

    if (verifyResult.rows.length > 0) {
      const col = verifyResult.rows[0];
      console.log(`✅ pitch column created successfully:`);
      console.log(`   Type: ${col.data_type}`);
      console.log(`   Nullable: ${col.is_nullable}`);
      console.log('\n🎉 Migration completed successfully!');
    } else {
      console.log('❌ pitch column not found - migration may have failed');
    }

  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log('⚠️  pitch column already exists - migration already applied');
    } else {
      console.error('❌ Migration failed:', error.message);
      console.error('Stack trace:', error.stack);
      throw error;
    }
  } finally {
    await db.end();
  }
}

// Run the migration
runPitchMigration()
  .then(() => {
    console.log('\n✅ Migration process completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error.message);
    process.exit(1);
  });
