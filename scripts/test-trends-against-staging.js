#!/usr/bin/env node
/**
 * Test trends flow locally against staging DB.
 * Ensures fetchTrendsForContentCalendar + getTrendingTopicsForUser return data
 * (using staging data so we know it will work after deploy).
 *
 * Usage:
 *   # Use .env DATABASE_URL (must be staging connection string)
 *   node scripts/test-trends-against-staging.js <userId>
 *
 *   # Override with staging URL explicitly
 *   STAGING_DATABASE_URL="postgresql://..." node scripts/test-trends-against-staging.js <userId>
 *
 * Get userId from a staging JWT (decode the payload; userId is in the "userId" claim).
 * Example: 16f76bcf-7dac-4b57-8b1b-18ffd60d5975
 *
 * Note: STAGING_DATABASE_URL must be a reachable Postgres URL (e.g. from Vercel Preview
 * env or Neon staging branch). Local DB or unreachable URL will cause connection errors.
 */
import 'dotenv/config';

const userId = process.argv[2] || process.env.USER_ID;
if (!userId) {
  console.error('Usage: node scripts/test-trends-against-staging.js <userId>');
  console.error('   or: USER_ID=xxx node scripts/test-trends-against-staging.js');
  process.exit(1);
}

if (process.env.STAGING_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.STAGING_DATABASE_URL;
  console.log('Using STAGING_DATABASE_URL for this run.');
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL or STAGING_DATABASE_URL is required.');
  process.exit(1);
}

async function main() {
  console.log('\n--- Trends flow test (local code + staging DB) ---');
  console.log('UserId:', userId);

  const { fetchTrendsForContentCalendar } = await import('../services/content-calendar-service.js');
  const googleContentOptimizer = (await import('../services/google-content-optimizer.js')).default;

  console.log('\n1. Running fetchTrendsForContentCalendar(userId, []) to prime cache (default keywords)...');
  const result = await fetchTrendsForContentCalendar(userId, []);
  console.log('   Result:', result);

  console.log('\n2. Reading getTrendingTopicsForUser(userId, 20)...');
  const data = await googleContentOptimizer.getTrendingTopicsForUser(String(userId), 20);
  console.log('   Topics count:', data.length);
  if (data.length > 0) {
    console.log('   First 3 topics:', data.slice(0, 3).map((t) => ({ query: t.query, value: t.value, keyword: t.keyword })));
  }

  console.log('\n--- Done ---');
  if (data.length === 0) {
    console.error('FAIL: No topics returned. Check staging DB has google_trends_cache or that Trends API returned data.');
    process.exit(1);
  }
  console.log('OK: Topics returned. Flow works against staging.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
