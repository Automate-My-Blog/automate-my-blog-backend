/**
 * Vitest setup: load .env.test when NODE_ENV=test so integration tests
 * can use DATABASE_URL (and other test config) without overriding CI env.
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
