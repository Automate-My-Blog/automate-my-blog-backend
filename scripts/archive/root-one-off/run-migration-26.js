import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './services/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  console.log('🚀 Running Migration 26: Jobs table...\n');

  try {
    const connected = await db.testConnection?.();
    if (!connected) {
      console.error('❌ Cannot connect to database. Check DATABASE_URL in .env');
      process.exit(1);
    }
    console.log('✅ Database connection OK');

    console.log('\n2️⃣ Checking if jobs table exists...');
    const exist = await db.query(`
      SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'jobs'
    `);
    if (exist.rows.length > 0) {
      console.log('✅ Jobs table already exists, skipping.');
      return;
    }

    console.log('\n3️⃣ Running migration 26...');
    const migrationPath = path.join(__dirname, 'database', '26_jobs_table.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf8');
    await db.query(migrationSQL);
    console.log('✅ Migration 26 completed.');

    const verify = await db.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs' ORDER BY ordinal_position
    `);
    console.log('✅ Columns:', verify.rows.map((r) => r.column_name).join(', '));
  } catch (e) {
    console.error('❌ Migration failed:', e.message);
    process.exit(1);
  } finally {
    await db.close?.();
  }
}

runMigration();
