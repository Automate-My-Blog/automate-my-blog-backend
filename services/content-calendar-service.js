/**
 * Content Calendar Service
 * Generates and persists 30-day content calendar for strategies on purchase (Issue #270).
 */

import db from './database.js';
import openaiService from './openai.js';

/**
 * Generate and save 30-day content ideas for a strategy (audience).
 * @param {string} strategyId - audiences.id (strategy_id)
 * @returns {Promise<{ strategyId: string, success: boolean, ideaCount?: number, error?: string }>}
 */
export async function generateAndSaveContentCalendar(strategyId) {
  try {
    const audienceResult = await db.query(
      `SELECT a.id, a.target_segment, a.customer_problem, a.business_value, a.conversion_path,
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

    const ideas = await openaiService.generateContentCalendarIdeas(audience, orgContext, seoKeywords);

    await db.query(
      `UPDATE audiences SET content_ideas = $1, content_calendar_generated_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(ideas), strategyId]
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
 * @returns {Promise<{ results: Array<{ strategyId: string, success: boolean, ideaCount?: number, error?: string }> }>}
 */
export async function generateContentCalendarsForStrategies(strategyIds) {
  const results = [];
  for (const id of strategyIds) {
    const r = await generateAndSaveContentCalendar(id);
    results.push(r);
  }
  return { results };
}

export default {
  generateAndSaveContentCalendar,
  generateContentCalendarsForStrategies
};
