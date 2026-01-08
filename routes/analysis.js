import express from 'express';
import db from '../services/database.js';

const router = express.Router();

// Logging middleware for all analysis routes
router.use((req, res, next) => {
  console.log('📊 Analysis Router Request:', {
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    baseUrl: req.baseUrl,
    timestamp: new Date().toISOString(),
    hasAuth: !!req.headers.authorization,
    hasSessionId: !!req.headers['x-session-id'],
    userAgent: req.headers['user-agent']?.substring(0, 50) || 'unknown'
  });
  next();
});

// Test endpoint to verify router is working
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Analysis router is working',
    timestamp: new Date().toISOString(),
    path: req.path,
    baseUrl: req.baseUrl,
    originalUrl: req.originalUrl
  });
});

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
    console.log('🔍 /adopt-session endpoint called:', {
      hasReqUser: !!req.user,
      userId: req.user?.userId,
      headers: {
        authorization: req.headers.authorization ? 'Bearer ***' : 'none',
        'x-session-id': req.headers['x-session-id'] || 'none',
        'x-mock-user-id': req.headers['x-mock-user-id'] || 'none'
      },
      body: req.body,
      path: req.path,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl
    });

    // Support mock user ID for testing in non-production environments
    let userId = req.user?.userId;
    
    // Check for mock user ID (for testing adoption flow)
    const mockUserId = req.headers['x-mock-user-id'];
    if (mockUserId && process.env.NODE_ENV !== 'production') {
      userId = mockUserId;
      console.log(`🧪 Using mock user ID for testing: ${mockUserId}`);
    }
    
    const { session_id } = req.body;

    console.log('🔍 Authentication check:', {
      userId: userId,
      hasUserId: !!userId,
      sessionId: session_id,
      hasSessionId: !!session_id
    });

    if (!userId) {
      console.log('❌ Authentication required - no user ID found');
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'User must be authenticated to adopt session data'
      });
    }

    if (!session_id) {
      console.log('❌ Missing session ID in request body');
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
    console.error('❌ Organization intelligence session adoption error:', {
      message: error.message,
      stack: error.stack,
      userId: req.user?.userId,
      sessionId: req.body?.session_id,
      endpoint: '/adopt-session'
    });
    res.status(500).json({
      success: false,
      error: 'Failed to adopt organization intelligence session data',
      message: error.message,
      debug: {
        endpoint: '/adopt-session',
        timestamp: new Date().toISOString()
      }
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
    const result = await db.query(`
      SELECT 
        o.id as org_id,
        o.name as organization_name,
        o.website_url,
        o.business_type,
        o.industry_category,
        o.business_model,
        o.company_size,
        o.description,
        o.target_audience,
        o.brand_voice,
        o.website_goals,
        o.search_behavior_summary,
        o.last_analyzed_at,
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
      ORDER BY o.last_analyzed_at DESC NULLS LAST, o.updated_at DESC
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
      searchBehavior: record.search_behavior_summary,
      
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
    console.error('❌ Get recent organization intelligence error:', {
      message: error.message,
      stack: error.stack,
      userId: req.user?.userId,
      endpoint: '/recent'
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve recent analysis',
      message: error.message,
      debug: {
        endpoint: '/recent',
        timestamp: new Date().toISOString()
      }
    });
  }
});

export default router;