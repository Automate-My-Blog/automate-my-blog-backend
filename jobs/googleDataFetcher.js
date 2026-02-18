import db from '../services/database.js';
import oauthManager from '../services/oauth-manager.js';
import googleTrendsService from '../services/google-trends.js';
import { GoogleSearchConsoleService } from '../services/google-search-console.js';
import { GoogleAnalyticsService } from '../services/google-analytics.js';

const googleSearchConsoleService = new GoogleSearchConsoleService();
const googleAnalyticsService = new GoogleAnalyticsService();

/**
 * Fetch Google Trends data for all users with active strategies
 */
export async function fetchTrendsDataForAllUsers() {
  console.log('📈 Fetching Google Trends data for all users...');

  try {
    // Get all active strategies with their keywords
    const query = `
      SELECT DISTINCT
        a.user_id,
        a.id as audience_id,
        a.customer_problem,
        COALESCE(
          (SELECT json_agg(keyword)
           FROM seo_keywords
           WHERE audience_id = a.id
           ORDER BY relevance_score DESC
           LIMIT 5),
          '[]'::json
        ) as top_keywords
      FROM audiences a
      WHERE a.user_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM seo_keywords
          WHERE audience_id = a.id
        )
    `;

    const result = await db.query(query);
    let fetched = 0;
    let errors = 0;

    console.log(`📊 Found ${result.rows.length} audiences with keywords`);

    for (const row of result.rows) {
      const keywords = row.top_keywords;

      for (const keyword of keywords) {
        try {
          // Fetch rising queries for this keyword
          const queries = await googleTrendsService.getRisingQueries(
            keyword,
            'US',
            '7d',
            row.user_id
          );

          if (queries.length > 0) {
            fetched++;
            console.log(`  ✅ Got ${queries.length} rising queries for "${keyword}"`);
          }

          // Rate limit: wait 2 seconds between requests to avoid throttling
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          errors++;
          console.error(`  ❌ Failed to fetch trends for "${keyword}":`, error.message);
        }
      }
    }

    console.log(`\n✅ Google Trends fetch complete: ${fetched} successful, ${errors} errors\n`);
    return { success: true, fetched, errors };
  } catch (error) {
    console.error('❌ Failed to fetch Google Trends data:', error);
    throw error;
  }
}

/**
 * Fetch Search Console data for all connected users
 */
export async function fetchSearchConsoleDataForAllUsers() {
  console.log('🔍 Fetching Search Console data for all connected users...');

  try {
    // Get all users with connected Search Console
    const query = `
      SELECT
        uoc.user_id,
        uoc.service_config->>'site_url' as site_url
      FROM user_oauth_credentials uoc
      WHERE uoc.service_name = 'google_search_console'
        AND uoc.status = 'active'
        AND uoc.service_config->>'site_url' IS NOT NULL
    `;

    const result = await db.query(query);
    let fetched = 0;
    let errors = 0;

    console.log(`📊 Found ${result.rows.length} users with Search Console connected`);

    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 28); // Last 28 days

    for (const row of result.rows) {
      try {
        // Get OAuth credentials
        const credentials = await oauthManager.getCredentials(
          row.user_id,
          'google_search_console'
        );

        if (!credentials) {
          console.log(`  ⚠️ No credentials found for user ${row.user_id}`);
          continue;
        }

        // Initialize auth and fetch data
        await googleSearchConsoleService.initializeAuth(credentials);
        const data = await googleSearchConsoleService.getTopQueries(
          row.site_url,
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0],
          100
        );

        if (data.queries && data.queries.length > 0) {
          // Cache the data
          await cacheSearchConsoleData(
            row.user_id,
            row.site_url,
            data.queries,
            startDate,
            endDate
          );
          fetched++;
          console.log(`  ✅ Cached ${data.queries.length} queries for ${row.site_url}`);
        }
      } catch (error) {
        errors++;
        console.error(`  ❌ Failed to fetch GSC for user ${row.user_id}:`, error.message);
      }
    }

    console.log(`\n✅ Search Console fetch complete: ${fetched} successful, ${errors} errors\n`);
    return { success: true, fetched, errors };
  } catch (error) {
    console.error('❌ Failed to fetch Search Console data:', error);
    throw error;
  }
}

/**
 * Fetch Analytics data for all connected users
 */
export async function fetchAnalyticsDataForAllUsers() {
  console.log('📊 Fetching Analytics data for all connected users...');

  try {
    // Get all users with connected Analytics
    const query = `
      SELECT
        uoc.user_id,
        uoc.service_config->>'property_id' as property_id
      FROM user_oauth_credentials uoc
      WHERE uoc.service_name = 'google_analytics'
        AND uoc.status = 'active'
        AND uoc.service_config->>'property_id' IS NOT NULL
    `;

    const result = await db.query(query);
    let fetched = 0;
    let errors = 0;

    console.log(`📊 Found ${result.rows.length} users with Analytics connected`);

    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 28); // Last 28 days

    for (const row of result.rows) {
      try {
        // Get OAuth credentials (Analytics uses service account, but we still check)
        const credentials = await oauthManager.getCredentials(
          row.user_id,
          'google_analytics'
        );

        if (!credentials) {
          console.log(`  ⚠️ No credentials found for user ${row.user_id}`);
          continue;
        }

        // Fetch traffic sources (aggregate data)
        const data = await googleAnalyticsService.getTrafficSources(
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0]
        );

        if (data.sources && data.sources.length > 0) {
          // Cache the data
          await cacheAnalyticsData(row.user_id, data.sources, startDate, endDate);
          fetched++;
          console.log(`  ✅ Cached analytics data for user ${row.user_id}`);
        }
      } catch (error) {
        errors++;
        console.error(`  ❌ Failed to fetch Analytics for user ${row.user_id}:`, error.message);
      }
    }

    console.log(`\n✅ Analytics fetch complete: ${fetched} successful, ${errors} errors\n`);
    return { success: true, fetched, errors };
  } catch (error) {
    console.error('❌ Failed to fetch Analytics data:', error);
    throw error;
  }
}

/**
 * Cache Search Console data
 * @param {string} userId - User ID
 * @param {string} siteUrl - Site URL
 * @param {Array} queries - Query data from GSC
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 */
async function cacheSearchConsoleData(userId, siteUrl, queries, startDate, endDate) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  const query = `
    INSERT INTO google_search_console_cache
      (user_id, site_url, top_queries, start_date, end_date, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT DO NOTHING
  `;

  await db.query(query, [
    userId,
    siteUrl,
    JSON.stringify(queries),
    startDate.toISOString().split('T')[0],
    endDate.toISOString().split('T')[0],
    expiresAt
  ]);
}

/**
 * Cache Analytics data
 * @param {string} userId - User ID
 * @param {Array} sources - Traffic source data
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 */
async function cacheAnalyticsData(userId, sources, startDate, endDate) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Calculate aggregate metrics
  const totalPageviews = sources.reduce((sum, s) => sum + (s.pageviews || 0), 0);
  const totalConversions = sources.reduce((sum, s) => sum + (s.conversions || 0), 0);

  const query = `
    INSERT INTO google_analytics_cache
      (user_id, page_url, pageviews, avg_session_duration, bounce_rate,
       conversions, start_date, end_date, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT DO NOTHING
  `;

  // Store aggregate data (page_url = null means aggregate)
  await db.query(query, [
    userId,
    null, // aggregate data
    totalPageviews,
    0, // Would need to calculate from raw data
    0, // Would need to calculate from raw data
    totalConversions,
    startDate.toISOString().split('T')[0],
    endDate.toISOString().split('T')[0],
    expiresAt
  ]);
}

/**
 * Master function to fetch all Google data
 */
export async function fetchAllGoogleData() {
  console.log('\n🚀 Starting comprehensive Google data fetch...\n');
  console.log('═══════════════════════════════════════════════════\n');

  const results = {
    trends: null,
    searchConsole: null,
    analytics: null,
    timestamp: new Date().toISOString()
  };

  // Fetch Google Trends
  try {
    results.trends = await fetchTrendsDataForAllUsers();
  } catch (error) {
    results.trends = { success: false, error: error.message };
  }

  // Fetch Search Console data
  try {
    results.searchConsole = await fetchSearchConsoleDataForAllUsers();
  } catch (error) {
    results.searchConsole = { success: false, error: error.message };
  }

  // Fetch Analytics data
  try {
    results.analytics = await fetchAnalyticsDataForAllUsers();
  } catch (error) {
    results.analytics = { success: false, error: error.message };
  }

  console.log('═══════════════════════════════════════════════════');
  console.log('✅ Google data fetch complete!\n');
  console.log('Summary:');
  console.log(`  • Trends: ${results.trends?.fetched || 0} fetched`);
  console.log(`  • Search Console: ${results.searchConsole?.fetched || 0} users`);
  console.log(`  • Analytics: ${results.analytics?.fetched || 0} users`);
  console.log('═══════════════════════════════════════════════════\n');

  return results;
}

export default {
  fetchAllGoogleData,
  fetchTrendsDataForAllUsers,
  fetchSearchConsoleDataForAllUsers,
  fetchAnalyticsDataForAllUsers
};
