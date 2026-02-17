/**
 * Content Calendar Service
 * Generates and persists 30-day content calendar for strategies on purchase (Issue #270).
 */

import db from './database.js';
import openaiService from './openai.js';

/** Progress phases for one strategy (for granular progress reporting). */
export const CONTENT_CALENDAR_PHASES = [
  'audience',
  'organization',
  'keywords',
  'generating',
  'saving'
];

const PHASE_MESSAGES = {
  audience: 'Loading audience...',
  organization: 'Loading organization context...',
  keywords: 'Loading SEO keywords...',
  generating: 'Generating 30-day ideas with AI...',
  saving: 'Saving calendar...'
};

/**
 * Report progress for a single phase.
 * @param {((opts: { phase: string, message: string, strategyIndex?: number, strategyTotal?: number, strategyId?: string }) => void)|undefined} onProgress
 * @param {string} phase - One of CONTENT_CALENDAR_PHASES
 * @param {number} [strategyIndex] - 0-based index of current strategy
 * @param {number} [strategyTotal] - Total number of strategies
 * @param {string} [strategyId] - Current strategy/audience id
 */
function reportProgress(onProgress, phase, strategyIndex, strategyTotal, strategyId) {
  if (typeof onProgress !== 'function') return;
  const message = PHASE_MESSAGES[phase] || phase;
  onProgress({ phase, message, strategyIndex, strategyTotal, strategyId });
}

/**
 * Generate and save 30-day content ideas for a strategy (audience).
 * @param {string} strategyId - audiences.id (strategy_id)
 * @param {{ onProgress?: (opts: { phase: string, message: string, strategyIndex?: number, strategyTotal?: number, strategyId?: string }) => void }} [opts] - Optional progress callback
 * @returns {Promise<{ strategyId: string, success: boolean, ideaCount?: number, error?: string }>}
 */
export async function generateAndSaveContentCalendar(strategyId, opts = {}) {
  const { onProgress } = opts;
  try {
    reportProgress(onProgress, 'audience', undefined, undefined, strategyId);
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

    reportProgress(onProgress, 'organization', undefined, undefined, strategyId);
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

    reportProgress(onProgress, 'keywords', undefined, undefined, strategyId);
    const keywordsResult = await db.query(
      `SELECT keyword, search_volume FROM seo_keywords WHERE audience_id = $1 ORDER BY relevance_score DESC NULLS LAST LIMIT 20`,
      [strategyId]
    );
    const seoKeywords = keywordsResult.rows.map((r) => ({ keyword: r.keyword, search_volume: r.search_volume }));

    reportProgress(onProgress, 'generating', undefined, undefined, strategyId);
    const ideas = await openaiService.generateContentCalendarIdeas(audience, orgContext, seoKeywords);

    reportProgress(onProgress, 'saving', undefined, undefined, strategyId);
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
 * @param {{ onProgress?: (opts: { phase: string, message: string, strategyIndex?: number, strategyTotal?: number, strategyId?: string }) => void }} [opts] - Optional progress callback (receives strategyIndex/strategyTotal in each call)
 * @returns {Promise<{ results: Array<{ strategyId: string, success: boolean, ideaCount?: number, error?: string }> }>}
 */
export async function generateContentCalendarsForStrategies(strategyIds, opts = {}) {
  const { onProgress } = opts;
  const total = strategyIds.length;
  const results = [];
  for (let i = 0; i < strategyIds.length; i++) {
    const id = strategyIds[i];
    const wrappedProgress = typeof onProgress === 'function'
      ? (p) => onProgress({ ...p, strategyIndex: i, strategyTotal: total, strategyId: id })
      : undefined;
    const r = await generateAndSaveContentCalendar(id, { onProgress: wrappedProgress });
    results.push(r);
  }
  return { results };
}

export default {
  generateAndSaveContentCalendar,
  generateContentCalendarsForStrategies
};
