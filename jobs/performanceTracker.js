import db from '../services/database.js';
import oauthManager from '../services/oauth-manager.js';
import { GoogleSearchConsoleService } from '../services/google-search-console.js';
import { GoogleAnalyticsService } from '../services/google-analytics.js';

const googleSearchConsoleService = new GoogleSearchConsoleService();
const googleAnalyticsService = new GoogleAnalyticsService();

/**
 * Track performance of published blog posts
 * Fetches metrics from Google Search Console and Analytics
 * Calculates performance scores and updates content_performance table
 */
export async function trackContentPerformance() {
  console.log('📈 Starting content performance tracking...\n');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    // Get all published blog posts from last 90 days
    const query = `
      SELECT
        bp.id,
        bp.title,
        bp.published_url,
        bp.user_id,
        bp.created_at,
        cp.id as performance_id
      FROM blog_posts bp
      LEFT JOIN content_performance cp ON bp.id = cp.blog_post_id
      WHERE bp.status = 'published'
        AND bp.published_url IS NOT NULL
        AND bp.created_at >= NOW() - INTERVAL '90 days'
      ORDER BY bp.created_at DESC
    `;

    const result = await db.query(query);
    const posts = result.rows;

    if (posts.length === 0) {
      console.log('⚠️ No published posts found to track');
      return { success: true, tracked: 0, errors: 0 };
    }

    console.log(`📊 Found ${posts.length} published posts to track\n`);

    let tracked = 0;
    let errors = 0;

    for (const post of posts) {
      try {
        console.log(`\n📝 Tracking: "${post.title}"`);
        console.log(`   URL: ${post.published_url}`);

        // Get Search Console metrics
        const gscCredentials = await oauthManager.getCredentials(
          post.user_id,
          'google_search_console'
        );

        let gscMetrics = null;
        if (gscCredentials && gscCredentials.service_config?.site_url) {
          try {
            await googleSearchConsoleService.initializeAuth(gscCredentials);

            // Get page performance for last 28 days
            const endDate = new Date();
            const startDate = new Date(endDate);
            startDate.setDate(startDate.getDate() - 28);

            const gscData = await googleSearchConsoleService.getPagePerformance(
              gscCredentials.service_config.site_url,
              post.published_url,
              startDate.toISOString().split('T')[0],
              endDate.toISOString().split('T')[0]
            );

            if (gscData && gscData.data) {
              gscMetrics = gscData.data;
              console.log(`   ✅ GSC: ${gscMetrics.clicks} clicks, ${gscMetrics.impressions} impressions, position ${gscMetrics.position?.toFixed(1)}`);
            } else {
              console.log('   ⚠️ GSC: No data available');
            }
          } catch (error) {
            console.log(`   ⚠️ GSC: ${error.message}`);
          }
        } else {
          console.log('   ⚠️ GSC: Not connected');
        }

        // Get Analytics metrics
        const gaCredentials = await oauthManager.getCredentials(
          post.user_id,
          'google_analytics'
        );

        let gaMetrics = null;
        if (gaCredentials) {
          try {
            const endDate = new Date();
            const startDate = new Date(endDate);
            startDate.setDate(startDate.getDate() - 28);

            // Extract page path from URL
            const url = new URL(post.published_url);
            const pagePath = url.pathname;

            const gaData = await googleAnalyticsService.getPagePerformance(
              pagePath,
              startDate.toISOString().split('T')[0],
              endDate.toISOString().split('T')[0]
            );

            if (gaData && !gaData.error) {
              gaMetrics = gaData;
              console.log(`   ✅ GA: ${gaMetrics.pageviews} pageviews, ${gaMetrics.conversions} conversions`);
            } else {
              console.log('   ⚠️ GA: No data available');
            }
          } catch (error) {
            console.log(`   ⚠️ GA: ${error.message}`);
          }
        } else {
          console.log('   ⚠️ GA: Not connected');
        }

        // Calculate performance score
        const performanceScore = calculatePerformanceScore(gscMetrics, gaMetrics);
        console.log(`   🎯 Performance Score: ${performanceScore}/100`);

        // Upsert to content_performance table
        if (post.performance_id) {
          // Update existing
          await db.query(
            `UPDATE content_performance
            SET gsc_clicks = $1,
                gsc_impressions = $2,
                gsc_ctr = $3,
                gsc_avg_position = $4,
                ga_pageviews = $5,
                ga_conversions = $6,
                performance_score = $7,
                last_tracked_at = NOW(),
                updated_at = NOW()
            WHERE id = $8`,
            [
              gscMetrics?.clicks || 0,
              gscMetrics?.impressions || 0,
              gscMetrics?.ctr || 0,
              gscMetrics?.position || null,
              gaMetrics?.pageviews || 0,
              gaMetrics?.conversions || 0,
              performanceScore,
              post.performance_id
            ]
          );
        } else {
          // Create new
          await db.query(
            `INSERT INTO content_performance
              (blog_post_id, user_id, gsc_clicks, gsc_impressions, gsc_ctr, gsc_avg_position,
               ga_pageviews, ga_conversions, performance_score)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              post.id,
              post.user_id,
              gscMetrics?.clicks || 0,
              gscMetrics?.impressions || 0,
              gscMetrics?.ctr || 0,
              gscMetrics?.position || null,
              gaMetrics?.pageviews || 0,
              gaMetrics?.conversions || 0,
              performanceScore
            ]
          );
        }

        tracked++;
      } catch (error) {
        errors++;
        console.error(`   ❌ Failed to track post ${post.id}:`, error.message);
      }
    }

    console.log('\n═══════════════════════════════════════════════════');
    console.log('✅ Content performance tracking complete!\n');
    console.log(`Summary:`);
    console.log(`  • Total posts: ${posts.length}`);
    console.log(`  • Successfully tracked: ${tracked}`);
    console.log(`  • Errors: ${errors}`);
    console.log('═══════════════════════════════════════════════════\n');

    return { success: true, tracked, errors };
  } catch (error) {
    console.error('❌ Failed to track content performance:', error);
    throw error;
  }
}

/**
 * Calculate composite performance score (0-100)
 * Based on Search Console and Analytics metrics
 * @param {Object} gscMetrics - Google Search Console metrics
 * @param {Object} gaMetrics - Google Analytics metrics
 * @returns {number} Performance score 0-100
 */
function calculatePerformanceScore(gscMetrics, gaMetrics) {
  let score = 0;

  // Search Console scoring (50 points max)
  if (gscMetrics) {
    // CTR score (20 points)
    // 10% CTR = 20 points, scales linearly
    if (gscMetrics.ctr) {
      score += Math.min(gscMetrics.ctr * 200, 20);
    }

    // Position score (20 points)
    // Position 1 = 20 points, Position 10 = 0 points, scales linearly
    if (gscMetrics.position) {
      const positionScore = Math.max(20 - (gscMetrics.position - 1) * 2.22, 0);
      score += positionScore;
    }

    // Clicks score (10 points)
    // 100 clicks = 10 points, scales linearly
    if (gscMetrics.clicks) {
      score += Math.min(gscMetrics.clicks / 10, 10);
    }
  }

  // Analytics scoring (50 points max)
  if (gaMetrics) {
    // Pageviews score (20 points)
    // 1000 pageviews = 20 points, scales linearly
    if (gaMetrics.pageviews) {
      score += Math.min(gaMetrics.pageviews / 50, 20);
    }

    // Conversions score (30 points)
    // 10 conversions = 30 points, scales linearly
    if (gaMetrics.conversions) {
      score += Math.min(gaMetrics.conversions * 3, 30);
    }
  }

  // Round and cap at 100
  return Math.round(Math.min(score, 100));
}

/**
 * Get performance insights for a user
 * Returns top and bottom performing content
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Performance insights
 */
export async function getPerformanceInsights(userId) {
  try {
    // Get top performing content
    const topQuery = `
      SELECT
        bp.id,
        bp.title,
        bp.published_url,
        cp.performance_score,
        cp.gsc_clicks,
        cp.gsc_impressions,
        cp.gsc_avg_position,
        cp.ga_pageviews,
        cp.ga_conversions
      FROM content_performance cp
      INNER JOIN blog_posts bp ON cp.blog_post_id = bp.id
      WHERE cp.user_id = $1
        AND cp.performance_score > 0
      ORDER BY cp.performance_score DESC
      LIMIT 5
    `;

    const topResult = await db.query(topQuery, [userId]);

    // Get bottom performing content (needs improvement)
    const bottomQuery = `
      SELECT
        bp.id,
        bp.title,
        bp.published_url,
        cp.performance_score,
        cp.gsc_clicks,
        cp.gsc_impressions,
        cp.gsc_avg_position,
        cp.ga_pageviews,
        cp.ga_conversions
      FROM content_performance cp
      INNER JOIN blog_posts bp ON cp.blog_post_id = bp.id
      WHERE cp.user_id = $1
        AND cp.performance_score > 0
        AND cp.performance_score < 60
      ORDER BY cp.performance_score ASC
      LIMIT 5
    `;

    const bottomResult = await db.query(bottomQuery, [userId]);

    return {
      topPerformers: topResult.rows,
      needsImprovement: bottomResult.rows,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ Error getting performance insights:', error.message);
    return {
      topPerformers: [],
      needsImprovement: [],
      error: error.message
    };
  }
}

export default {
  trackContentPerformance,
  getPerformanceInsights
};
