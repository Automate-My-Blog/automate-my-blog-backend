/**
 * Website analysis persistence: organization resolution, intelligence storage, and CTA storage.
 * Encapsulates the priority-based org lookup (user-owned → adopt anonymous by URL → new;
 * anonymous by URL → new) and all related DB writes so the analyze-website handler stays thin.
 *
 * Business rules (invariants):
 * - At least one of userId or sessionId must be provided to persist.
 * - Organization resolution: authenticated user → existing by owner_user_id, else anonymous by URL to adopt, else new; anonymous → by website_url and owner_user_id IS NULL, else new.
 * - Intelligence: one current record per organization (or session); previous marked is_current = FALSE on update.
 */

import { v4 as uuidv4 } from 'uuid';
import { normalizeCTA } from '../utils/cta-normalizer.js';

/**
 * Resolve which organization to use for this analysis (no DB writes).
 * @param {object} db - Database service with .query()
 * @param {{ userId: string | null, sessionId: string | null, url: string }} params
 * @returns {Promise<{ existingOrganization: object | null, organizationSource: string, shouldAdoptAnonymousOrg: boolean }>}
 */
export async function resolveOrganization(db, { userId, sessionId, url }) {
  let existingOrganization = null;
  let organizationSource = null;
  let shouldAdoptAnonymousOrg = false;

  if (userId) {
    const userOrgResult = await db.query(
      'SELECT id, website_url FROM organizations WHERE owner_user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    if (userOrgResult.rows.length > 0) {
      existingOrganization = userOrgResult.rows[0];
      organizationSource = 'user_owned';
    } else {
      const anonymousOrgResult = await db.query(
        'SELECT id, website_url FROM organizations WHERE website_url = $1 AND owner_user_id IS NULL ORDER BY created_at DESC LIMIT 1',
        [url]
      );
      if (anonymousOrgResult.rows.length > 0) {
        existingOrganization = anonymousOrgResult.rows[0];
        organizationSource = 'anonymous_adoption';
        shouldAdoptAnonymousOrg = true;
      } else {
        organizationSource = 'new_for_user';
      }
    }
  } else {
    const urlOrgResult = await db.query(
      'SELECT id, website_url FROM organizations WHERE website_url = $1 AND owner_user_id IS NULL ORDER BY created_at DESC LIMIT 1',
      [url]
    );
    if (urlOrgResult.rows.length > 0) {
      existingOrganization = urlOrgResult.rows[0];
      organizationSource = 'anonymous_session';
    } else {
      organizationSource = 'new_anonymous';
    }
  }

  return { existingOrganization, organizationSource, shouldAdoptAnonymousOrg };
}

/**
 * Build organization and intelligence payloads from analysis and url.
 * @param {object} analysis - OpenAI analysis result
 * @param {string} url - Website URL
 * @returns {{ organizationData: object, intelligenceData: object, organizationName: string }}
 */
export function buildOrganizationAndIntelligenceData(analysis, url) {
  const organizationName = analysis?.businessName || analysis?.companyName || new URL(url).hostname;
  const now = new Date();

  const organizationData = {
    name: organizationName,
    website_url: url,
    business_type: analysis?.businessType,
    industry_category: analysis?.industryCategory,
    business_model: analysis?.businessModel,
    company_size: analysis?.companySize,
    description: analysis?.description,
    target_audience: analysis?.targetAudience,
    brand_voice: analysis?.brandVoice,
    website_goals: analysis?.websiteGoals,
    last_analyzed_at: now
  };

  const intelligenceData = {
    customer_scenarios: analysis?.customerScenarios ? JSON.stringify(analysis.customerScenarios) : null,
    business_value_assessment: analysis?.businessValueAssessment ? JSON.stringify(analysis.businessValueAssessment) : null,
    customer_language_patterns: analysis?.customerLanguagePatterns ? JSON.stringify(analysis.customerLanguagePatterns) : null,
    search_behavior_insights: analysis?.searchBehaviorInsights ? JSON.stringify(analysis.searchBehaviorInsights) : null,
    seo_opportunities: analysis?.seoOpportunities ? JSON.stringify(analysis.seoOpportunities) : null,
    content_strategy_recommendations: analysis?.contentStrategyRecommendations ? JSON.stringify(analysis.contentStrategyRecommendations) : null,
    competitive_intelligence: analysis?.competitiveIntelligence ? JSON.stringify(analysis.competitiveIntelligence) : null,
    analysis_confidence_score: analysis?.analysisConfidenceScore ?? 0.75,
    data_sources: analysis?.dataSources ? JSON.stringify(analysis.dataSources) : JSON.stringify(['website_analysis']),
    ai_model_used: analysis?.aiModelUsed || 'gpt-4',
    raw_openai_response: analysis?.rawOpenaiResponse ? JSON.stringify(analysis.rawOpenaiResponse) : null
  };

  return { organizationData, intelligenceData, organizationName, now };
}

/**
 * Update or create organization and insert current intelligence record.
 * @param {object} db
 * @param {object} params
 * @returns {Promise<string>} organizationId
 */
export async function saveOrganizationAndIntelligence(db, {
  existingOrganization,
  organizationSource,
  shouldAdoptAnonymousOrg,
  organizationData,
  intelligenceData,
  organizationName,
  now,
  userId,
  sessionId
}) {
  let organizationId;

  if (existingOrganization) {
    organizationId = existingOrganization.id;

    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;
    if (shouldAdoptAnonymousOrg) {
      updateFields.push(`owner_user_id = $${paramIndex}`);
      updateValues.push(userId);
      paramIndex++;
    }
    for (const [key, value] of Object.entries(organizationData)) {
      if (key !== 'name') {
        updateFields.push(`${key} = $${paramIndex}`);
        updateValues.push(value);
        paramIndex++;
      }
    }
    updateFields.push('updated_at = NOW()');
    updateValues.push(organizationId);

    await db.query(
      `UPDATE organizations SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
      updateValues
    );

    await db.query(
      'UPDATE organization_intelligence SET is_current = FALSE WHERE organization_id = $1',
      [organizationId]
    );
  } else {
    organizationId = uuidv4();
    const insertFields = ['id', 'slug', ...Object.keys(organizationData), 'created_at', 'updated_at'];
    const orgSlug = organizationName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').substring(0, 100);
    const insertValues = [organizationId, orgSlug, ...Object.values(organizationData), now, now];
    if (userId) {
      insertFields.push('owner_user_id');
      insertValues.push(userId);
    } else {
      insertFields.push('session_id');
      insertValues.push(sessionId);
    }
    const insertPlaceholders = insertFields.map((_, i) => `$${i + 1}`).join(', ');
    await db.query(
      `INSERT INTO organizations (${insertFields.join(', ')}) VALUES (${insertPlaceholders})`,
      insertValues
    );
  }

  const intelligenceId = uuidv4();
  const intelInsertFields = ['id', 'organization_id', ...Object.keys(intelligenceData), 'is_current', 'created_at', 'updated_at'];
  const intelInsertValues = [intelligenceId, organizationId, ...Object.values(intelligenceData), true, now, now];

  if (!userId && sessionId) {
    intelInsertFields.push('session_id');
    intelInsertValues.push(sessionId);
    const orgIdIndex = intelInsertFields.indexOf('organization_id');
    intelInsertFields.splice(orgIdIndex, 1);
    intelInsertValues.splice(orgIdIndex, 1);
  }

  const intelInsertPlaceholders = intelInsertFields.map((_, i) => `$${i + 1}`).join(', ');
  await db.query(
    `INSERT INTO organization_intelligence (${intelInsertFields.join(', ')}) VALUES (${intelInsertPlaceholders})`,
    intelInsertValues
  );

  return organizationId;
}

/**
 * Clear existing CTAs for organization, then insert normalized CTAs. Updates has_cta_data flag.
 * @param {object} db
 * @param {string} organizationId
 * @param {string} pageUrl
 * @param {Array<object>} ctas - Raw CTA objects from scraper
 * @returns {Promise<{ ctaStoredCount: number }>}
 */
export async function storeCTAs(db, organizationId, pageUrl, ctas) {
  await db.query('DELETE FROM cta_analysis WHERE organization_id = $1', [organizationId]);
  await db.query(`
    UPDATE organizations
    SET data_availability = jsonb_set(
      COALESCE(data_availability, '{}'::jsonb),
      '{has_cta_data}',
      'false'::jsonb
    )
    WHERE id = $1
  `, [organizationId]);

  let ctaStoredCount = 0;
  for (const cta of ctas) {
    try {
      const normalized = normalizeCTA(cta);
      await db.query(`
        INSERT INTO cta_analysis (
          organization_id, page_url, cta_text, cta_type, placement,
          href, context, class_name, tag_name, conversion_potential,
          visibility_score, page_type, analysis_source, data_source, scraped_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
        ON CONFLICT (organization_id, page_url, cta_text, placement) DO UPDATE SET
          cta_type = EXCLUDED.cta_type,
          href = EXCLUDED.href,
          context = EXCLUDED.context,
          data_source = EXCLUDED.data_source,
          scraped_at = EXCLUDED.scraped_at
      `, [
        organizationId,
        pageUrl,
        normalized.cta_text,
        normalized.cta_type,
        normalized.placement,
        normalized.href,
        normalized.context,
        normalized.class_name,
        normalized.tag_name,
        normalized.conversion_potential,
        normalized.visibility_score,
        'homepage',
        'website_scraping',
        'scraped'
      ]);
      ctaStoredCount++;
    } catch (err) {
      console.error('Failed to store CTA:', err.message);
    }
  }

  if (ctaStoredCount > 0) {
    await db.query(`
      UPDATE organizations
      SET data_availability = jsonb_set(
        COALESCE(data_availability, '{}'::jsonb),
        '{has_cta_data}',
        'true'::jsonb
      )
      WHERE id = $1
    `, [organizationId]);
  }

  return { ctaStoredCount };
}

/**
 * Fetch stored CTAs for an organization (for response).
 * @param {object} db
 * @param {string} organizationId
 * @param {number} limit
 * @returns {Promise<Array<object>>}
 */
export async function getStoredCTAs(db, organizationId, limit = 5) {
  const result = await db.query(`
    SELECT id, cta_text as text, cta_type as type, href, placement,
           conversion_potential, data_source
    FROM cta_analysis
    WHERE organization_id = $1
    ORDER BY conversion_potential DESC
    LIMIT $2
  `, [organizationId, limit]);
  return result.rows;
}

/**
 * Persist website analysis: resolve org, save organization + intelligence, store CTAs, return organizationId and stored CTAs.
 * No-op (returns null organizationId) when neither userId nor sessionId provided.
 * Failures in lead capture or CTA storage are logged and do not throw so the main analysis response can still succeed.
 *
 * @param {object} db - Database service
 * @param {{ userId: string | null, sessionId: string | null, url: string, analysis: object, ctas: Array<object> }} params
 * @returns {Promise<{ organizationId: string | null, storedCTAs: Array<object>, ctaStoredCount: number }>}
 */
export async function saveAnalysisResult(db, { userId, sessionId, url, analysis, ctas = [] }) {
  if (!userId && !sessionId) {
    return { organizationId: null, storedCTAs: [], ctaStoredCount: 0 };
  }

  const { organizationData, intelligenceData, organizationName, now } = buildOrganizationAndIntelligenceData(analysis, url);
  const { existingOrganization, organizationSource, shouldAdoptAnonymousOrg } = await resolveOrganization(db, { userId, sessionId, url });

  const organizationId = await saveOrganizationAndIntelligence(db, {
    existingOrganization,
    organizationSource,
    shouldAdoptAnonymousOrg,
    organizationData,
    intelligenceData,
    organizationName,
    now,
    userId,
    sessionId
  });

  let ctaStoredCount = 0;
  let storedCTAs = [];

  if (ctas.length > 0) {
    const storeResult = await storeCTAs(db, organizationId, url, ctas);
    ctaStoredCount = storeResult.ctaStoredCount;
    storedCTAs = await getStoredCTAs(db, organizationId, 5);
  }

  return { organizationId, storedCTAs, ctaStoredCount };
}
