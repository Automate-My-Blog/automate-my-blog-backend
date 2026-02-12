/**
 * Website analysis pipeline: analyze → audiences → pitches → audience images.
 * Used by the job worker for website_analysis jobs.
 * Persists org/intel/CTAs, then returns combined result matching current API shape.
 */

import db from './database.js';
import webScraperService from './webscraper.js';
import openaiService from './openai.js';
import { normalizeCTA } from '../utils/cta-normalizer.js';
import { getAnalysisIconUrls } from '../utils/analysis-icons.js';
import { v4 as uuidv4 } from 'uuid';

const PROGRESS_STEPS = [
  'Analyzing website',
  'Generating audiences',
  'Generating pitches',
  'Generating images'
];

/** Granular phases for Thinking-model UX. stepIndex -> array of phase labels. */
export const PROGRESS_PHASES = [
  [
    'Fetching page content',
    'Researching business (brand & competitors)',
    'Researching keywords & SEO',
    'Analyzing business from content',
    'Analyzing customer psychology',
    'Saving analysis & CTAs',
    'Generating narrative summary'
  ],
  [
    'Checking existing audiences',
    'Identifying audience opportunities',
    'Creating customer scenarios'
  ],
  [
    'Calculating revenue projections',
    'Generating conversion pitches'
  ],
  [
    'Creating audience visuals',
    'Saving strategies'
  ]
];

/**
 * Extract business profile data from analysis for PowerPoint-style display
 */
function extractBusinessProfile(analysisData, intelligenceData, ctaData) {
  return {
    businessName: analysisData.businessName || analysisData.companyName || 'Business Name',
    domain: analysisData.website || '',
    tagline: analysisData.businessType || 'Business Type',
    whatTheyDo: analysisData.description || 'No description available',
    targetAudience: analysisData.decisionMakers || analysisData.endUsers || 'Not specified',
    brandVoice: intelligenceData?.customer_language_patterns?.tone || 'Professional',
    contentFocus: analysisData.contentFocus || 'Content strategy',
    ctas: ctaData?.map(cta => ({
      text: cta.cta_text || cta.text || 'Learn more',
      url: cta.cta_url || cta.url || ''
    })) || [],
    businessModel: analysisData.businessModel || 'Not specified',
    websiteGoals: analysisData.websiteGoals || 'Not specified',
    blogStrategy: analysisData.blogStrategy || 'Not specified',
    keyTopics: intelligenceData?.seo_opportunities || null
  };
}

/**
 * Persist analysis to organization, intelligence, and CTAs.
 * Returns { organizationId }.
 */
async function persistAnalysis(url, analysis, scrapedContent, { userId, sessionId }) {
  const now = new Date();
  const organizationName = analysis?.businessName || analysis?.companyName || new URL(url).hostname;
  const orgData = {
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

  let organizationId;
  let existing = null;

  if (userId) {
    const r = await db.query(
      'SELECT id FROM organizations WHERE owner_user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    existing = r.rows[0];
  }
  if (!existing && sessionId) {
    const r = await db.query(
      'SELECT id FROM organizations WHERE website_url = $1 AND owner_user_id IS NULL AND session_id = $2 ORDER BY created_at DESC LIMIT 1',
      [url, sessionId]
    );
    existing = r.rows[0];
  }
  if (!existing && !userId && sessionId) {
    const r = await db.query(
      'SELECT id FROM organizations WHERE website_url = $1 AND owner_user_id IS NULL ORDER BY created_at DESC LIMIT 1',
      [url]
    );
    existing = r.rows[0];
  }

  const updateExistingOrg = async (id) => {
    const sessionIdToSet = userId ? null : (sessionId || null);
    await db.query(
      `UPDATE organizations SET
        website_url = $1, business_type = $2, industry_category = $3, business_model = $4,
        company_size = $5, description = $6, target_audience = $7, brand_voice = $8,
        website_goals = $9, last_analyzed_at = $10, session_id = $11, updated_at = NOW()
       WHERE id = $12`,
      [orgData.website_url, orgData.business_type, orgData.industry_category, orgData.business_model,
        orgData.company_size, orgData.description, orgData.target_audience, orgData.brand_voice,
        orgData.website_goals, orgData.last_analyzed_at, sessionIdToSet, id]
    );
    await db.query(
      'UPDATE organization_intelligence SET is_current = FALSE WHERE organization_id = $1',
      [id]
    );
  };

  if (existing) {
    organizationId = existing.id;
    await updateExistingOrg(organizationId);
  } else {
    organizationId = uuidv4();
    const slugBase = organizationName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').substring(0, 100);
    const ownerId = userId || null;
    const sessId = userId ? null : (sessionId || null);
    let created = false;

    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      const slug = attempt === 0 ? slugBase : `${slugBase}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      try {
        await db.query(
          `INSERT INTO organizations (id, slug, name, website_url, business_type, industry_category, business_model,
            company_size, description, target_audience, brand_voice, website_goals, last_analyzed_at, created_at, updated_at,
            owner_user_id, session_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [organizationId, slug, orgData.name, orgData.website_url, orgData.business_type, orgData.industry_category,
            orgData.business_model, orgData.company_size, orgData.description, orgData.target_audience, orgData.brand_voice,
            orgData.website_goals, orgData.last_analyzed_at, now, now, ownerId, sessId]
        );
        created = true;
      } catch (insertError) {
        if (insertError.code === '23505' && insertError.constraint === 'organizations_slug_key') {
          // If another request already created an org for this URL, reuse it instead of failing.
          const byUrl = await db.query(
            'SELECT id FROM organizations WHERE website_url = $1 ORDER BY created_at DESC LIMIT 1',
            [url]
          );
          if (byUrl.rows.length > 0) {
            organizationId = byUrl.rows[0].id;
            await updateExistingOrg(organizationId);
            created = true;
          } else if (attempt === 2) {
            throw insertError;
          }
        } else {
          throw insertError;
        }
      }
    }
  }

  const intelId = uuidv4();
  const intelKeys = [
    'customer_scenarios', 'business_value_assessment', 'customer_language_patterns', 'search_behavior_insights',
    'seo_opportunities', 'content_strategy_recommendations', 'competitive_intelligence', 'analysis_confidence_score',
    'data_sources', 'ai_model_used', 'raw_openai_response', 'is_current'
  ];
  const intelData = {
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
    raw_openai_response: analysis ? JSON.stringify(analysis) : null,
    is_current: true
  };
  const intelValues = intelKeys.map((k) => intelData[k]);
  const placeholders = intelKeys.map((_, i) => `$${i + 3}`).join(', ');
  const n = intelKeys.length;
  await db.query(
    `INSERT INTO organization_intelligence (id, organization_id, ${intelKeys.join(', ')}, created_at, updated_at)
     VALUES ($1, $2, ${placeholders}, $${n + 3}, $${n + 4})`,
    [intelId, organizationId, ...intelValues, now, now]
  );

  await db.query('DELETE FROM cta_analysis WHERE organization_id = $1', [organizationId]);
  let storedCTAs = [];
  if (scrapedContent?.ctas?.length) {
    for (const cta of scrapedContent.ctas) {
      try {
        const n = normalizeCTA(cta);
        await db.query(
          `INSERT INTO cta_analysis (
            organization_id, page_url, cta_text, cta_type, placement, href, context, class_name, tag_name,
            conversion_potential, visibility_score, page_type, analysis_source, data_source, scraped_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
          ON CONFLICT (organization_id, page_url, cta_text, placement) DO UPDATE SET
            cta_type = EXCLUDED.cta_type, href = EXCLUDED.href, context = EXCLUDED.context,
            data_source = EXCLUDED.data_source, scraped_at = EXCLUDED.scraped_at`,
          [organizationId, url, n.cta_text, n.cta_type, n.placement, n.href, n.context, n.class_name, n.tag_name,
            n.conversion_potential, n.visibility_score, 'homepage', 'website_scraping', 'scraped']
        );
      } catch (e) {
        console.warn('CTA persist skip:', e.message);
      }
    }
    const top = await db.query(
      `SELECT id, cta_text as text, cta_type as type, href, placement, conversion_potential, data_source
       FROM cta_analysis WHERE organization_id = $1 ORDER BY conversion_potential DESC LIMIT 5`,
      [organizationId]
    );
    storedCTAs = top.rows;
  }

  // Persist discovered social handles (from website links) when present
  const socialHandles = scrapedContent?.socialHandles;
  if (socialHandles && typeof socialHandles === 'object' && Object.keys(socialHandles).length > 0) {
    await db.query(
      `UPDATE organizations SET social_handles = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(socialHandles), organizationId]
    );
  }

  return { organizationId, storedCTAs };
}

/**
 * Run full website analysis pipeline.
 * @param {object} input - { url: string }
 * @param {object} context - { userId?, sessionId? }
 * @param {object} opts - { onProgress?(...), onPartialResult?(segment, data)?, onStreamNarrative?(event)?, isCancelled?: () => boolean | Promise<boolean> }
 *   onPartialResult(segment, data): segment is 'analysis' | 'audiences' | 'pitches' | 'scenarios'; data is the partial result for that segment.
 *   onStreamNarrative(event): event is { type, content, progress? } for narrative stream (analysis-status-update, transition, analysis-chunk, narrative-complete).
 * @returns {Promise<object>} Combined result matching current analyze-website + audiences + pitches + images API shape.
 */
export async function runWebsiteAnalysisPipeline(input, context = {}, opts = {}) {
  const { url } = input;
  const { userId, sessionId } = context;
  const { onProgress, onPartialResult, onStreamNarrative, isCancelled } = opts;

  const streamNarrative = async (event) => {
    if (typeof onStreamNarrative === 'function') {
      try {
        await onStreamNarrative(event);
      } catch (e) {
        console.warn('⚠️ onStreamNarrative error:', e?.message || e);
      }
    }
  };
  const CACHE_TTL_DAYS = 30;

  if (!url) throw new Error('url is required');
  if (!userId && !sessionId) throw new Error('Either userId or sessionId is required');
  if (!webScraperService.isValidUrl(url)) throw new Error('Invalid URL format');

  /** Start existing-audiences query early so it overlaps with scrape + analyze (faster). */
  let existingAudiencesPromise = null;
  if (userId || sessionId) {
    const whereConditions = userId ? ['user_id = $1'] : ['session_id = $1'];
    const queryParams = userId ? [userId] : [sessionId];
    existingAudiencesPromise = db
      .query(
        `SELECT target_segment, customer_problem FROM audiences WHERE ${whereConditions.join(' AND ')} ORDER BY created_at DESC`,
        queryParams
      )
      .then((r) => r.rows)
      .catch((err) => {
        console.warn('⚠️ Failed to query existing audiences, continuing without deduplication:', err.message);
        return [];
      });
  } else {
    existingAudiencesPromise = Promise.resolve([]);
  }

  /** Yield to event loop so each progress update is published in its own tick (avoids frontend receiving all at once). */
  const yieldTick = () => new Promise((r) => setImmediate(r));

  const report = async (stepIndex, label, progress, estimated, extra = {}) => {
    await yieldTick();
    if (typeof onProgress === 'function') onProgress(stepIndex, label, progress, estimated, extra);
  };

  const checkCancelled = async () => {
    if (typeof isCancelled !== 'function') return false;
    const v = isCancelled();
    return typeof v?.then === 'function' ? await v : !!v;
  };

  const findOrgForCache = async () => {
    const websiteDomain = new URL(url).hostname;
    const urlVariants = [url, `http://${websiteDomain}`, `https://${websiteDomain}`];
    const result = await db.query(
      `SELECT id, website_url, last_analyzed_at
       FROM organizations
       WHERE website_url = ANY($1)
         AND last_analyzed_at > NOW() - INTERVAL '${CACHE_TTL_DAYS} days'
       ORDER BY last_analyzed_at DESC
       LIMIT 1`,
      [urlVariants]
    );
    return result.rows[0] || null;
  };

  /**
   * Backfill missing cache data by making necessary service calls.
   * Extensible: add new backfill steps here when we add new fields.
   */
  const backfillMissingCacheData = async (result, { org, intelRow, storedCTAs, report, onPartialResult }) => {
    let { analysis, scenarios } = result;
    const orgId = result.organizationId;

    // 1. Narrative backfill — generate and persist if missing
    if (analysis && (analysis.narrative == null || analysis.narrative === '')) {
      try {
        const intelligenceData = {
          customer_language_patterns: intelRow.customer_language_patterns,
          customer_scenarios: intelRow.customer_scenarios,
          search_behavior_insights: intelRow.search_behavior_insights,
          seo_opportunities: intelRow.seo_opportunities,
          content_strategy_recommendations: intelRow.content_strategy_recommendations,
          business_value_assessment: intelRow.business_value_assessment
        };
        const ctaForNarrative = (storedCTAs || []).map((c) => ({ cta_text: c.text || c.cta_text }));
        const narrativeAnalysis = await openaiService.generateWebsiteAnalysisNarrative(
          {
            businessName: analysis.businessName || analysis.companyName,
            businessType: analysis.businessType,
            description: analysis.description,
            businessModel: analysis.businessModel,
            decisionMakers: analysis.decisionMakers,
            endUsers: analysis.endUsers,
            searchBehavior: analysis.searchBehavior,
            contentFocus: analysis.contentFocus,
            websiteGoals: analysis.websiteGoals,
            blogStrategy: analysis.blogStrategy
          },
          intelligenceData,
          ctaForNarrative
        );
        await db.query(
          `UPDATE organization_intelligence
           SET narrative_analysis = $1, narrative_confidence = $2, key_insights = $3, updated_at = NOW()
           WHERE organization_id = $4 AND is_current = TRUE`,
          [
            narrativeAnalysis.narrative,
            narrativeAnalysis.confidence,
            JSON.stringify(narrativeAnalysis.keyInsights || []),
            orgId
          ]
        );
        analysis = {
          ...analysis,
          narrative: narrativeAnalysis.narrative,
          narrativeConfidence: narrativeAnalysis.confidence,
          keyInsights: narrativeAnalysis.keyInsights || []
        };
        if (typeof report === 'function') report(0, PROGRESS_STEPS[0], 100, 0, { phase: PROGRESS_PHASES[0][6], detail: 'cached+narrative-backfill' });
      } catch (e) {
        console.warn('⚠️ Cache narrative backfill failed:', e.message);
      }
    }

    // 2. Scenarios backfill — generate audiences/pitches/images if missing
    if (scenarios.length === 0 && analysis) {
      try {
        const whereConditions = userId ? ['user_id = $1'] : ['session_id = $1'];
        const queryParams = userId ? [userId] : [sessionId];
        const existingRows = await db.query(
          `SELECT target_segment, customer_problem FROM audiences WHERE ${whereConditions.join(' AND ')} ORDER BY created_at DESC`,
          queryParams
        ).then((r) => r.rows).catch(() => []);
        let newScenarios = await openaiService.generateAudienceScenarios(analysis, '', '', existingRows);
        const businessContext = {
          businessType: analysis.businessType,
          businessName: analysis.businessName || analysis.companyName,
          targetAudience: analysis.targetAudience
        };
        newScenarios = await openaiService.generatePitches(newScenarios, businessContext, {});
        const brandContext = { brandVoice: analysis.brandVoice || 'Professional' };
        newScenarios = await openaiService.generateAudienceImages(newScenarios, brandContext, {});
        scenarios = newScenarios;
        if (typeof onPartialResult === 'function' && scenarios.length > 0) {
          onPartialResult('audiences', { scenarios: [...scenarios] });
          onPartialResult('pitches', { scenarios: [...scenarios] });
          onPartialResult('scenarios', { scenarios: [...scenarios] });
        }
        if (typeof report === 'function') report(0, PROGRESS_STEPS[0], 100, 0, { phase: PROGRESS_PHASES[0][6], detail: 'cached+scenarios-backfill' });
        // Persist scenarios to audiences for future cache hits
        const intelRes = await db.query(
          'SELECT id FROM organization_intelligence WHERE organization_id = $1 AND is_current = TRUE LIMIT 1',
          [orgId]
        );
        const orgIntelId = intelRes.rows[0]?.id ?? null;
        if (orgIntelId && scenarios.length > 0) {
          await db.query(
            'UPDATE organization_intelligence SET customer_scenarios = $1, updated_at = NOW() WHERE organization_id = $2 AND is_current = TRUE',
            [JSON.stringify(scenarios.map((s) => ({
              customerProblem: s.customerProblem,
              targetSegment: s.targetSegment,
              businessValue: s.businessValue,
              customerLanguage: s.customerLanguage,
              conversionPath: s.conversionPath,
              seoKeywords: s.seoKeywords,
              contentIdeas: s.contentIdeas,
              pitch: s.pitch
            }))), orgId]
          );
          for (let i = 0; i < scenarios.length; i++) {
            const s = scenarios[i];
            const targetSegment = s.targetSegment || { demographics: '', psychographics: '', searchBehavior: '' };
            const businessValue = s.businessValue || {};
            await db.query(
              `INSERT INTO audiences (
                user_id, session_id, organization_intelligence_id,
                target_segment, customer_problem, customer_language, conversion_path,
                business_value, priority, pitch, image_url,
                projected_revenue_low, projected_revenue_high, projected_profit_low, projected_profit_high
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
              [
                userId || null,
                userId ? null : (sessionId || null),
                orgIntelId,
                JSON.stringify(targetSegment),
                s.customerProblem || null,
                s.customerLanguage ? JSON.stringify(s.customerLanguage) : null,
                s.conversionPath || null,
                JSON.stringify(businessValue),
                (s.businessValue?.priority ?? i + 1),
                s.pitch || null,
                s.imageUrl || null,
                s.projected_revenue_low ?? null,
                s.projected_revenue_high ?? null,
                s.projected_profit_low ?? null,
                s.projected_profit_high ?? null
              ]
            );
          }
        }
      } catch (e) {
        console.warn('⚠️ Cache scenarios backfill failed:', e.message);
      }
    }

    return { ...result, analysis, scenarios };
  };

  const maybeReturnCachedResult = async () => {
    const org = await findOrgForCache();
    if (!org?.id) return null;
    const intelResult = await db.query(
      `SELECT oi.raw_openai_response, oi.created_at, oi.narrative_analysis, oi.narrative_confidence, oi.key_insights,
              oi.customer_language_patterns, oi.customer_scenarios, oi.search_behavior_insights,
              oi.seo_opportunities, oi.content_strategy_recommendations, oi.business_value_assessment,
              o.name, o.description, o.business_type, o.industry_category, o.target_audience, o.brand_voice,
              o.website_goals, o.company_size, o.business_model
       FROM organization_intelligence oi
       JOIN organizations o ON o.id = oi.organization_id
       WHERE oi.organization_id = $1 AND oi.is_current = TRUE
         AND oi.created_at > NOW() - INTERVAL '${CACHE_TTL_DAYS} days'
       ORDER BY oi.created_at DESC
       LIMIT 1`,
      [org.id]
    );
    const intelRow = intelResult.rows[0];
    if (!intelRow) return null;

    const ctaResult = await db.query(
      `SELECT id, cta_text as text, cta_type as type, href, placement, conversion_potential, data_source
       FROM cta_analysis WHERE organization_id = $1 ORDER BY conversion_potential DESC LIMIT 5`,
      [org.id]
    );
    const storedCTAs = ctaResult.rows || [];

    const audiencesResult = await db.query(
      `SELECT target_segment, customer_problem, customer_language, conversion_path, business_value,
              pitch, image_url, projected_revenue_low, projected_revenue_high, projected_profit_low, projected_profit_high
       FROM audiences
       WHERE organization_intelligence_id = (
         SELECT id FROM organization_intelligence WHERE organization_id = $1 AND is_current = TRUE
         ORDER BY created_at DESC LIMIT 1
       )
       ORDER BY created_at DESC`,
      [org.id]
    );
    const scenarios = (audiencesResult.rows || []).map((row) => ({
      targetSegment: row.target_segment,
      customerProblem: row.customer_problem,
      customerLanguage: row.customer_language,
      conversionPath: row.conversion_path,
      businessValue: row.business_value,
      pitch: row.pitch,
      imageUrl: row.image_url,
      projectedRevenueLow: row.projected_revenue_low,
      projectedRevenueHigh: row.projected_revenue_high,
      projectedProfitLow: row.projected_profit_low,
      projectedProfitHigh: row.projected_profit_high
    }));

    const rawAnalysis = intelRow.raw_openai_response;
    const orgFallback = {
      businessName: intelRow.name || org.website_url,
      companyName: intelRow.name || org.website_url,
      description: intelRow.description,
      businessType: intelRow.business_type,
      industryCategory: intelRow.industry_category,
      targetAudience: intelRow.target_audience,
      brandVoice: intelRow.brand_voice,
      websiteGoals: intelRow.website_goals,
      companySize: intelRow.company_size,
      businessModel: intelRow.business_model
    };
    const analysis = {
      ...orgFallback,
      ...(rawAnalysis && typeof rawAnalysis === 'object' ? rawAnalysis : {}),
      organizationId: org.id,
      ...(intelRow.narrative_analysis != null && { narrative: intelRow.narrative_analysis }),
      ...(intelRow.narrative_confidence != null && { narrativeConfidence: intelRow.narrative_confidence }),
      ...(intelRow.key_insights != null && { keyInsights: intelRow.key_insights }),
      iconUrls: getAnalysisIconUrls(orgFallback)
    };

    let metadata = { title: null, headings: [] };
    try {
      const pageResult = await db.query(
        `SELECT title, headings FROM website_pages
         WHERE organization_id = $1 AND (title IS NOT NULL OR headings IS NOT NULL)
         ORDER BY CASE WHEN page_type = 'homepage' THEN 0 ELSE 1 END, scraped_at DESC NULLS LAST
         LIMIT 1`,
        [org.id]
      );
      if (pageResult.rows[0]) {
        const r = pageResult.rows[0];
        const rawHeadings = r.headings;
        const headings = Array.isArray(rawHeadings)
          ? rawHeadings
          : (rawHeadings && typeof rawHeadings === 'object' && !Array.isArray(rawHeadings)
            ? Object.values(rawHeadings)
            : []);
        metadata = { title: r.title, headings };
      }
    } catch (e) {
      // Ignore - keep default metadata
    }

    let result = {
      success: true,
      fromCache: true,
      cacheTtlDays: CACHE_TTL_DAYS,
      url,
      scrapedAt: org.last_analyzed_at || intelRow.created_at,
      analysis,
      metadata,
      scenarios,
      ctas: storedCTAs,
      ctaCount: storedCTAs.length,
      hasSufficientCTAs: storedCTAs.length >= 3,
      organizationId: org.id
    };

    result = await backfillMissingCacheData(result, {
      org,
      intelRow,
      storedCTAs,
      report,
      onPartialResult
    });

    if (typeof onPartialResult === 'function') {
      onPartialResult('analysis', {
        url: result.url,
        scrapedAt: result.scrapedAt,
        analysis: result.analysis,
        metadata: result.metadata,
        ctas: result.ctas,
        ctaCount: result.ctaCount,
        hasSufficientCTAs: result.hasSufficientCTAs,
        organizationId: result.organizationId
      });
      if (result.scenarios.length > 0) {
        onPartialResult('audiences', { scenarios: [...result.scenarios] });
        onPartialResult('pitches', { scenarios: [...result.scenarios] });
        onPartialResult('scenarios', { scenarios: [...result.scenarios] });
      }
    }

    // Stream narrative thoughts so frontend shows typing effect (same UX as fresh run)
    const narrativeText = result.analysis?.narrative;
    if (narrativeText) {
      await streamNarrative({ type: 'analysis-status-update', content: 'Loading analysis from cache...', progress: 5 });
      const words = narrativeText.split(/(\s+)/);
      for (let i = 0; i < words.length; i++) {
        await streamNarrative({ type: 'analysis-chunk', content: words[i] });
        if (words[i].trim()) await new Promise((r) => setTimeout(r, 15));
      }
      await streamNarrative({ type: 'narrative-complete', content: '' });
    }

    await report(0, PROGRESS_STEPS[0], 100, 0, { phase: PROGRESS_PHASES[0][6], detail: 'cached' });
    return result;
  };

  const cachedResult = await maybeReturnCachedResult();
  if (cachedResult) return cachedResult;

  /** Progress 2–10% during scrape; granular phases published to stream as thoughts. */
  const SCRAPE_PROGRESS = {
    start: 2, validate: 3, 'method-puppeteer': 4, config: 4, 'browser-launch': 5,
    navigate: 6, 'wait-content': 7, extract: 8, ctas: 9,
    'fallback-playwright': 9, 'fallback-browserless': 9, 'fallback-cheerio': 9,
    'api-request': 5, 'parse-html': 7, fetch: 5
  };

  const onScrapeProgress = (phase, message, detail = {}) => {
    const progress = SCRAPE_PROGRESS[phase] ?? 9;
    void report(0, PROGRESS_STEPS[0], progress, 85, {
      phase: message,
      scrapePhase: phase,
      scrapeMessage: message,
      ...detail
    });
  };

  await report(0, PROGRESS_STEPS[0], 2, 90, { phase: PROGRESS_PHASES[0][0] });
  if (await checkCancelled()) throw new Error('Cancelled');

  const scrapedContent = await webScraperService.scrapeWebsite(url, { onScrapeProgress });
  if (typeof onPartialResult === 'function') {
    onPartialResult('scrape-result', {
      url,
      title: scrapedContent.title,
      metaDescription: scrapedContent.metaDescription,
      headings: scrapedContent.headings || [],
      scrapedAt: scrapedContent.scrapedAt
    });
  }

  // Narrative UX: fire scraping observation (async, non-blocking)
  const domain = new URL(url).hostname;
  openaiService.generateScrapingObservation({
    domain,
    initialContent: scrapedContent.title || scrapedContent.metaDescription || ''
  }).then((obs) => {
    if (obs) return streamNarrative({ type: 'analysis-status-update', content: obs, progress: 10 });
  }).catch((e) => console.warn('⚠️ Scraping observation failed:', e?.message || e));

  // Normalize headings to strings (Cheerio returns { text, level, id }; Puppeteer/Playwright return strings)
  const headingStrings = (scrapedContent.headings || []).map(h =>
    typeof h === 'string' ? h : (h?.text ?? '')
  ).filter(Boolean);

  const maxContentChars = Math.max(0, parseInt(process.env.WEBSITE_ANALYSIS_MAX_CONTENT_CHARS || '50000', 10)) || 50000;
  let contentForAnalysis = scrapedContent.content || '';
  if (contentForAnalysis.length > maxContentChars) {
    contentForAnalysis = contentForAnalysis.slice(0, maxContentChars) + '\n\n[Content truncated for analysis.]';
  }

  const fullContent = [
    `Title: ${scrapedContent.title}`,
    `Meta Description: ${scrapedContent.metaDescription}`,
    `Headings: ${headingStrings.join(', ')}`,
    `Content: ${contentForAnalysis}`
  ].join('\n').trim();

  await report(0, PROGRESS_STEPS[0], 10, 85, { phase: PROGRESS_PHASES[0][1] });
  if (await checkCancelled()) throw new Error('Cancelled');

  const analysisSubPhaseProgress = { 'Researching business (brand & competitors)': 12, 'Researching keywords & SEO': 20, 'Analyzing business from content': 30 };
  const onAnalyzeProgress = (phase) => {
    const p = analysisSubPhaseProgress[phase];
    if (p != null) void report(0, PROGRESS_STEPS[0], p, 60, { phase });
  };
  const analysis = await openaiService.analyzeWebsite(fullContent, url, { onProgress: onAnalyzeProgress });
  await report(0, PROGRESS_STEPS[0], 35, 60, { phase: PROGRESS_PHASES[0][4] });
  if (await checkCancelled()) throw new Error('Cancelled');

  const { organizationId, storedCTAs } = await persistAnalysis(url, analysis, scrapedContent, { userId, sessionId });
  await report(0, PROGRESS_STEPS[0], 65, 45, { phase: PROGRESS_PHASES[0][5] });

  // Narrative UX: CTA observation (async, non-blocking)
  const ctaTypes = (storedCTAs || []).map((c) => c.type || c.cta_type || 'action').filter(Boolean);
  openaiService.generateCTAObservation({
    ctasFound: (storedCTAs || []).length,
    ctaTypes: ctaTypes.length ? ctaTypes : ['general']
  }).then((obs) => {
    if (obs) return streamNarrative({ type: 'analysis-status-update', content: obs, progress: 70 });
  }).catch((e) => console.warn('⚠️ CTA observation failed:', e?.message || e));

  await report(0, PROGRESS_STEPS[0], 75, 30, { phase: PROGRESS_PHASES[0][6] });
  if (await checkCancelled()) throw new Error('Cancelled');

  // Generate narrative analysis
  try {
    console.log('📝 Generating narrative analysis for organization:', organizationId);

    await streamNarrative({ type: 'transition', content: '\n\n' });

    // Get the intelligence data we just stored
    const intelligenceResult = await db.query(
      `SELECT customer_language_patterns, customer_scenarios, search_behavior_insights,
              seo_opportunities, content_strategy_recommendations, business_value_assessment
       FROM organization_intelligence
       WHERE organization_id = $1 AND is_current = TRUE
       LIMIT 1`,
      [organizationId]
    );

    const intelligenceData = intelligenceResult.rows[0] || {};

    // Normalize CTAs for narrative prompt (expects cta_text; DB returns .text)
    const ctaForNarrative = (storedCTAs || []).map((c) => ({ cta_text: c.text ?? c.cta_text ?? '' }));

    // Generate narrative from all the data
    const narrativeAnalysis = await openaiService.generateWebsiteAnalysisNarrative(
      {
        businessName: analysis.businessName || analysis.companyName,
        businessType: analysis.businessType,
        description: analysis.description,
        businessModel: analysis.businessModel,
        decisionMakers: analysis.decisionMakers,
        endUsers: analysis.endUsers,
        searchBehavior: analysis.searchBehavior,
        contentFocus: analysis.contentFocus,
        websiteGoals: analysis.websiteGoals,
        blogStrategy: analysis.blogStrategy
      },
      intelligenceData,
      ctaForNarrative
    );

    const insightCards = narrativeAnalysis?.cards || [];
    const openingNarrative = narrativeAnalysis?.narrative || '';

    // Stream short opening narrative word-by-word first (if present)
    if (openingNarrative) {
      const words = openingNarrative.split(/(\s+)/);
      for (let i = 0; i < words.length; i++) {
        if (await checkCancelled()) throw new Error('Cancelled');
        await streamNarrative({ type: 'analysis-chunk', content: words[i] });
      }
    }

    // Stream insight cards progressively (3-4 second intervals)
    console.log('📊 [CARD-STREAM] Streaming', insightCards.length, 'insight cards');

    if (insightCards.length > 0) {
      for (let i = 0; i < insightCards.length; i++) {
        if (await checkCancelled()) throw new Error('Cancelled');

        const card = insightCards[i];
        console.log('🎴 [CARD-STREAM] Streaming card', i + 1, ':', card.heading);

        // Stream card as structured event
        await streamNarrative({
          type: 'insight-card',
          content: JSON.stringify(card),
          cardIndex: i,
          totalCards: insightCards.length
        });

        // Wait 3.5 seconds before next card (except after last card)
        if (i < insightCards.length - 1) {
          await new Promise((r) => setTimeout(r, 3500));
        }
      }
    }

    // Signal narrative completion (after opening and/or cards)
    await streamNarrative({ type: 'narrative-complete', content: '' });

    // Extract and stream business profile for PowerPoint-style display (always, regardless of cards)
    console.log('📊 [PROFILE] About to extract business profile');
    const businessProfile = extractBusinessProfile(
      {
        businessName: analysis.businessName || analysis.companyName,
        businessType: analysis.businessType,
        description: analysis.description,
        businessModel: analysis.businessModel,
        decisionMakers: analysis.decisionMakers,
        endUsers: analysis.endUsers,
        searchBehavior: analysis.searchBehavior,
        contentFocus: analysis.contentFocus,
        websiteGoals: analysis.websiteGoals,
        blogStrategy: analysis.blogStrategy,
        website: url
      },
      intelligenceData,
      ctaForNarrative
    );

    console.log('📊 [PROFILE] Business profile extracted:', JSON.stringify(businessProfile, null, 2));
    console.log('📊 [PROFILE] Streaming business profile via streamNarrative');
    await streamNarrative({
      type: 'business-profile',
      content: JSON.stringify(businessProfile)
    });
    console.log('📊 [PROFILE] Business profile event sent successfully');

    // Store short opening as narrative_analysis; cards as key_insights (frontend shows both)
    const narrativeText = openingNarrative || insightCards.map(card =>
      `${card.heading}\n\n${card.body}\n\n${card.takeaway}`
    ).join('\n\n---\n\n');

    await db.query(
      `UPDATE organization_intelligence
       SET narrative_analysis = $1,
           narrative_confidence = $2,
           key_insights = $3,
           updated_at = NOW()
       WHERE organization_id = $4 AND is_current = TRUE`,
      [
        narrativeText,
        narrativeAnalysis.confidence,
        JSON.stringify(insightCards),
        organizationId
      ]
    );

    console.log('✅ Narrative analysis generated and stored successfully');
  } catch (error) {
    console.error('❌ Error generating narrative analysis:', error);
    // Stream a fallback card so the narrative stream is not empty
    const fallbackCard = {
      category: 'Analysis Complete',
      heading: 'Your Business Analysis',
      body: `We've analyzed ${analysis?.businessName || analysis?.companyName || 'this business'}. Your customers are searching when ${analysis?.searchBehavior || 'they need solutions'}. This represents a key content opportunity.`,
      takeaway: 'Opportunity: Create content that addresses this search intent'
    };
    try {
      await streamNarrative({ type: 'transition', content: '\n\n' });
      await streamNarrative({
        type: 'insight-card',
        content: JSON.stringify(fallbackCard),
        cardIndex: 0,
        totalCards: 1
      });
      await streamNarrative({ type: 'narrative-complete', content: '' });
    } catch (streamErr) {
      console.warn('⚠️ Fallback narrative stream failed:', streamErr?.message || streamErr);
    }
  }

  await report(0, PROGRESS_STEPS[0], 100, 0, { phase: PROGRESS_PHASES[0][6] });
  if (typeof onPartialResult === 'function') {
    const analysisWithIcons = {
      ...analysis,
      organizationId,
      iconUrls: getAnalysisIconUrls(analysis)
    };
    onPartialResult('analysis', {
      url,
      scrapedAt: scrapedContent.scrapedAt,
      analysis: analysisWithIcons,
      metadata: { title: scrapedContent.title, headings: scrapedContent.headings || [] },
      ctas: storedCTAs,
      ctaCount: storedCTAs.length,
      hasSufficientCTAs: storedCTAs.length >= 3,
      organizationId
    });
  }

  // Use existing-audiences result from query started at pipeline start (overlaps with analyze)
  const existingAudiences = await existingAudiencesPromise;
  if (existingAudiences.length > 0) {
    console.log(`📊 Found ${existingAudiences.length} existing audiences for deduplication`);
  }

  await report(1, PROGRESS_STEPS[1], 0, 45, { phase: PROGRESS_PHASES[1][0] });
  if (await checkCancelled()) throw new Error('Cancelled');
  await report(1, PROGRESS_STEPS[1], 15, 40, { phase: PROGRESS_PHASES[1][1] });
  if (await checkCancelled()) throw new Error('Cancelled');
  let scenarios;
  if (typeof onPartialResult === 'function' && typeof openaiService.generateAudienceScenariosStreamWithCallback === 'function') {
    scenarios = await openaiService.generateAudienceScenariosStreamWithCallback(
      analysis, '', '', existingAudiences,
      (audience) => onPartialResult('audience-complete', { audience })
    );
  } else {
    scenarios = await openaiService.generateAudienceScenarios(analysis, '', '', existingAudiences);
  }
  await report(1, PROGRESS_STEPS[1], 80, 5, { phase: PROGRESS_PHASES[1][2] });
  await report(1, PROGRESS_STEPS[1], 100, 0, { phase: PROGRESS_PHASES[1][2] });
  if (typeof onPartialResult === 'function') {
    onPartialResult('audiences', { scenarios: [...scenarios] });
  }

  const businessContext = {
    businessType: analysis?.businessType,
    businessName: analysis?.businessName || analysis?.companyName,
    targetAudience: analysis?.targetAudience
  };
  await report(2, PROGRESS_STEPS[2], 0, 30, {
    phase: PROGRESS_PHASES[2][0],
    detail: scenarios.length ? `${scenarios.length} audiences` : null
  });
  if (await checkCancelled()) throw new Error('Cancelled');
  scenarios = await openaiService.generatePitches(scenarios, businessContext, typeof onPartialResult === 'function' ? {
    onPitchComplete: (scenario, index) => onPartialResult('pitch-complete', { index, scenario })
  } : {});
  await report(2, PROGRESS_STEPS[2], 80, 5, {
    phase: PROGRESS_PHASES[2][1],
    detail: scenarios.length ? `${scenarios.length} audiences` : null
  });
  await report(2, PROGRESS_STEPS[2], 100, 0, { phase: PROGRESS_PHASES[2][1] });
  if (typeof onPartialResult === 'function') {
    onPartialResult('pitches', { scenarios: [...scenarios] });
  }

  const brandContext = { brandVoice: analysis?.brandVoice || 'Professional' };
  await report(3, PROGRESS_STEPS[3], 0, 15, {
    phase: PROGRESS_PHASES[3][0],
    detail: scenarios.length ? `${scenarios.length} audiences` : null
  });
  if (await checkCancelled()) throw new Error('Cancelled');
  scenarios = await openaiService.generateAudienceImages(scenarios, brandContext, typeof onPartialResult === 'function' ? {
    onImageComplete: (scenario, index) => onPartialResult('scenario-image-complete', { index, scenario })
  } : {});
  await report(3, PROGRESS_STEPS[3], 70, 3, {
    phase: PROGRESS_PHASES[3][0],
    detail: scenarios.length ? `${scenarios.length} audiences` : null
  });
  await report(3, PROGRESS_STEPS[3], 90, 1, { phase: PROGRESS_PHASES[3][1] });
  await report(3, PROGRESS_STEPS[3], 100, 0, { phase: PROGRESS_PHASES[3][1] });
  if (typeof onPartialResult === 'function') {
    onPartialResult('scenarios', { scenarios: [...scenarios] });
  }

  // Persist scenarios to audiences table and organization_intelligence so they appear on refresh
  if (scenarios.length > 0) {
    try {
      const intelResult = await db.query(
        'SELECT id FROM organization_intelligence WHERE organization_id = $1 AND is_current = TRUE LIMIT 1',
        [organizationId]
      );
      const orgIntelId = intelResult.rows[0]?.id ?? null;

      await db.query(
        'UPDATE organization_intelligence SET customer_scenarios = $1, updated_at = NOW() WHERE organization_id = $2 AND is_current = TRUE',
        [JSON.stringify(scenarios.map(s => ({
          customerProblem: s.customerProblem,
          targetSegment: s.targetSegment,
          businessValue: s.businessValue,
          customerLanguage: s.customerLanguage,
          conversionPath: s.conversionPath,
          seoKeywords: s.seoKeywords,
          contentIdeas: s.contentIdeas,
          pitch: s.pitch
        }))), organizationId]
      );

      for (let i = 0; i < scenarios.length; i++) {
        const s = scenarios[i];
        const targetSegment = s.targetSegment || { demographics: '', psychographics: '', searchBehavior: '' };
        const businessValue = s.businessValue || {};
        await db.query(
          `INSERT INTO audiences (
            user_id, session_id, organization_intelligence_id,
            target_segment, customer_problem, customer_language, conversion_path,
            business_value, priority, pitch, image_url,
            projected_revenue_low, projected_revenue_high, projected_profit_low, projected_profit_high
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            userId || null,
            userId ? null : (sessionId || null),
            orgIntelId,
            JSON.stringify(targetSegment),
            s.customerProblem || null,
            s.customerLanguage ? JSON.stringify(s.customerLanguage) : null,
            s.conversionPath || null,
            JSON.stringify(businessValue),
            (s.businessValue?.priority ?? i + 1),
            s.pitch || null,
            s.imageUrl || null,
            s.projected_revenue_low ?? null,
            s.projected_revenue_high ?? null,
            s.projected_profit_low ?? null,
            s.projected_profit_high ?? null
          ]
        );
      }
      console.log(`📊 Persisted ${scenarios.length} audience strategies to database`);
    } catch (persistErr) {
      console.warn('⚠️ Failed to persist audiences (scenarios still in job result):', persistErr.message);
    }
  }

  // Generate and stream audience narrative
  if (scenarios && scenarios.length > 0) {
    try {
      console.log('📝 Generating audience narrative');
      const audienceNarrative = await openaiService.generateAudienceNarrative(analysis, scenarios);

      // Stream the narrative word by word
      const words = audienceNarrative.split(/(\s+)/);
      for (let i = 0; i < words.length; i++) {
        await streamNarrative({ type: 'audience-chunk', content: words[i] });
        if (words[i].trim()) await new Promise((r) => setTimeout(r, 15));
      }
      await streamNarrative({ type: 'audience-complete', content: '' });
      console.log('✅ Audience narrative streamed successfully');
    } catch (narrativeErr) {
      console.warn('⚠️ Failed to generate audience narrative:', narrativeErr.message);
    }
  }

  return {
    success: true,
    url,
    scrapedAt: scrapedContent.scrapedAt,
    analysis: {
      ...analysis,
      organizationId,
      iconUrls: getAnalysisIconUrls(analysis)
    },
    metadata: { title: scrapedContent.title, headings: scrapedContent.headings || [] },
    scenarios,
    ctas: storedCTAs,
    ctaCount: storedCTAs.length,
    hasSufficientCTAs: storedCTAs.length >= 3,
    organizationId
  };
}

export { PROGRESS_STEPS };
