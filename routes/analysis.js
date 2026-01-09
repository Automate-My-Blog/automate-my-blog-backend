import express from 'express';
import db from '../services/database.js';

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
  const sessionId = req.headers['x-session-id'] || req.body?.session_id;
  
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
    throw new Error('Either authentication or session ID is required');
  }
  console.log('✅ validateUserContext passed:', {
    isAuthenticated: context.isAuthenticated,
    hasSessionId: !!context.sessionId,
    userId: context.userId
  });
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
        isCurrent: intelData.is_current
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
    validateUserContext(userContext);
    
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
        oi.created_at as intelligence_created_at
        
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
    const updateOrgResult = await db.query(`
      UPDATE organizations 
      SET 
        name = CASE WHEN $1 IS NOT NULL THEN $1 ELSE name END,
        business_type = CASE WHEN $2 IS NOT NULL THEN $2 ELSE business_type END,
        website_url = CASE WHEN $3 IS NOT NULL THEN $3 ELSE website_url END,
        target_audience = CASE WHEN $4 IS NOT NULL THEN $4 ELSE target_audience END,
        brand_voice = CASE WHEN $5 IS NOT NULL THEN $5 ELSE brand_voice END,
        description = CASE WHEN $6 IS NOT NULL THEN $6 ELSE description END,
        business_model = CASE WHEN $7 IS NOT NULL THEN $7 ELSE business_model END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8
      RETURNING *
    `, [
      analysisData.businessName || null,
      analysisData.businessType || null, 
      analysisData.websiteUrl || null,
      analysisData.targetAudience || null,
      analysisData.brandVoice || null,
      analysisData.description || null,
      analysisData.businessModel || null,
      orgId
    ]);
    
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
        `, [userContext.userId, analysisData.contentFocus || null]);
        
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
          `, [userContext.userId, analysisData.contentFocus || null]);
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
        `, [analysisData.contentFocus || null, userContext.sessionId]);
      }
    }
    
    // Update additional fields based on user type and available data (save even if empty)
    if (analysisData.businessModel !== undefined || analysisData.websiteGoals !== undefined || analysisData.blogStrategy !== undefined) {
      if (userContext.isAuthenticated) {
        // For authenticated users: Update or create project with these fields (most recent project)
        await db.query(`
          UPDATE projects 
          SET
            business_model = CASE WHEN $1 IS NOT NULL THEN $1 ELSE business_model END,
            website_goals = CASE WHEN $2 IS NOT NULL THEN $2 ELSE website_goals END,
            blog_strategy = CASE WHEN $3 IS NOT NULL THEN $3 ELSE blog_strategy END,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = (
            SELECT id FROM projects 
            WHERE user_id = $4 
            ORDER BY created_at DESC 
            LIMIT 1
          )
        `, [
          analysisData.businessModel || null,
          analysisData.websiteGoals || null,
          analysisData.blogStrategy || null,
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

export default router;