import express from 'express';
import db from '../services/database.js';
import DatabaseAuthService from '../services/auth-database.js';
import { writeSSE } from '../utils/streaming-helpers.js';
import openaiService from '../services/openai.js';

const router = express.Router();

// Safe JSON parsing to handle corrupted database records
const safeParse = (jsonString, fieldName, recordId) => {
  if (!jsonString) return null;
  if (typeof jsonString === 'object') return jsonString; // Already parsed
  
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error(`🚨 JSON Parse Error in ${fieldName} for record ${recordId}:`, error);
    return null;
  }
};

const extractUserContext = (req) => {
  // Session: header (POST/any), body (POST), or query (GET — e.g. EventSource can't send headers)
  const sessionId = req.headers['x-session-id'] || req.body?.session_id || req.query?.sessionId || null;
  
  // Enhanced debugging for authentication issues
  console.log('🔍 extractUserContext debug (analysis):', {
    hasAuthHeader: !!req.headers.authorization,
    authHeaderStart: req.headers.authorization?.substring(0, 20),
    hasReqUser: !!req.user,
    reqUserId: req.user?.userId,
    sessionId: sessionId,
    endpoint: req.path
  });
  
  if (req.user?.userId) {
    console.log('✅ extractUserContext: Authenticated user found:', req.user.userId);
    return {
      isAuthenticated: true,
      userId: req.user.userId,
      sessionId: sessionId || null
    };
  }
  
  console.log('❌ extractUserContext: No authenticated user, falling back to session');
  return {
    isAuthenticated: false,
    userId: null,
    sessionId: sessionId || null
  };
};

const validateUserContext = (context) => {
  if (!context.isAuthenticated && !context.sessionId) {
    return {
      success: false,
      error: 'Authentication or session required',
      message: 'Either sign in or provide x-session-id so the organization can be resolved.'
    };
  }
  return null;
};

/**
 * POST /api/v1/analysis/adopt-session
 * Transfer organization intelligence data from session to authenticated user account
 */
router.post('/adopt-session', async (req, res) => {
  try {
    // Support mock user ID for testing in non-production environments
    let userId = req.user?.userId;
    
    // Check for mock user ID (for testing adoption flow)
    const mockUserId = req.headers['x-mock-user-id'];
    if (mockUserId && process.env.NODE_ENV !== 'production') {
      userId = mockUserId;
    }
    
    const { session_id } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'User must be authenticated to adopt session data'
      });
    }

    if (!session_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing session ID',
        message: 'session_id is required for adoption'
      });
    }

    console.log(`🔄 Adopting organization intelligence session ${session_id} for user ${userId}`);

    // Start transaction for atomic session adoption
    await db.query('BEGIN');

    try {
      // Use the database function to adopt organization intelligence session data
      const adoptionResult = await db.query(`
        SELECT * FROM adopt_organization_intelligence_session($1, $2)
      `, [userId, session_id]);

      // Commit the transaction
      await db.query('COMMIT');

      const adoptionData = adoptionResult.rows[0] || { 
        adopted_organizations_count: 0, 
        adopted_intelligence_count: 0,
        latest_organization_data: null,
        latest_intelligence_data: null
      };
      
      console.log(`✅ Organization intelligence session adoption completed:`, {
        organizationsAdopted: adoptionData.adopted_organizations_count,
        intelligenceRecordsAdopted: adoptionData.adopted_intelligence_count,
        hasOrgData: !!adoptionData.latest_organization_data,
        hasIntelligenceData: !!adoptionData.latest_intelligence_data
      });

      // Combine organization and intelligence data for analysis response
      const orgData = adoptionData.latest_organization_data || {};
      const intelData = adoptionData.latest_intelligence_data || {};
      
      const analysis = {
        // Organization data
        businessName: orgData.name,
        businessType: orgData.business_type,
        industryCategory: orgData.industry_category,
        businessModel: orgData.business_model,
        description: orgData.description,
        targetAudience: orgData.target_audience,
        brandVoice: orgData.brand_voice,
        websiteGoals: orgData.website_goals,
        websiteUrl: orgData.website_url,
        
        // Intelligence data  
        customerScenarios: intelData.customer_scenarios,
        businessValueAssessment: intelData.business_value_assessment,
        customerLanguagePatterns: intelData.customer_language_patterns,
        searchBehaviorInsights: intelData.search_behavior_insights,
        seoOpportunities: intelData.seo_opportunities,
        contentStrategyRecommendations: intelData.content_strategy_recommendations,
        competitiveIntelligence: intelData.competitive_intelligence,
        analysisConfidenceScore: intelData.analysis_confidence_score,
        dataSources: intelData.data_sources,
        aiModelUsed: intelData.ai_model_used,
        rawOpenaiResponse: intelData.raw_openai_response,
        isCurrent: intelData.is_current,

        // Narrative analysis
        narrative: intelData.narrative_analysis,
        narrativeConfidence: intelData.narrative_confidence,
        keyInsights: intelData.key_insights
      };

      // Format response following same pattern as other adoption endpoints
      const responseData = {
        success: true,
        message: 'Organization intelligence session data successfully adopted',
        adopted: {
          organizations: adoptionData.adopted_organizations_count,
          intelligence: adoptionData.adopted_intelligence_count
        },
        analysis
      };

      res.json(responseData);

    } catch (transactionError) {
      // Rollback on any error
      await db.query('ROLLBACK');
      throw transactionError;
    }

  } catch (error) {
    console.error('Organization intelligence session adoption error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to adopt organization intelligence session data',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/analysis/recent
 * Get user's most recent organization intelligence data
 */
router.get('/recent', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    const validationError = validateUserContext(userContext);
    if (validationError) return res.status(401).json(validationError);

    if (!userContext.isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'This endpoint requires user authentication'
      });
    }

    console.log(`📊 Getting most recent organization intelligence for user: ${userContext.userId}`);
    
    // Get most recent organization and intelligence data
    // Use a more robust query that handles missing columns gracefully
    const result = await db.query(`
      SELECT 
        o.id as org_id,
        o.name as organization_name,
        o.website_url,
        COALESCE(o.business_type, '') as business_type,
        COALESCE(o.industry_category, '') as industry_category,
        COALESCE(o.business_model, '') as business_model,
        COALESCE(o.company_size, '') as company_size,
        COALESCE(o.description, '') as description,
        COALESCE(o.target_audience, '') as target_audience,
        COALESCE(o.brand_voice, '') as brand_voice,
        COALESCE(o.website_goals, '') as website_goals,
        COALESCE(o.last_analyzed_at, o.updated_at) as last_analyzed_at,
        o.updated_at as org_updated_at,
        
        oi.customer_scenarios,
        oi.business_value_assessment,
        oi.customer_language_patterns,
        oi.search_behavior_insights,
        oi.seo_opportunities,
        oi.content_strategy_recommendations,
        oi.competitive_intelligence,
        oi.analysis_confidence_score,
        oi.data_sources,
        oi.ai_model_used,
        oi.raw_openai_response,
        oi.is_current,
        oi.created_at as intelligence_created_at,
        oi.narrative_analysis,
        oi.narrative_confidence,
        oi.key_insights
        
      FROM organizations o
      LEFT JOIN organization_intelligence oi ON o.id = oi.organization_id AND oi.is_current = TRUE
      WHERE o.owner_user_id = $1 
      ORDER BY COALESCE(o.last_analyzed_at, o.updated_at) DESC
      LIMIT 1
    `, [userContext.userId]);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        analysis: null,
        message: 'No analysis found for this user'
      });
    }
    
    const record = result.rows[0];
    
    // Build comprehensive analysis response
    const analysis = {
      // Core organization data
      websiteUrl: record.website_url,
      businessName: record.organization_name,
      businessType: record.business_type,
      industryCategory: record.industry_category,
      businessModel: record.business_model,
      companySize: record.company_size,
      description: record.description,
      targetAudience: record.target_audience,
      brandVoice: record.brand_voice,
      websiteGoals: record.website_goals,
      
      // Intelligence data (parsed JSON)
      customerScenarios: safeParse(record.customer_scenarios, 'customer_scenarios', record.org_id) || [],
      businessValueAssessment: safeParse(record.business_value_assessment, 'business_value_assessment', record.org_id) || {},
      customerLanguagePatterns: safeParse(record.customer_language_patterns, 'customer_language_patterns', record.org_id) || {},
      searchBehaviorInsights: safeParse(record.search_behavior_insights, 'search_behavior_insights', record.org_id) || {},
      seoOpportunities: safeParse(record.seo_opportunities, 'seo_opportunities', record.org_id) || {},
      contentStrategyRecommendations: safeParse(record.content_strategy_recommendations, 'content_strategy_recommendations', record.org_id) || [],
      competitiveIntelligence: safeParse(record.competitive_intelligence, 'competitive_intelligence', record.org_id) || {},

      // Narrative analysis
      narrative: record.narrative_analysis,
      narrativeConfidence: record.narrative_confidence,
      keyInsights: safeParse(record.key_insights, 'key_insights', record.org_id) || [],

      // Analysis metadata
      analysisConfidenceScore: record.analysis_confidence_score,
      dataSources: safeParse(record.data_sources, 'data_sources', record.org_id) || [],
      aiModelUsed: record.ai_model_used,
      rawOpenaiResponse: safeParse(record.raw_openai_response, 'raw_openai_response', record.org_id),
      isCurrent: record.is_current,
      lastAnalyzedAt: record.last_analyzed_at,
      updatedAt: record.org_updated_at,
      intelligenceCreatedAt: record.intelligence_created_at
    };
    
    console.log(`✅ Found recent organization intelligence: ${analysis.websiteUrl} (analyzed: ${record.last_analyzed_at})`);
    
    res.json({
      success: true,
      analysis,
      message: 'Recent organization intelligence retrieved successfully'
    });

  } catch (error) {
    console.error('Get recent organization intelligence error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve recent analysis',
      message: error.message
    });
  }
});

// Update existing website analysis data
router.put('/update', async (req, res) => {
  try {
    console.log('💾 Update analysis endpoint called');
    
    const userContext = extractUserContext(req);
    const validationError = validateUserContext(userContext);
    
    if (validationError) {
      return res.status(401).json(validationError);
    }
    
    const analysisData = req.body;
    console.log('📝 Analysis data to update:', analysisData);
    console.log('📝 Individual field values:');
    console.log('  businessName:', analysisData.businessName, '(type:', typeof analysisData.businessName, ')');
    console.log('  businessType:', analysisData.businessType, '(type:', typeof analysisData.businessType, ')');
    console.log('  websiteUrl:', analysisData.websiteUrl, '(type:', typeof analysisData.websiteUrl, ')');
    console.log('  targetAudience:', analysisData.targetAudience, '(type:', typeof analysisData.targetAudience, ')');
    console.log('  brandVoice:', analysisData.brandVoice, '(type:', typeof analysisData.brandVoice, ')');
    console.log('  description:', analysisData.description, '(type:', typeof analysisData.description, ')');
    console.log('  businessModel:', analysisData.businessModel, '(type:', typeof analysisData.businessModel, ')');
    console.log('  contentFocus:', analysisData.contentFocus, '(type:', typeof analysisData.contentFocus, ')');
    
    // Get organization ID based on user context
    let orgId;
    if (userContext.isAuthenticated) {
      // Get organization ID for authenticated user
      const orgResult = await db.query(
        'SELECT id FROM organizations WHERE owner_user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userContext.userId]
      );
      
      if (orgResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No organization found for user'
        });
      }
      
      orgId = orgResult.rows[0].id;
    } else {
      // For session users, find organization by session ID
      const orgResult = await db.query(
        'SELECT id FROM organizations WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userContext.sessionId]
      );
      
      if (orgResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No organization found for session'
        });
      }
      
      orgId = orgResult.rows[0].id;
    }
    
    // Update organization data (allow empty strings to overwrite existing values)
    const orgParams = [
      analysisData.businessName === undefined ? null : analysisData.businessName,
      analysisData.businessType === undefined ? null : analysisData.businessType,
      analysisData.websiteUrl === undefined ? null : analysisData.websiteUrl,
      analysisData.targetAudience === undefined ? null : analysisData.targetAudience,
      analysisData.brandVoice === undefined ? null : analysisData.brandVoice,
      analysisData.description === undefined ? null : analysisData.description,
      analysisData.businessModel === undefined ? null : analysisData.businessModel,
      orgId
    ];
    console.log('🔍 Organization update parameters:', orgParams);
    console.log('🔍 Parameter types:', orgParams.map((p, i) => `$${i+1}: ${p} (${typeof p})`));
    
    const updateOrgResult = await db.query(`
      UPDATE organizations 
      SET 
        name = $1,
        business_type = $2,
        website_url = $3,
        target_audience = $4,
        brand_voice = $5,
        description = $6,
        business_model = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8::uuid
      RETURNING *
    `, orgParams);
    
    // Handle contentFocus saving based on user type (save even if empty string)
    if (analysisData.contentFocus !== undefined) {
      if (userContext.isAuthenticated) {
        // For authenticated users: Update existing content_strategies or create new one
        const updateStrategyResult = await db.query(`
          UPDATE content_strategies 
          SET 
            content_focus = $2,
            updated_at = CURRENT_TIMESTAMP
          WHERE project_id = (SELECT id FROM projects WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)
          RETURNING id
        `, [userContext.userId, analysisData.contentFocus === undefined ? null : analysisData.contentFocus]);
        
        // If no existing strategy was updated, create a new one
        if (updateStrategyResult.rows.length === 0) {
          await db.query(`
            INSERT INTO content_strategies (project_id, content_focus, name, goal, voice, template, length)
            VALUES (
              (SELECT id FROM projects WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1),
              $2,
              'Website Analysis Strategy',
              'awareness',
              'expert',
              'comprehensive',
              'standard'
            )
          `, [userContext.userId, analysisData.contentFocus === undefined ? null : analysisData.contentFocus]);
        }
      } else {
        // For session users: Save to website_leads table (most recent record)
        await db.query(`
          UPDATE website_leads 
          SET 
            content_focus = $1,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = (
            SELECT id FROM website_leads 
            WHERE session_id = $2 
            ORDER BY created_at DESC 
            LIMIT 1
          )
        `, [analysisData.contentFocus === undefined ? null : analysisData.contentFocus, userContext.sessionId]);
      }
    }
    
    // Update additional fields based on user type and available data (save even if empty)
    if (analysisData.businessModel !== undefined || analysisData.websiteGoals !== undefined || analysisData.blogStrategy !== undefined) {
      if (userContext.isAuthenticated) {
        // For authenticated users: Update or create project with these fields (most recent project)
        await db.query(`
          UPDATE projects 
          SET
            business_model = $1,
            website_goals = $2,
            blog_strategy = $3,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = (
            SELECT id FROM projects 
            WHERE user_id = $4::uuid 
            ORDER BY created_at DESC 
            LIMIT 1
          )
        `, [
          analysisData.businessModel === undefined ? null : analysisData.businessModel,
          analysisData.websiteGoals === undefined ? null : analysisData.websiteGoals,
          analysisData.blogStrategy === undefined ? null : analysisData.blogStrategy,
          userContext.userId
        ]);
      }
      // Note: For session users, these fields would typically be stored in website_leads
      // but that table doesn't have these specific columns, so we skip for now
    }
    
    console.log('✅ Analysis updated successfully for org:', orgId);
    
    res.json({
      success: true,
      message: 'Website analysis updated successfully',
      organizationId: orgId
    });
    
  } catch (error) {
    console.error('❌ Update analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update analysis',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/analysis/confirm
 * Guided funnel (Issue #261): Record analysis confirmation and optional edit metadata.
 * Body: { organizationId: string, analysisConfirmed?: boolean, analysisEdited?: boolean, editedFields?: string[] }
 * Also accepts analysis field updates (businessName, targetAudience, contentFocus, etc.) to persist in one call.
 * Allowed for anonymous users: org resolved by session or by organizationId when no auth/session.
 */
router.post('/confirm', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    const {
      organizationId,
      analysisConfirmed = true,
      analysisEdited,
      editedFields,
      ...analysisUpdates
    } = req.body;

    if (!organizationId) {
      const validationError = validateUserContext(userContext);
      if (validationError) return res.status(401).json(validationError);
      return res.status(400).json({
        success: false,
        error: 'organizationId is required',
        message: 'Provide organizationId in the request body'
      });
    }

    let orgCheck;
    if (userContext.isAuthenticated) {
      orgCheck = await db.query(
        'SELECT id FROM organizations WHERE id = $1 AND owner_user_id = $2',
        [organizationId, userContext.userId]
      );
    } else if (userContext.sessionId) {
      orgCheck = await db.query(
        'SELECT id FROM organizations WHERE id = $1 AND session_id = $2',
        [organizationId, userContext.sessionId]
      );
    } else {
      orgCheck = await db.query('SELECT id FROM organizations WHERE id = $1', [organizationId]);
    }

    if (orgCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found',
        message: 'Organization not found or access denied'
      });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (analysisConfirmed === true) {
      updates.push(`analysis_confirmed_at = NOW()`);
    }
    if (typeof analysisEdited === 'boolean') {
      updates.push(`analysis_edited = $${idx++}`);
      values.push(analysisEdited);
    }
    if (Array.isArray(editedFields)) {
      updates.push(`edited_fields = $${idx++}`);
      values.push(JSON.stringify(editedFields));
    }

    if (Object.keys(analysisUpdates).length > 0) {
      const fieldMap = {
        businessName: 'name',
        businessType: 'business_type',
        websiteUrl: 'website_url',
        targetAudience: 'target_audience',
        brandVoice: 'brand_voice',
        description: 'description',
        businessModel: 'business_model'
      };
      for (const [key, dbCol] of Object.entries(fieldMap)) {
        if (analysisUpdates[key] !== undefined) {
          updates.push(`${dbCol} = $${idx++}`);
          values.push(analysisUpdates[key] === '' ? null : analysisUpdates[key]);
        }
      }
    }

    if (updates.length === 0) {
      return res.json({
        success: true,
        message: 'No updates applied',
        organizationId
      });
    }

    values.push(organizationId);
    await db.query(
      `UPDATE organizations SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
      values
    );

    res.json({
      success: true,
      message: 'Analysis confirmation and updates saved',
      organizationId
    });
  } catch (error) {
    console.error('❌ Analysis confirm error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save confirmation',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/analysis/cleaned-edit
 * Guided funnel (Issue #261): Return LLM-cleaned suggestion for user-edited analysis fields ("Apply suggestion").
 * Body: { editedFields: { businessName?: string, targetAudience?: string, contentFocus?: string, ... } }
 * Returns: { suggested: { businessName?: string, ... } }
 * Allowed for anonymous users (no auth/session required).
 */
router.post('/cleaned-edit', async (req, res) => {
  try {
    const { editedFields } = req.body;
    if (!editedFields || typeof editedFields !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'editedFields is required',
        message: 'Provide editedFields object with analysis field names and values'
      });
    }

    const openaiService = (await import('../services/openai.js')).default;
    const suggested = await openaiService.generateCleanedEdit(editedFields);

    res.json({
      success: true,
      suggested
    });
  } catch (error) {
    console.error('❌ Cleaned edit error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate cleaned suggestion',
      message: error.message
    });
  }
});

/**
 * Helper: verify organization access (owner or session) and return org row or null.
 */
async function getOrganizationForContext(organizationId, userContext) {
  if (!organizationId) return null;
  if (userContext.isAuthenticated) {
    const r = await db.query(
      'SELECT id, name, target_audience FROM organizations WHERE id = $1 AND owner_user_id = $2',
      [organizationId, userContext.userId]
    );
    return r.rows[0] || null;
  }
  if (userContext.sessionId) {
    const r = await db.query(
      'SELECT id, name, target_audience FROM organizations WHERE id = $1 AND session_id = $2',
      [organizationId, userContext.sessionId]
    );
    return r.rows[0] || null;
  }
  return null;
}

/** Helper: get org by id only (for anonymous narration — no ownership check). */
async function getOrganizationById(organizationId) {
  if (!organizationId) return null;
  const r = await db.query(
    'SELECT id, name, target_audience FROM organizations WHERE id = $1',
    [organizationId]
  );
  return r.rows[0] || null;
}

/**
 * GET /api/v1/analysis/narration/audience?organizationId=xxx
 * SSE stream: audience-narration-chunk (payload { text }), audience-narration-complete (payload { text? }).
 */
/**
 * GET /api/v1/analysis/narration/topic?organizationId=xxx&selectedAudience=...
 * SSE stream: topic-narration-chunk, topic-narration-complete.
 */
/**
 * GET /api/v1/analysis/narration/content?organizationId=xxx&selectedTopic=...
 * SSE stream: content-narration-chunk, content-narration-complete.
 */
router.get('/narration/content', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    const { organizationId, selectedTopic } = req.query;
    if (!organizationId) {
      const validationError = validateUserContext(userContext);
      if (validationError) return res.status(401).json(validationError);
      return res.status(400).json({
        success: false,
        error: 'organizationId is required',
        message: 'Provide organizationId as query parameter'
      });
    }

    let org = await getOrganizationForContext(organizationId, userContext);
    if (!org) org = await getOrganizationById(organizationId);
    if (!org) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found',
        message: 'Organization not found or access denied'
      });
    }

    const openaiService = (await import('../services/openai.js')).default;
    const fullText = await openaiService.generateContentGenerationNarration({
      businessName: org.name,
      selectedTopic: selectedTopic || 'this topic'
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const words = (fullText || '').split(/(\s+)/);
    for (const word of words) {
      if (res.writableEnded) break;
      writeSSE(res, 'content-narration-chunk', { text: word });
      if (word.trim()) await new Promise((r) => setTimeout(r, 20));
    }
    if (!res.writableEnded) writeSSE(res, 'content-narration-complete', { text: fullText || '' });
    res.end();
  } catch (error) {
    console.error('❌ Content narration error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to generate content narration',
        message: error.message
      });
    }
  }
});

/**
 * POST /api/v1/analysis/discover-content
 * Trigger comprehensive website content discovery and analysis
 */
router.post('/discover-content', async (req, res) => {
  try {
    console.log('🔍 Starting comprehensive content discovery...');
    console.log('🔧 Enhanced debugging version: 2026-01-12-v2 - with detailed scraping logs');

    console.log('🌐 [CTA DEBUG] API: Website analysis requested:', {
      organizationId: req.body.organizationId || 'Will be determined',
      websiteUrl: req.body.websiteUrl
    });

    const userContext = extractUserContext(req);
    const validationError = validateUserContext(userContext);
    if (validationError) return res.status(401).json(validationError);

    if (!userContext.isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'This endpoint requires user authentication'
      });
    }

    const { websiteUrl, forceRefresh = false } = req.body;

    if (!websiteUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing website URL',
        message: 'websiteUrl is required for content discovery'
      });
    }

    // Get organization ID
    const orgResult = await db.query(
      'SELECT id FROM organizations WHERE owner_user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userContext.userId]
    );

    if (orgResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No organization found for user'
      });
    }

    const organizationId = orgResult.rows[0].id;

    // Check if analysis already exists and is recent (unless forced refresh)
    if (!forceRefresh) {
      const existingAnalysis = await db.query(`
        SELECT * FROM content_analysis_results 
        WHERE organization_id = $1 AND is_current = TRUE AND analysis_type = 'comprehensive'
        AND created_at > NOW() - INTERVAL '24 hours'
      `, [organizationId]);

      if (existingAnalysis.rows.length > 0) {
        return res.json({
          success: true,
          message: 'Recent analysis found, use forceRefresh=true to regenerate',
          fromCache: true,
          analysis: existingAnalysis.rows[0]
        });
      }
    }

    // Import blog analyzer service
    const { default: blogAnalyzer } = await import('../services/blog-analyzer.js');

    // Perform comprehensive content analysis
    console.log(`📊 Analyzing website content: ${websiteUrl}`);
    const analysisResults = await blogAnalyzer.analyzeBlogContent(organizationId, websiteUrl);

    console.log('🌐 [CTA DEBUG] API: CTA analysis completed:', {
      organizationId,
      ctaAnalysisResult: {
        totalCTAs: analysisResults?.cta_analysis?.totalCTAs || 0,
        pagesAnalyzed: analysisResults?.cta_analysis?.pagesAnalyzed?.length || 0,
        success: !!analysisResults?.cta_analysis
      }
    });

    // Update organization's last analyzed timestamp
    await db.query(`
      UPDATE organizations SET last_analyzed_at = NOW() WHERE id = $1
    `, [organizationId]);

    console.log('✅ Content discovery completed successfully');

    console.log('✅ [CTA DEBUG] API: Website analysis response:', {
      organizationId,
      success: true,
      hasCTAData: analysisResults?.cta_analysis?.totalCTAs > 0,
      ctaCount: analysisResults?.cta_analysis?.totalCTAs || 0
    });

    console.log('🚩 [CHECKPOINT 1] Website Analysis Complete:', {
      organizationId,
      ctasExtracted: analysisResults?.cta_analysis?.totalCTAs || 0,
      ctasStored: 'Check database',
      nextStep: 'Verify cta_analysis table has rows for this org'
    });

    res.json({
      success: true,
      message: 'Website content analysis completed',
      analysis: {
        ...analysisResults,
        organizationId: organizationId  // Include organizationId in analysis object for frontend
      },
      organizationId: organizationId,  // Keep at top level for backwards compatibility
      analyzedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Content discovery error:', error);
    res.status(500).json({
      success: false,
      error: 'Content discovery failed',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/analysis/blog-content/:orgId
 * Get discovered blog posts and content for an organization
 */
router.get('/blog-content/:orgId', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    const validationError = validateUserContext(userContext);
    if (validationError) return res.status(401).json(validationError);

    if (!userContext.isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const { orgId } = req.params;
    const { limit = 20, offset = 0, pageType = 'all' } = req.query;

    console.log(`📖 Getting blog content for organization: ${orgId}`);

    // Verify organization ownership
    const orgCheck = await db.query(
      'SELECT id FROM organizations WHERE id = $1 AND owner_user_id = $2',
      [orgId, userContext.userId]
    );

    if (orgCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found or access denied'
      });
    }

    // Build query based on page type filter with enhanced classification
    let whereClause = 'WHERE organization_id = $1';
    const queryParams = [orgId];
    let paramIndex = 2;

    // Filter logic updated to use enhanced schema
    if (pageType === 'blog_post') {
      // Only show actual blog posts, not index pages
      whereClause += ` AND page_type = 'blog_post' AND COALESCE(page_classification, 'blog_post') != 'blog_index'`;
    } else if (pageType === 'blog_index') {
      // Only show blog index pages
      whereClause += ` AND (page_classification = 'blog_index' OR (page_type = 'blog_post' AND url ~ '/(blog|news|articles|posts)/?$'))`;
    } else if (pageType !== 'all') {
      whereClause += ` AND page_type = $${paramIndex}`;
      queryParams.push(pageType);
      paramIndex++;
    }

    // Get blog content with enhanced fields
    const contentQuery = `
      SELECT 
        id, url, page_type, title, 
        LEFT(content, 300) as content_preview,
        meta_description, published_date, author, word_count,
        jsonb_array_length(COALESCE(internal_links, '[]'::jsonb)) as internal_links_count,
        jsonb_array_length(COALESCE(external_links, '[]'::jsonb)) as external_links_count,
        analysis_quality_score, scraped_at,
        -- Enhanced fields
        COALESCE(page_classification, 'unknown') as page_classification,
        COALESCE(discovered_from, 'unknown') as discovered_from,
        featured_image_url, excerpt, discovery_priority, discovery_confidence,
        -- Sitemap metadata fields
        sitemap_priority, last_modified_date, sitemap_changefreq,
        -- Visual design and structure data
        visual_design, content_structure, 
        jsonb_array_length(COALESCE(ctas_extracted, '[]'::jsonb)) as ctas_count
      FROM website_pages 
      ${whereClause}
      ORDER BY 
        -- Prioritize actual blog posts over index pages
        CASE WHEN COALESCE(page_classification, 'blog_post') = 'blog_post' THEN 1 
             WHEN page_classification = 'blog_index' THEN 2 
             ELSE 3 END,
        -- Then by discovery priority and date
        COALESCE(discovery_priority, 2),
        published_date DESC NULLS LAST,
        scraped_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    queryParams.push(parseInt(limit), parseInt(offset));

    const contentResult = await db.query(contentQuery, queryParams);

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM website_pages ${whereClause}`;
    const countResult = await db.query(countQuery, queryParams.slice(0, -2));

    // Get content summary
    const summaryResult = await db.query(
      'SELECT get_website_content_summary($1) as summary',
      [orgId]
    );

    res.json({
      success: true,
      content: contentResult.rows,
      summary: summaryResult.rows[0]?.summary || {},
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + parseInt(limit) < parseInt(countResult.rows[0].total)
      }
    });

  } catch (error) {
    console.error('Blog content retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve blog content',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/analysis/cta-analysis/:orgId
 * Get CTA analysis results for an organization
 */
router.get('/cta-analysis/:orgId', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    const validationError = validateUserContext(userContext);
    if (validationError) return res.status(401).json(validationError);

    if (!userContext.isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const { orgId } = req.params;

    console.log(`🎯 Getting CTA analysis for organization: ${orgId}`);

    // Verify organization ownership
    const orgCheck = await db.query(
      'SELECT id FROM organizations WHERE id = $1 AND owner_user_id = $2',
      [orgId, userContext.userId]
    );

    if (orgCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found or access denied'
      });
    }

    // Get CTA analysis data
    const ctaQuery = `
      SELECT 
        id, page_url, cta_text, cta_type, placement, href,
        conversion_potential, visibility_score,
        improvement_suggestions, analysis_confidence,
        discovered_at
      FROM cta_analysis 
      WHERE organization_id = $1
      ORDER BY conversion_potential DESC, discovered_at DESC
    `;

    const ctaResult = await db.query(ctaQuery, [orgId]);

    // Get CTA effectiveness summary
    const summaryResult = await db.query(
      'SELECT get_cta_effectiveness_summary($1) as summary',
      [orgId]
    );

    // Group CTAs by page for better organization
    const ctasByPage = {};
    ctaResult.rows.forEach(cta => {
      if (!ctasByPage[cta.page_url]) {
        ctasByPage[cta.page_url] = [];
      }
      ctasByPage[cta.page_url].push(cta);
    });

    res.json({
      success: true,
      ctas: ctaResult.rows,
      ctasByPage,
      summary: summaryResult.rows[0]?.summary || {},
      totalCTAs: ctaResult.rows.length,
      pagesAnalyzed: Object.keys(ctasByPage).length
    });

  } catch (error) {
    console.error('CTA analysis retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve CTA analysis',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/analysis/internal-links/:orgId
 * Get internal linking analysis for an organization
 */
router.get('/internal-links/:orgId', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    const validationError = validateUserContext(userContext);
    if (validationError) return res.status(401).json(validationError);

    if (!userContext.isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const { orgId } = req.params;

    console.log(`🔗 Getting internal linking analysis for organization: ${orgId}`);

    // Verify organization ownership
    const orgCheck = await db.query(
      'SELECT id FROM organizations WHERE id = $1 AND owner_user_id = $2',
      [orgId, userContext.userId]
    );

    if (orgCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found or access denied'
      });
    }

    // Get internal linking data
    const linkingQuery = `
      SELECT 
        id, source_url, target_url, anchor_text, link_context, link_type,
        is_descriptive, seo_value, link_relevance, user_value,
        discovered_at
      FROM internal_linking_analysis 
      WHERE organization_id = $1
      ORDER BY seo_value DESC, discovered_at DESC
    `;

    const linkingResult = await db.query(linkingQuery, [orgId]);

    // Analyze linking patterns
    const linkingStats = {
      totalLinks: linkingResult.rows.length,
      byContext: {},
      byType: {},
      averageSEOValue: 0,
      descriptiveAnchors: 0
    };

    let totalSEOValue = 0;
    linkingResult.rows.forEach(link => {
      // Count by context
      linkingStats.byContext[link.link_context] = (linkingStats.byContext[link.link_context] || 0) + 1;
      
      // Count by type
      linkingStats.byType[link.link_type] = (linkingStats.byType[link.link_type] || 0) + 1;
      
      // Calculate averages
      totalSEOValue += link.seo_value || 0;
      if (link.is_descriptive) {
        linkingStats.descriptiveAnchors++;
      }
    });

    if (linkingResult.rows.length > 0) {
      linkingStats.averageSEOValue = Math.round(totalSEOValue / linkingResult.rows.length);
    }

    // Get linking recommendations based on analysis
    const recommendations = [];
    
    if (linkingStats.totalLinks < 10) {
      recommendations.push('Increase internal linking to improve SEO and user navigation');
    }
    
    if (linkingStats.averageSEOValue < 60) {
      recommendations.push('Improve anchor text quality for better SEO value');
    }
    
    if (linkingStats.descriptiveAnchors / linkingStats.totalLinks < 0.5) {
      recommendations.push('Use more descriptive anchor text instead of generic phrases');
    }

    if (!linkingStats.byType.blog || linkingStats.byType.blog < 3) {
      recommendations.push('Add more cross-links between related blog posts');
    }

    res.json({
      success: true,
      links: linkingResult.rows,
      statistics: linkingStats,
      recommendations,
      analysisDate: new Date().toISOString()
    });

  } catch (error) {
    console.error('Internal linking analysis retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve internal linking analysis',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/analysis/comprehensive-summary/:orgId
 * Get comprehensive analysis summary combining all data sources
 */
router.get('/comprehensive-summary/:orgId', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    const validationError = validateUserContext(userContext);
    if (validationError) return res.status(401).json(validationError);

    if (!userContext.isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const { orgId } = req.params;

    console.log(`📊 Getting comprehensive analysis summary for organization: ${orgId}`);

    // Verify organization ownership
    const orgCheck = await db.query(
      'SELECT id, name, website_url FROM organizations WHERE id = $1 AND owner_user_id = $2',
      [orgId, userContext.userId]
    );

    if (orgCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found or access denied'
      });
    }

    const organization = orgCheck.rows[0];

    // Get comprehensive analysis using the view
    const summaryResult = await db.query(
      'SELECT * FROM comprehensive_website_analysis_view WHERE organization_id = $1',
      [orgId]
    );

    if (summaryResult.rows.length === 0) {
      return res.json({
        success: true,
        organization,
        summary: {
          analysisCompleteness: 0,
          contentSummary: { total_pages: 0, blog_posts: 0 },
          ctaSummary: { total_ctas: 0 },
          currentAnalysis: null,
          manualUploadsCount: 0
        },
        recommendations: [
          'Start by running content discovery analysis',
          'Upload existing blog content manually if website analysis is limited',
          'Add clear CTAs to improve conversion tracking'
        ]
      });
    }

    const summary = summaryResult.rows[0];

    // Get latest analysis results
    const analysisResult = await db.query(`
      SELECT 
        analysis_type, analysis_quality_score, confidence_score,
        pages_analyzed, blog_posts_analyzed,
        tone_analysis, style_patterns, content_themes,
        cta_strategy_analysis, linking_strategy_analysis,
        content_gaps, content_opportunities,
        created_at
      FROM content_analysis_results 
      WHERE organization_id = $1 AND is_current = TRUE
      ORDER BY created_at DESC
      LIMIT 1
    `, [orgId]);

    // Generate actionable recommendations based on data
    const recommendations = [];
    
    const completenessScore = summary.analysis_completeness_score;
    
    if (completenessScore < 60) {
      recommendations.push('Run comprehensive content discovery to improve analysis quality');
    }
    
    if (summary.content_summary?.blog_posts < 3) {
      recommendations.push('Consider manual content upload to supplement automated discovery');
    }
    
    if (summary.cta_summary?.total_ctas < 5) {
      recommendations.push('Add more call-to-action elements to improve conversion opportunities');
    }

    if (analysisResult.rows.length > 0) {
      const analysis = analysisResult.rows[0];
      
      if (analysis.content_gaps && analysis.content_gaps.length > 0) {
        recommendations.push(`Address content gaps: ${analysis.content_gaps.slice(0, 2).join(', ')}`);
      }
      
      if (analysis.analysis_quality_score < 70) {
        recommendations.push('Improve content quality and depth for better analysis results');
      }
    }

    res.json({
      success: true,
      organization,
      summary: {
        analysisCompleteness: completenessScore,
        contentSummary: summary.content_summary || {},
        ctaSummary: summary.cta_summary || {},
        currentAnalysis: analysisResult.rows[0] || null,
        manualUploadsCount: summary.manual_uploads_count || 0,
        lastAnalyzed: summary.last_analyzed_at,
        lastUpdated: summary.updated_at
      },
      recommendations,
      nextSteps: completenessScore < 60 ? [
        'Run content discovery analysis',
        'Review and supplement with manual uploads',
        'Analyze conversion optimization opportunities'
      ] : [
        'Review content strategy recommendations',
        'Implement suggested improvements',
        'Monitor content performance metrics'
      ]
    });

  } catch (error) {
    console.error('Comprehensive summary retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve comprehensive summary',
      message: error.message
    });
  }
});

// Visual Design Analysis endpoint
router.get('/visual-design/:orgId', async (req, res) => {
  const { orgId } = req.params;
  
  if (!orgId) {
    return res.status(400).json({
      success: false,
      error: 'Organization ID is required'
    });
  }

  try {
    // Get visual design data from blog posts
    const designQuery = `
      SELECT 
        url, title, visual_design, content_structure,
        COALESCE(page_classification, 'unknown') as page_type,
        scraped_at
      FROM website_pages 
      WHERE organization_id = $1 
        AND visual_design IS NOT NULL
      ORDER BY scraped_at DESC
      LIMIT 20
    `;
    
    const designResult = await db.query(designQuery, [orgId]);
    
    // Aggregate design patterns
    const aggregatedDesign = {
      colorPalettes: [],
      typography: [],
      layoutPatterns: [],
      contentStructurePatterns: {},
      commonElements: {}
    };
    
    designResult.rows.forEach(row => {
      const design = row.visual_design;
      const structure = row.content_structure;
      
      if (design) {
        // Collect colors
        if (design.colors && design.colors.primary) {
          aggregatedDesign.colorPalettes.push(...design.colors.primary);
        }
        
        // Collect fonts
        if (design.typography && design.typography.fonts) {
          aggregatedDesign.typography.push(...design.typography.fonts);
        }
        
        // Collect layout info
        if (design.layout) {
          aggregatedDesign.layoutPatterns.push(design.layout);
        }
      }
      
      if (structure) {
        // Aggregate content structure patterns
        Object.keys(structure).forEach(key => {
          if (!aggregatedDesign.contentStructurePatterns[key]) {
            aggregatedDesign.contentStructurePatterns[key] = [];
          }
          aggregatedDesign.contentStructurePatterns[key].push(structure[key]);
        });
      }
    });
    
    // Deduplicate and analyze patterns
    aggregatedDesign.colorPalettes = [...new Set(aggregatedDesign.colorPalettes)].slice(0, 10);
    aggregatedDesign.typography = [...new Set(aggregatedDesign.typography)].slice(0, 8);
    
    // Calculate averages for content structure
    Object.keys(aggregatedDesign.contentStructurePatterns).forEach(key => {
      const values = aggregatedDesign.contentStructurePatterns[key];
      const numericValues = values.filter(v => typeof v === 'number');
      if (numericValues.length > 0) {
        aggregatedDesign.contentStructurePatterns[key] = {
          average: numericValues.reduce((a, b) => a + b, 0) / numericValues.length,
          min: Math.min(...numericValues),
          max: Math.max(...numericValues),
          count: numericValues.length
        };
      }
    });

    res.json({
      success: true,
      totalPages: designResult.rows.length,
      designPatterns: aggregatedDesign,
      recentAnalysis: designResult.rows.slice(0, 5).map(row => ({
        url: row.url,
        title: row.title,
        pageType: row.page_type,
        analyzedAt: row.scraped_at,
        hasDesignData: !!row.visual_design,
        hasStructureData: !!row.content_structure
      }))
    });

  } catch (error) {
    console.error('Visual design analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve visual design analysis',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/analysis/narration/analysis?organizationId=xxx
 * SSE stream for analysis completion narration (Issue #303)
 */
router.get('/narration/analysis', async (req, res) => {
  console.log('\n🚀 [ENDPOINT] /narration/analysis called');
  try {
    const { organizationId } = req.query;
    console.log('📥 [ENDPOINT] Request params:', { organizationId });

    if (!organizationId) {
      console.log('❌ [ENDPOINT] Missing organizationId');
      return res.status(400).json({
        success: false,
        error: 'organizationId is required'
      });
    }

    // Get user context for auth
    const userContext = extractUserContext(req);
    console.log('🔐 [ENDPOINT] User context:', {
      isAuthenticated: userContext.isAuthenticated,
      hasUserId: !!userContext.userId,
      hasSessionId: !!userContext.sessionId
    });

    // Support token-based auth for EventSource
    if (req.query.token && !userContext.isAuthenticated) {
      try {
        const token = String(req.query.token).trim();
        const authService = new DatabaseAuthService();
        const decoded = authService.verifyToken(token);
        if (decoded?.userId) {
          userContext.userId = decoded.userId;
          userContext.isAuthenticated = true;
          console.log('✅ [ENDPOINT] Token auth successful');
        }
      } catch (err) {
        console.warn('⚠️ [ENDPOINT] Token validation failed:', err.message);
      }
    }

    // Verify access to organization
    const orgQuery = userContext.isAuthenticated
      ? 'SELECT * FROM organizations WHERE id = $1 AND owner_user_id = $2'
      : 'SELECT * FROM organizations WHERE id = $1 AND session_id = $2';

    const queryParams = [
      organizationId,
      userContext.isAuthenticated ? userContext.userId : userContext.sessionId
    ];

    console.log('🔍 [ENDPOINT] Querying organization with:', {
      query: orgQuery,
      params: queryParams,
      authType: userContext.isAuthenticated ? 'user' : 'session'
    });

    const orgResult = await db.query(orgQuery, queryParams);
    console.log('📊 [ENDPOINT] Query result:', {
      rowCount: orgResult.rows.length,
      foundOrg: orgResult.rows.length > 0
    });

    if (orgResult.rows.length === 0) {
      console.log('❌ [ENDPOINT] Organization not found or access denied');

      // Debug: try to find org without session restriction
      const debugQuery = 'SELECT id, name, session_id, owner_user_id FROM organizations WHERE id = $1';
      const debugResult = await db.query(debugQuery, [organizationId]);
      console.log('🔍 [ENDPOINT] Debug - Organization exists?', {
        found: debugResult.rows.length > 0,
        orgData: debugResult.rows[0] || null
      });

      return res.status(404).json({
        success: false,
        error: 'Organization not found or access denied'
      });
    }

    const org = orgResult.rows[0];
    console.log('✅ [ENDPOINT] Organization found:', {
      name: org.name,
      type: org.business_type,
      industry: org.industry_category
    });

    // Get RICH analysis data
    const intelQuery = `
      SELECT
        narrative_analysis,
        key_insights,
        customer_scenarios,
        business_value_assessment,
        customer_language_patterns,
        seo_opportunities,
        analysis_confidence_score
      FROM organization_intelligence
      WHERE organization_id = $1 AND is_current = TRUE
      LIMIT 1
    `;
    console.log('🔍 [ENDPOINT] Querying organization_intelligence...');
    const intelResult = await db.query(intelQuery, [organizationId]);
    const analysisData = intelResult.rows[0] || {};
    console.log('📊 [ENDPOINT] Analysis data retrieved:', {
      hasNarrative: !!analysisData.narrative_analysis,
      hasKeyInsights: !!analysisData.key_insights,
      hasCustomerScenarios: !!analysisData.customer_scenarios,
      hasBusinessValue: !!analysisData.business_value_assessment,
      confidenceScore: analysisData.analysis_confidence_score
    });

    // Set up SSE
    console.log('📡 [ENDPOINT] Setting up SSE...');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    if (res.socket?.setNoDelay) res.socket.setNoDelay(true);

    writeSSE(res, 'connected', { organizationId });
    console.log('✅ [ENDPOINT] SSE connected event sent');

    // Generate and stream narration
    console.log('🎙️ [ENDPOINT] Generating narration...');
    const { generateAnalysisNarration, streamTextAsChunks } =
      await import('../services/narration-generator.js');

    const narrationText = await generateAnalysisNarration({
      organizationId,
      businessName: org.name,
      businessType: org.business_type,
      industryCategory: org.industry_category,
      orgDescription: org.description,
      analysisData: {
        narrative: analysisData.narrative_analysis,
        keyInsights: analysisData.key_insights,
        customerScenarios: analysisData.customer_scenarios,
        businessValue: analysisData.business_value_assessment,
        confidenceScore: analysisData.analysis_confidence_score
      }
    });

    console.log('✅ [ENDPOINT] Narration generated, starting stream...');
    console.log('📝 [ENDPOINT] Narration text:', narrationText);

    // Stream text word by word
    await streamTextAsChunks(narrationText, async (chunk) => {
      if (!res.writableEnded) {
        writeSSE(res, 'analysis-chunk', { text: chunk });
      }
    }, 50);

    console.log('✅ [ENDPOINT] Streaming complete');

    // Send complete event
    if (!res.writableEnded) {
      writeSSE(res, 'analysis-complete', { text: '' });
    }

    // Extract and stream business profile for PowerPoint-style display
    console.log('📊 [ENDPOINT-PROFILE] Extracting business profile...');

    // Get CTAs from database
    const ctaQuery = `
      SELECT cta_text, href, cta_type, page_url
      FROM cta_analysis
      WHERE organization_id = $1
      ORDER BY conversion_potential DESC
      LIMIT 10
    `;
    const ctaResult = await db.query(ctaQuery, [organizationId]);
    const ctas = ctaResult.rows.map(cta => ({
      text: cta.cta_text,
      url: cta.href || cta.page_url,
      type: cta.cta_type
    }));

    const businessProfile = {
      businessName: org.name || 'Business Name',
      domain: org.website_url || '',
      tagline: org.business_type || 'Business Type',
      whatTheyDo: org.description || 'No description available',
      targetAudience: org.target_audience || 'Not specified',
      brandVoice: org.brand_voice || 'Professional',
      contentFocus: org.content_focus || analysisData.customer_language_patterns?.tone || 'Content strategy',
      ctas: ctas.length > 0 ? ctas : [],
      businessModel: org.business_model || 'Not specified',
      websiteGoals: org.website_goals || 'Not specified',
      blogStrategy: analysisData.customer_language_patterns?.content_preferences?.join(', ') || 'Not specified',
      keyTopics: analysisData.seo_opportunities || null
    };

    console.log('📊 [ENDPOINT-PROFILE] Business profile extracted:', JSON.stringify(businessProfile, null, 2));

    // Stream business profile event
    if (!res.writableEnded) {
      console.log('📊 [ENDPOINT-PROFILE] Streaming business profile...');
      writeSSE(res, 'business-profile', { content: JSON.stringify(businessProfile) });
      console.log('📊 [ENDPOINT-PROFILE] Business profile event sent');

      res.end();
      console.log('✅ [ENDPOINT] Connection closed');
    }

  } catch (error) {
    console.error('❌ [ENDPOINT] Analysis narration stream error:', error);
    console.error('❌ [ENDPOINT] Error stack:', error.stack);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to stream analysis narration',
        message: error.message
      });
    }
  }
});

/**
 * GET /api/v1/analysis/narration/audience?organizationId=xxx
 * SSE stream for audience selection narration (Issue #303)
 */
router.get('/narration/audience', async (req, res) => {
  try {
    const { organizationId } = req.query;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'organizationId is required'
      });
    }

    // Get user context for auth
    const userContext = extractUserContext(req);

    // Support token-based auth for EventSource
    if (req.query.token && !userContext.isAuthenticated) {
      try {
        const token = String(req.query.token).trim();
        const authService = new DatabaseAuthService();
        const decoded = authService.verifyToken(token);
        if (decoded?.userId) {
          userContext.userId = decoded.userId;
          userContext.isAuthenticated = true;
        }
      } catch (err) {
        console.warn('Token validation failed:', err.message);
      }
    }

    // Verify access to organization
    const orgQuery = userContext.isAuthenticated
      ? 'SELECT * FROM organizations WHERE id = $1 AND owner_user_id = $2'
      : 'SELECT * FROM organizations WHERE id = $1 AND session_id = $2';

    const orgResult = await db.query(orgQuery, [
      organizationId,
      userContext.isAuthenticated ? userContext.userId : userContext.sessionId
    ]);

    if (orgResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found or access denied'
      });
    }

    const org = orgResult.rows[0];
    console.log('✅ [ENDPOINT] Organization found:', {
      name: org.name,
      type: org.business_type
    });

    // Get RICH analysis data including audience summaries
    const intelQuery = `
      SELECT
        narrative_analysis,
        key_insights,
        customer_scenarios,
        business_value_assessment
      FROM organization_intelligence
      WHERE organization_id = $1 AND is_current = TRUE
      LIMIT 1
    `;
    console.log('🔍 [ENDPOINT] Querying organization_intelligence...');
    const intelResult = await db.query(intelQuery, [organizationId]);
    const analysisData = intelResult.rows[0] || {};
    console.log('📊 [ENDPOINT] Analysis data retrieved:', {
      hasNarrative: !!analysisData.narrative_analysis,
      hasKeyInsights: !!analysisData.key_insights,
      hasCustomerScenarios: !!analysisData.customer_scenarios,
      hasBusinessValue: !!analysisData.business_value_assessment
    });

    // Get audience summaries (problems and value)
    const audiencesWhereCondition = userContext.isAuthenticated
      ? 'user_id = $1'
      : 'session_id = $1';
    const audiencesQueryParam = userContext.isAuthenticated
      ? org.owner_user_id
      : org.session_id;

    const audiencesQuery = `
      SELECT
        target_segment,
        customer_problem,
        business_value,
        pitch,
        conversion_score
      FROM audiences
      WHERE ${audiencesWhereCondition}
      ORDER BY conversion_score DESC
      LIMIT 5
    `;
    console.log('🔍 [ENDPOINT] Querying audiences with:', {
      whereCondition: audiencesWhereCondition,
      param: audiencesQueryParam
    });
    const audiencesResult = await db.query(audiencesQuery, [audiencesQueryParam]);
    const audiences = audiencesResult.rows || [];
    console.log('👥 [ENDPOINT] Audiences retrieved:', {
      count: audiences.length,
      hasProblems: audiences.filter(a => a.customer_problem).length
    });

    // Set up SSE
    console.log('📡 [ENDPOINT] Setting up SSE...');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    if (res.socket?.setNoDelay) res.socket.setNoDelay(true);

    writeSSE(res, 'connected', { organizationId });
    console.log('✅ [ENDPOINT] SSE connected event sent');

    // Generate and stream narration using contextual function from openai.js
    console.log('🎙️ [ENDPOINT] Generating audience narration...');
    console.log('🔍 [DEBUG] openaiService type:', typeof openaiService);
    console.log('🔍 [DEBUG] Has generateAudienceNarrative:', typeof openaiService.generateAudienceNarrative);
    console.log('🔍 [DEBUG] Constructor:', openaiService.constructor.name);

    // Prepare analysis data for the narrative generator
    const analysisForNarrative = {
      businessName: org.name,
      businessType: org.business_type,
      description: org.description,
      contentFocus: org.content_focus || 'content'
    };

    // Prepare audiences in the format expected by the narrative generator
    const audiencesForNarrative = audiences.map(a => ({
      audienceName: a.target_segment,
      name: a.target_segment,
      description: a.customer_problem,
      scenario: a.customer_problem,
      value: a.business_value,
      pitch: a.pitch
    }));

    const narrationText = await openaiService.generateAudienceNarrative(
      analysisForNarrative,
      audiencesForNarrative
    );

    console.log('✅ [ENDPOINT] Narration generated, starting stream...');
    console.log('📝 [ENDPOINT] Narration text:', narrationText);

    // Stream text word by word (using simple split logic instead of importing streamTextAsChunks)
    const words = narrationText.split(' ');
    for (let i = 0; i < words.length; i++) {
      const chunk = i === 0 ? words[i] : ' ' + words[i];
      if (!res.writableEnded) {
        writeSSE(res, 'audience-chunk', { text: chunk });
        if (i < words.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }

    console.log('✅ [ENDPOINT] Streaming complete');

    // Send complete event
    if (!res.writableEnded) {
      writeSSE(res, 'audience-complete', { text: '' });
      res.end();
      console.log('✅ [ENDPOINT] Complete event sent, connection closed');
    }

  } catch (error) {
    console.error('Audience narration stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to stream audience narration',
        message: error.message
      });
    }
  }
});

/**
 * GET /api/v1/analysis/narration/topic?organizationId=xxx&selectedAudience=yyy
 * SSE stream for topic selection narration (Issue #303)
 */
router.get('/narration/topic', async (req, res) => {
  try {
    const { organizationId, selectedAudience } = req.query;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'organizationId is required'
      });
    }

    // Get user context for auth (same pattern as audience)
    const userContext = extractUserContext(req);

    if (req.query.token && !userContext.isAuthenticated) {
      try {
        const token = String(req.query.token).trim();
        const authService = new DatabaseAuthService();
        const decoded = authService.verifyToken(token);
        if (decoded?.userId) {
          userContext.userId = decoded.userId;
          userContext.isAuthenticated = true;
        }
      } catch (err) {
        console.warn('Token validation failed:', err.message);
      }
    }

    // Verify access
    const orgQuery = userContext.isAuthenticated
      ? 'SELECT * FROM organizations WHERE id = $1 AND owner_user_id = $2'
      : 'SELECT * FROM organizations WHERE id = $1 AND session_id = $2';

    const orgResult = await db.query(orgQuery, [
      organizationId,
      userContext.isAuthenticated ? userContext.userId : userContext.sessionId
    ]);

    if (orgResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found or access denied'
      });
    }

    const org = orgResult.rows[0];
    console.log('✅ [ENDPOINT] Organization found:', {
      name: org.name,
      type: org.business_type
    });

    // Get FULL audience record for selected audience
    let audienceData = {};
    if (selectedAudience) {
      console.log('🔍 [ENDPOINT] Querying audience for:', selectedAudience);

      const audienceWhereCondition = userContext.isAuthenticated
        ? 'user_id = $1'
        : 'session_id = $1';
      const audienceQueryParam = userContext.isAuthenticated
        ? org.owner_user_id
        : org.session_id;

      const audienceQuery = `
        SELECT
          target_segment,
          customer_problem,
          customer_language,
          business_value,
          pitch,
          conversion_path,
          projected_profit_low,
          projected_profit_high,
          conversion_score
        FROM audiences
        WHERE ${audienceWhereCondition} AND target_segment::text ILIKE $2
        LIMIT 1
      `;
      console.log('🔍 [ENDPOINT] Audience query:', {
        whereCondition: audienceWhereCondition,
        param: audienceQueryParam,
        selectedAudience
      });
      const audienceResult = await db.query(audienceQuery, [
        audienceQueryParam,
        `%${selectedAudience}%`
      ]);
      audienceData = audienceResult.rows[0] || {};
      console.log('📊 [ENDPOINT] Audience data retrieved:', {
        found: !!audienceData.target_segment,
        hasProblem: !!audienceData.customer_problem,
        hasPitch: !!audienceData.pitch,
        hasBusinessValue: !!audienceData.business_value
      });
    } else {
      console.log('⚠️ [ENDPOINT] No selectedAudience provided');
    }

    // Set up SSE
    console.log('📡 [ENDPOINT] Setting up SSE...');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    if (res.socket?.setNoDelay) res.socket.setNoDelay(true);

    writeSSE(res, 'connected', { organizationId });
    console.log('✅ [ENDPOINT] SSE connected event sent');

    // Generate and stream narration using contextual function from openai.js
    console.log('🎙️ [ENDPOINT] Generating topic narration...');

    // Prepare analysis data for the narrative generator
    const analysisForNarrative = {
      businessName: org.name,
      businessType: org.business_type,
      description: org.description,
      contentFocus: org.content_focus || 'content'
    };

    // Prepare selected audience in the format expected by the narrative generator
    const selectedAudienceForNarrative = audienceData.target_segment ? {
      audienceName: audienceData.target_segment,
      name: audienceData.target_segment,
      description: audienceData.customer_problem,
      scenario: audienceData.customer_problem,
      value: audienceData.business_value,
      pitch: audienceData.pitch
    } : null;

    const narrationText = await openaiService.generateTopicNarrative(
      analysisForNarrative,
      selectedAudienceForNarrative,
      [] // Empty topics array for initial narrative
    );

    console.log('✅ [ENDPOINT] Narration generated, starting stream...');
    console.log('📝 [ENDPOINT] Narration text:', narrationText);

    // Stream text word by word (using simple split logic instead of importing streamTextAsChunks)
    const words = narrationText.split(' ');
    for (let i = 0; i < words.length; i++) {
      const chunk = i === 0 ? words[i] : ' ' + words[i];
      if (!res.writableEnded) {
        writeSSE(res, 'topic-chunk', { text: chunk });
        if (i < words.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }

    console.log('✅ [ENDPOINT] Streaming complete');

    // Send complete event
    if (!res.writableEnded) {
      writeSSE(res, 'topic-complete', { text: '' });
      res.end();
      console.log('✅ [ENDPOINT] Complete event sent, connection closed');
    }

  } catch (error) {
    console.error('Topic narration stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to stream topic narration',
        message: error.message
      });
    }
  }
});

/**
 * GET /api/v1/analysis/narration/content?organizationId=xxx&selectedTopic=yyy
 * SSE stream for content narration (Issue #303) - Future use
 */
router.get('/narration/content', async (req, res) => {
  try {
    const { organizationId, selectedTopic } = req.query;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'organizationId is required'
      });
    }

    // Get user context (same auth pattern)
    const userContext = extractUserContext(req);

    if (req.query.token && !userContext.isAuthenticated) {
      try {
        const token = String(req.query.token).trim();
        const authService = new DatabaseAuthService();
        const decoded = authService.verifyToken(token);
        if (decoded?.userId) {
          userContext.userId = decoded.userId;
          userContext.isAuthenticated = true;
        }
      } catch (err) {
        console.warn('Token validation failed:', err.message);
      }
    }

    // Verify access
    const orgQuery = userContext.isAuthenticated
      ? 'SELECT * FROM organizations WHERE id = $1 AND owner_user_id = $2'
      : 'SELECT * FROM organizations WHERE id = $1 AND session_id = $2';

    const orgResult = await db.query(orgQuery, [
      organizationId,
      userContext.isAuthenticated ? userContext.userId : userContext.sessionId
    ]);

    if (orgResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found or access denied'
      });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    if (res.socket?.setNoDelay) res.socket.setNoDelay(true);

    writeSSE(res, 'connected', { organizationId });

    // Generate and stream narration
    const { generateContentNarration, streamTextAsChunks } =
      await import('../services/narration-generator.js');

    const narrationText = await generateContentNarration({
      selectedTopic: selectedTopic ? { title: selectedTopic } : null
    });

    // Stream text word by word
    await streamTextAsChunks(narrationText, async (chunk) => {
      if (!res.writableEnded) {
        writeSSE(res, 'content-chunk', { text: chunk });
      }
    }, 50);

    // Send complete event
    if (!res.writableEnded) {
      writeSSE(res, 'content-complete', { text: '' });
      res.end();
    }

  } catch (error) {
    console.error('Content narration stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to stream content narration',
        message: error.message
      });
    }
  }
});

export default router;