/**
 * Vitest setup: load .env.test when NODE_ENV=test so integration tests
 * can use DATABASE_URL (and other test config) without overriding CI env.
 * Verifies DB connectivity when DATABASE_URL is set; integration tests
 * skip when the database cannot be reached (e.g. wrong role, connection refused).
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envTest = join(__dirname, '..', '.env.test');

if (process.env.NODE_ENV === 'test') {
  if (existsSync(envTest)) {
    dotenv.config({ path: envTest });
  }
  // Integration tests use real DB; ensure auth uses database when DATABASE_URL is set
  if (process.env.DATABASE_URL && !process.env.USE_DATABASE) {
    process.env.USE_DATABASE = 'true';
  }
}

// Verify DB connectivity for integration tests; skip them if DB is unreachable
if (process.env.NODE_ENV === 'test' && process.env.DATABASE_URL) {
  try {
    const { default: db } = await import('../services/database.js');
    await db.query('SELECT 1');
    process.env.__DB_CONNECTED = 'true';
  } catch (e) {
    process.env.__DB_CONNECTED = 'false';
    // eslint-disable-next-line no-console
    console.warn('⚠️ Integration tests skipped: database connection failed:', e.message);
  }
}
