import db from '../../services/database.js';
import openaiService from '../../services/openai.js';

/**
 * Vercel Cron endpoint to process narrative generation jobs
 * Configured to run every minute via vercel.json
 */
export default async function handler(req, res) {
  // Verify this is called by Vercel Cron (security)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('❌ [CRON] Unauthorized cron request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🔄 [CRON] Starting narrative job processor');

  let jobResult;
  try {
    // Get next pending job (with row locking to prevent race conditions)
    jobResult = await db.query(`
      UPDATE narrative_generation_jobs
      SET status = 'processing',
          started_at = NOW(),
          attempts = attempts + 1,
          updated_at = NOW()
      WHERE id = (
        SELECT id
        FROM narrative_generation_jobs
        WHERE status = 'pending'
        AND attempts < max_attempts
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, organization_id, attempts
    `);

    if (jobResult.rows.length === 0) {
      console.log('ℹ️ [CRON] No pending jobs to process');
      return res.json({ success: true, processed: 0 });
    }

    const job = jobResult.rows[0];
    console.log('📝 [CRON] Processing job:', {
      jobId: job.id,
      organizationId: job.organization_id,
      attempt: job.attempts
    });

    // Get organization and intelligence data
    const dataResult = await db.query(`
      SELECT
        o.id as org_id,
        oi.customer_language_patterns,
        oi.customer_scenarios,
        oi.search_behavior_insights,
        oi.seo_opportunities,
        oi.content_strategy_recommendations,
        oi.business_value_assessment,
        o.name as business_name,
        o.business_type,
        o.description,
        o.business_model,
        o.target_audience as decision_makers,
        o.target_audience as end_users,
        o.website_goals,
        o.brand_voice as search_behavior,
        o.description as content_focus,
        o.website_goals as blog_strategy
      FROM organizations o
      LEFT JOIN organization_intelligence oi ON o.id = oi.organization_id AND oi.is_current = TRUE
      WHERE o.id = $1
    `, [job.organization_id]);

    if (dataResult.rows.length === 0) {
      throw new Error('Organization not found');
    }

    const data = dataResult.rows[0];

    // Get CTAs
    const ctaResult = await db.query(
      `SELECT cta_text, cta_type, cta_href
       FROM cta_analysis
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [job.organization_id]
    );

    const storedCTAs = ctaResult.rows;

    // Prepare narrative input
    const narrativeInput = {
      businessName: data.business_name,
      businessType: data.business_type,
      description: data.description,
      businessModel: data.business_model,
      decisionMakers: data.decision_makers,
      endUsers: data.end_users,
      searchBehavior: data.search_behavior,
      contentFocus: data.content_focus,
      websiteGoals: data.website_goals,
      blogStrategy: data.blog_strategy
    };

    const intelligenceData = {
      customer_language_patterns: data.customer_language_patterns,
      customer_scenarios: data.customer_scenarios,
      search_behavior_insights: data.search_behavior_insights,
      seo_opportunities: data.seo_opportunities,
      content_strategy_recommendations: data.content_strategy_recommendations,
      business_value_assessment: data.business_value_assessment
    };

    console.log('🤖 [CRON] Generating narrative with OpenAI...');

    // Generate narrative
    const narrativeAnalysis = await openaiService.generateWebsiteAnalysisNarrative(
      narrativeInput,
      intelligenceData,
      storedCTAs
    );

    console.log('✨ [CRON] Narrative generated:', {
      hasNarrative: !!narrativeAnalysis.narrative,
      narrativeLength: narrativeAnalysis.narrative?.length || 0,
      confidence: narrativeAnalysis.confidence
    });

    // Store narrative in database
    await db.query(
      `UPDATE organization_intelligence
       SET narrative_analysis = $1,
           narrative_confidence = $2,
           key_insights = $3,
           updated_at = NOW()
       WHERE organization_id = $4 AND is_current = TRUE`,
      [
        narrativeAnalysis.narrative,
        narrativeAnalysis.confidence,
        JSON.stringify(narrativeAnalysis.keyInsights),
        job.organization_id
      ]
    );

    // Mark job as completed
    await db.query(
      `UPDATE narrative_generation_jobs
       SET status = 'completed',
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [job.id]
    );

    console.log('✅ [CRON] Job completed successfully:', job.id);

    return res.json({
      success: true,
      processed: 1,
      jobId: job.id,
      organizationId: job.organization_id
    });

  } catch (error) {
    console.error('❌ [CRON] Job processing failed:', error.message);
    console.error('❌ [CRON] Stack trace:', error.stack);

    // Update job status to failed (or pending for retry)
    if (jobResult?.rows[0]) {
      const job = jobResult.rows[0];
      const shouldRetry = job.attempts < 3;

      await db.query(
        `UPDATE narrative_generation_jobs
         SET status = $1,
             error_message = $2,
             last_error_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [
          shouldRetry ? 'pending' : 'failed',
          error.message,
          job.id
        ]
      );

      console.log(shouldRetry ?
        `⚠️ [CRON] Job will be retried (attempt ${job.attempts}/3)` :
        `❌ [CRON] Job failed permanently after ${job.attempts} attempts`
      );
    }

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
