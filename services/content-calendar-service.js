/**
 * Content Calendar Service
 * Generates and persists 30-day content calendar for strategies on purchase (Issue #270).
 * When the user has strategies with keywords (Google Trends "connected"), we run a one-time
 * trends fetch before generation so the calendar is informed by fresh trending data.
 */

import db from './database.js';

/** Phases used by job-worker for progress reporting (order must match generateAndSaveContentCalendar flow). */
export const CONTENT_CALENDAR_PHASES = Object.freeze([
  'audience',
  'organization',
  'keywords',
  'generating',
  'saving'
]);
import openaiService from './openai.js';
import googleContentOptimizer from './google-content-optimizer.js';
import googleTrendsService from './google-trends.js';

/** Delay between Google Trends API calls to avoid rate limits (ms). */
const TRENDS_FETCH_DELAY_MS = 2000;

/** Max keywords to fetch trends for before generating calendar (keeps job time bounded). */
const MAX_TRENDS_KEYWORDS = 10;

/**
 * Run a one-time Google Trends fetch for the user's strategy keywords and populate cache.
 * Call this before generating the content calendar so getTrendingTopicsForUser returns fresh data.
 * Only runs when strategies have seo_keywords; safe to call when they don't.
 *
 * @param {string} userId - User ID (for cache ownership)
 * @param {string[]} strategyIds - Audience/strategy IDs to collect keywords from
 * @returns {Promise<{ fetched: number, keywordCount: number, errorCount: number }>}
 */
export async function fetchTrendsForContentCalendar(userId, strategyIds) {
  if (!userId || !Array.isArray(strategyIds) || strategyIds.length === 0) {
    return { fetched: 0, keywordCount: 0, errorCount: 0 };
  }

  try {
    const keywordsResult = await db.query(
      `SELECT sk.keyword
       FROM seo_keywords sk
       WHERE sk.audience_id = ANY($1::uuid[])
       ORDER BY sk.relevance_score DESC NULLS LAST
       LIMIT $2`,
      [strategyIds, MAX_TRENDS_KEYWORDS * 2]
    );

    const seen = new Set();
    const keywords = (keywordsResult.rows || [])
      .map((r) => r.keyword?.trim())
      .filter((k) => k && !seen.has(k) && (seen.add(k), true))
      .slice(0, MAX_TRENDS_KEYWORDS);
    if (keywords.length === 0) {
      return { fetched: 0, keywordCount: 0, errorCount: 0 };
    }

    let fetched = 0;
    let errorCount = 0;

    for (const keyword of keywords) {
      try {
        const queries = await googleTrendsService.getRisingQueries(keyword, 'US', '7d', userId);
        if (queries.length > 0) fetched++;
        await new Promise((r) => setTimeout(r, TRENDS_FETCH_DELAY_MS));
      } catch (err) {
        errorCount++;
        console.warn(`Trends fetch for "${keyword}" failed:`, err.message);
        await new Promise((r) => setTimeout(r, TRENDS_FETCH_DELAY_MS));
      }
    }

    console.log(`📈 Content calendar: one-time trends fetch for ${keywords.length} keywords → ${fetched} cached, ${errorCount} errors`);
    return { fetched, keywordCount: keywords.length, errorCount };
  } catch (error) {
    console.error('⚠️ fetchTrendsForContentCalendar failed:', error.message);
    return { fetched: 0, keywordCount: 0, errorCount: 0 };
  }
}

/**
 * Generate and save 30-day content ideas for a strategy (audience).
 * When userId is provided (e.g. from job worker), verifies the audience belongs to that user.
 * Only persists when ideas.length >= 1 so the frontend does not see "ready" with an empty calendar.
 *
 * @param {string} strategyId - audiences.id (strategy_id)
 * @param {string} [userId] - If set, audience must belong to this user (production hardening)
 * @returns {Promise<{ strategyId: string, success: boolean, ideaCount?: number, error?: string }>}
 */
export async function generateAndSaveContentCalendar(strategyId, userId = null) {
  try {
    const audienceResult = await db.query(
      `SELECT a.id, a.user_id, a.target_segment, a.customer_problem, a.business_value, a.conversion_path,
              a.organization_intelligence_id, oi.organization_id
       FROM audiences a
       LEFT JOIN organization_intelligence oi ON oi.id = a.organization_intelligence_id AND oi.is_current = TRUE
       WHERE a.id = $1`,
      [strategyId]
    );

    if (!audienceResult.rows.length) {
      return { strategyId, success: false, error: 'Audience not found' };
    }

    const audience = audienceResult.rows[0];
    if (userId != null && String(audience.user_id) !== String(userId)) {
      return { strategyId, success: false, error: 'Audience does not belong to job user' };
    }
    let orgContext = {};

    if (audience.organization_id) {
      const orgResult = await db.query(
        `SELECT o.business_type, o.target_audience, o.description, o.brand_voice
         FROM organizations o
         WHERE o.id = $1`,
        [audience.organization_id]
      );
      const org = orgResult.rows[0];
      if (org) {
        orgContext = {
          businessType: org.business_type || 'Business',
          targetAudience: org.target_audience || 'General',
          contentFocus: org.description || org.target_audience || 'Customer solutions',
          brandVoice: org.brand_voice
        };
      }
    }

    const keywordsResult = await db.query(
      `SELECT keyword, search_volume FROM seo_keywords WHERE audience_id = $1 ORDER BY relevance_score DESC NULLS LAST LIMIT 20`,
      [strategyId]
    );
    const seoKeywords = keywordsResult.rows.map((r) => ({ keyword: r.keyword, search_volume: r.search_volume }));

    // Fetch Google data to inform content strategy
    let googleData = null;
    try {
      // Get user_id from audience
      const userResult = await db.query(`SELECT user_id FROM audiences WHERE id = $1`, [strategyId]);
      const userId = userResult.rows[0]?.user_id;

      if (userId) {
        const [trending, opportunities] = await Promise.all([
          googleContentOptimizer.getTrendingTopicsForUser(userId, 10),
          googleContentOptimizer.getContentOpportunities(userId, 10)
        ]);

        googleData = {
          trending: trending.slice(0, 5), // Top 5 trending topics
          opportunities: opportunities.slice(0, 5) // Top 5 opportunities
        };

        console.log(`📊 Fetched Google data for calendar: ${trending.length} trends, ${opportunities.length} opportunities`);
      }
    } catch (error) {
      console.error('⚠️ Failed to fetch Google data for calendar:', error.message);
      // Continue without Google data
    }

    const ideas = await openaiService.generateContentCalendarIdeas(audience, orgContext, seoKeywords, googleData);

    if (!Array.isArray(ideas) || ideas.length < 1) {
      console.warn(`Content calendar produced no ideas for strategy ${strategyId}, not persisting`);
      return { strategyId, success: false, error: 'No ideas generated' };
    }

    const trendingSnapshot = googleData?.trending?.length
      ? googleData.trending.map((t) => ({ query: t.query, value: t.value }))
      : null;

    await db.query(
      `UPDATE audiences SET content_ideas = $1, content_calendar_generated_at = NOW(),
       content_calendar_trending_topics = $2, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(ideas), trendingSnapshot ? JSON.stringify(trendingSnapshot) : null, strategyId]
    );

    console.log(`✅ Content calendar generated for strategy ${strategyId}: ${ideas.length} ideas`);
    return { strategyId, success: true, ideaCount: ideas.length };
  } catch (error) {
    console.error(`❌ Content calendar generation failed for ${strategyId}:`, error.message);
    return { strategyId, success: false, error: error.message };
  }
}

/**
 * Generate calendars for multiple strategies. Continues on per-strategy failure.
 * @param {string[]} strategyIds
 * @param {{ userId?: string }} [options] - userId from job context; used to verify audience ownership
 * @returns {Promise<{ results: Array<{ strategyId: string, success: boolean, ideaCount?: number, error?: string }> }>}
 */
export async function generateContentCalendarsForStrategies(strategyIds, options = {}) {
  const userId = options.userId ?? null;
  const results = [];
  for (const id of strategyIds) {
    const r = await generateAndSaveContentCalendar(id, userId);
    results.push(r);
  }
  return { results };
}

export default {
  fetchTrendsForContentCalendar,
  generateAndSaveContentCalendar,
  generateContentCalendarsForStrategies
};
