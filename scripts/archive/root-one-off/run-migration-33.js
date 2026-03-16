#!/usr/bin/env node
/**
 * Run Migration 033: Add narrative_stream column to jobs table.
 * Usage: node run-migration-33.js
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './services/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log('🚀 Running Migration 033: Add narrative_stream to jobs...\n');

  try {
    const migrationPath = path.join(__dirname, 'database', 'migrations', '033_add_jobs_narrative_stream.sql');
    const sql = await fs.readFile(migrationPath, 'utf8');
    await db.query(sql);
    console.log('✅ Migration 033 completed.');

    const cols = await db.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'narrative_stream'
    `);
    if (cols.rows.length > 0) {
      console.log('✅ narrative_stream column exists.');
    } else {
      console.warn('⚠️ narrative_stream column not found - check migration.');
    }
  } catch (e) {
    console.error('❌ Migration failed:', e.message);
    process.exit(1);
  } finally {
    await db.close?.();
  }
}

run();
