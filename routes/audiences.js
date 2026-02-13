import express from 'express';
import db from '../services/database.js';
import openaiService from '../services/openai.js';

const router = express.Router();

// Safe JSON parsing to handle corrupted database records with monitoring
const safeParse = (jsonString, fieldName, recordId) => {
  if (!jsonString) return null;
  if (typeof jsonString === 'object') return jsonString; // Already parsed
  
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    // Enhanced logging for corruption detection
    const corruptionAlert = {
      alert_type: 'JSON_PARSE_ERROR',
      field_name: fieldName,
      record_id: recordId,
      error_message: error.message,
      raw_value: jsonString,
      value_type: typeof jsonString,
      timestamp: new Date().toISOString(),
      is_corruption: jsonString && jsonString.includes('[object Object]'),
      corruption_patterns: {
        contains_object_object: jsonString && jsonString.includes('[object Object]'),
        contains_general_audience: jsonString && jsonString.includes('General Audience'),
        is_empty_object: jsonString === '{}',
        is_null_string: jsonString === 'null'
      }
    };
    
    console.error(`🚨 CORRUPTION DETECTED - JSON Parse Error:`, corruptionAlert);
    
    // If this looks like serious corruption, also log to a structured format
    if (corruptionAlert.is_corruption) {
      console.error(`🔥 SERIOUS CORRUPTION ALERT:`, JSON.stringify({
        severity: 'HIGH',
        component: 'audience_data_parsing',
        ...corruptionAlert
      }));
    }
    
    // Return a fallback object instead of failing
    return fieldName === 'target_segment' 
      ? { demographics: 'Data parsing error', psychographics: 'Please recreate audience', searchBehavior: 'N/A' }
      : null;
  }
};

const isDev = process.env.NODE_ENV !== 'production';

const extractUserContext = (req) => {
  const sessionId = req.headers['x-session-id'] || req.body?.session_id;

  if (isDev) {
    console.log('🔍 extractUserContext debug:', {
      hasAuthHeader: !!req.headers.authorization,
      authHeaderStart: req.headers.authorization?.substring(0, 20),
      hasReqUser: !!req.user,
      reqUserKeys: req.user ? Object.keys(req.user) : [],
      reqUserId: req.user?.userId,
      sessionId: sessionId,
      endpoint: req.path
    });
  }

  // Check for mock user ID (for testing session adoption flow)
  const mockUserId = req.headers['x-mock-user-id'];
  if (mockUserId && process.env.NODE_ENV !== 'production') {
    return {
      isAuthenticated: true,
      userId: mockUserId,
      sessionId: sessionId || null
    };
  }

  if (req.user?.userId) {
    if (isDev) console.log('✅ extractUserContext: Authenticated user found:', req.user.userId);
    return {
      isAuthenticated: true,
      userId: req.user.userId,
      sessionId: sessionId || null // Keep session ID even when authenticated for adoption
    };
  }

  if (isDev) console.log('❌ extractUserContext: No authenticated user, falling back to session');
  return {
    isAuthenticated: false,
    userId: null,
    sessionId: sessionId || null
  };
};

const AUTH_REQUIRED_MSG = 'Either authentication or session ID is required';

/**
 * POST /api/v1/audiences/generate-stream (Phase 3)
 * Stream audience scenarios. Body: { analysis, existingAudiences? }.
 * Returns 200 { connectionId }. Client then opens GET /api/v1/stream/:connectionId?token= (EventSource).
 * Events: audience-complete, complete, error.
 */
router.post('/generate-stream', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    validateUserContext(userContext);

    const { analysis, existingAudiences: bodyExistingAudiences } = req.body;
    if (!analysis || typeof analysis !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Missing analysis',
        message: 'analysis (website analysis object from analyze-website) is required'
      });
    }

    let existingAudiences = Array.isArray(bodyExistingAudiences) ? bodyExistingAudiences : [];
    if (existingAudiences.length === 0) {
      try {
        const whereClause = userContext.userId
          ? 'WHERE user_id = $1'
          : 'WHERE session_id = $1';
        const queryParam = userContext.userId || userContext.sessionId;
        const result = await db.query(
          `SELECT target_segment, customer_problem FROM audiences ${whereClause} ORDER BY created_at DESC`,
          [queryParam]
        );
        existingAudiences = result.rows;
      } catch (e) {
        console.warn('Failed to load existing audiences for stream:', e?.message);
      }
    }

    const { v4: uuidv4 } = await import('uuid');
    const connectionId = uuidv4();

    setImmediate(() => {
      openaiService.generateAudienceScenariosStream(analysis, '', '', existingAudiences, connectionId).catch((err) =>
        console.error('audiences generate-stream error:', err)
      );
    });

    res.status(200).json({ connectionId });
  } catch (error) {
    if (error.message === AUTH_REQUIRED_MSG) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: error.message
      });
    }
    console.error('audiences generate-stream endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start stream',
      message: error.message
    });
  }
});

const validateUserContext = (context) => {
  if (!context.isAuthenticated && !context.sessionId) {
    throw new Error(AUTH_REQUIRED_MSG);
  }
  if (isDev) {
    console.log('✅ validateUserContext passed:', {
      isAuthenticated: context.isAuthenticated,
      hasSessionId: !!context.sessionId,
      userId: context.userId
    });
  }
};

// Validation function to prevent data corruption with monitoring
const validateAudienceData = (data) => {
  const errors = [];
  const suspiciousPatterns = [];

  // Validate target_segment
  if (data.target_segment !== undefined) {
    if (!data.target_segment) {
      errors.push('target_segment is required');
    } else if (typeof data.target_segment === 'string') {
      // Check for corruption patterns with monitoring
      if (data.target_segment === '[object Object]' || data.target_segment.includes('[object Object]')) {
        errors.push('target_segment contains corrupted data: "[object Object]"');
        suspiciousPatterns.push({
          field: 'target_segment',
          pattern: '[object Object]',
          severity: 'CRITICAL',
          value: data.target_segment
        });
      }
      
      // Try to parse if it's a JSON string
      try {
        const parsed = JSON.parse(data.target_segment);
        if (typeof parsed !== 'object' || parsed === null) {
          errors.push('target_segment must be an object');
        } else {
          // Validate required structure
          if (!parsed.demographics || !parsed.psychographics || !parsed.searchBehavior) {
            errors.push('target_segment must contain demographics, psychographics, and searchBehavior fields');
          }
        }
      } catch (error) {
        errors.push(`target_segment contains invalid JSON: ${error.message}`);
      }
    } else if (typeof data.target_segment === 'object') {
      // Validate object structure
      if (!data.target_segment.demographics || !data.target_segment.psychographics || !data.target_segment.searchBehavior) {
        errors.push('target_segment must contain demographics, psychographics, and searchBehavior fields');
      }
    } else {
      errors.push('target_segment must be an object or valid JSON string');
    }
  }

  // Validate customer_language if provided
  if (data.customer_language !== undefined && data.customer_language !== null) {
    if (typeof data.customer_language === 'string') {
      if (data.customer_language === '[object Object]' || data.customer_language.includes('[object Object]')) {
        errors.push('customer_language contains corrupted data: "[object Object]"');
        suspiciousPatterns.push({
          field: 'customer_language',
          pattern: '[object Object]',
          severity: 'CRITICAL',
          value: data.customer_language
        });
      }
      
      // Try to parse if it's a JSON string
      try {
        const parsed = JSON.parse(data.customer_language);
        if (typeof parsed !== 'object' || parsed === null) {
          errors.push('customer_language must be an object');
        }
      } catch (error) {
        errors.push(`customer_language contains invalid JSON: ${error.message}`);
      }
    } else if (typeof data.customer_language !== 'object') {
      errors.push('customer_language must be an object or valid JSON string');
    }
  }

  // Validate business_value if provided
  if (data.business_value !== undefined && data.business_value !== null) {
    if (typeof data.business_value === 'string') {
      if (data.business_value === '[object Object]' || data.business_value.includes('[object Object]')) {
        errors.push('business_value contains corrupted data: "[object Object]"');
        suspiciousPatterns.push({
          field: 'business_value',
          pattern: '[object Object]',
          severity: 'CRITICAL',
          value: data.business_value
        });
      }
      
      // Try to parse if it's a JSON string
      try {
        const parsed = JSON.parse(data.business_value);
        if (typeof parsed !== 'object' || parsed === null) {
          errors.push('business_value must be an object');
        }
      } catch (error) {
        errors.push(`business_value contains invalid JSON: ${error.message}`);
      }
    } else if (typeof data.business_value !== 'object') {
      errors.push('business_value must be an object or valid JSON string');
    }
  }

  // Log any suspicious patterns found for monitoring
  if (suspiciousPatterns.length > 0) {
    console.error(`🚨 CORRUPTION PATTERNS DETECTED IN VALIDATION:`, {
      timestamp: new Date().toISOString(),
      patterns: suspiciousPatterns,
      total_patterns: suspiciousPatterns.length,
      validation_errors: errors.length,
      component: 'audience_data_validation'
    });
    
    // Log critical patterns in structured format for monitoring systems
    suspiciousPatterns.filter(p => p.severity === 'CRITICAL').forEach(pattern => {
      console.error(`🔥 CRITICAL CORRUPTION PATTERN:`, JSON.stringify({
        severity: 'CRITICAL',
        component: 'audience_data_validation',
        field: pattern.field,
        pattern: pattern.pattern,
        timestamp: new Date().toISOString()
      }));
    });
  }

  return errors;
};

// Helper function to automatically adopt session data for authenticated users
const attemptSessionAdoption = async (userContext) => {
  const adoptionId = `adoption_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
  
  if (!userContext.isAuthenticated || !userContext.sessionId) {
    console.log(`🔍 [${adoptionId}] Session adoption skipped: authenticated=${userContext.isAuthenticated}, sessionId=${userContext.sessionId}`);
    return { adopted: false, reason: 'No session to adopt or user not authenticated' };
  }

  try {
    console.log(`🔄 [${adoptionId}] Attempting automatic session adoption for user ${userContext.userId}, session ${userContext.sessionId}`);

    // ENHANCED: Verify user exists in database first
    const userExistsCheck = await db.query('SELECT id FROM users WHERE id = $1', [userContext.userId]);
    if (userExistsCheck.rows.length === 0) {
      console.error(`❌ [${adoptionId}] CRITICAL: User ${userContext.userId} does not exist in database - cannot adopt session data`);
      return { adopted: false, reason: 'User does not exist in database' };
    }
    console.log(`✅ [${adoptionId}] User ${userContext.userId} exists in database`);

    // Check if there's any session data to adopt
    const sessionDataCheck = await db.query(`
      SELECT COUNT(*) as audience_count, 
             string_agg(id::text, ', ') as audience_ids
      FROM audiences 
      WHERE session_id = $1
    `, [userContext.sessionId]);

    const sessionAudienceCount = parseInt(sessionDataCheck.rows[0].audience_count);
    const audienceIds = sessionDataCheck.rows[0].audience_ids;
    console.log(`📊 [${adoptionId}] Found ${sessionAudienceCount} audience(s) for session ${userContext.sessionId}:`, audienceIds);
    
    if (sessionAudienceCount === 0) {
      return { adopted: false, reason: 'No session data found to adopt' };
    }

    // Check if user already has data (to avoid unnecessary adoption)
    const userDataCheck = await db.query(`
      SELECT COUNT(*) as user_audience_count,
             string_agg(id::text, ', ') as user_audience_ids
      FROM audiences 
      WHERE user_id = $1
    `, [userContext.userId]);

    const userAudienceCount = parseInt(userDataCheck.rows[0].user_audience_count);
    const userAudienceIds = userDataCheck.rows[0].user_audience_ids;
    console.log(`📊 [${adoptionId}] User ${userContext.userId} currently has ${userAudienceCount} audience(s):`, userAudienceIds);
    
    if (userAudienceCount > 0) {
      return { adopted: false, reason: 'User already has audience data, skipping adoption' };
    }

    // ENHANCED: Start transaction for atomic operation
    console.log(`🔄 [${adoptionId}] Starting transaction for session adoption...`);
    await db.query('BEGIN');

    try {
      // Perform automatic session adoption
      const adoptionResult = await db.query(`
        UPDATE audiences 
        SET user_id = $1, session_id = NULL, updated_at = NOW()
        WHERE session_id = $2
        RETURNING id, target_segment, customer_problem, priority
      `, [userContext.userId, userContext.sessionId]);

      console.log(`🔍 [${adoptionId}] Adoption UPDATE query affected ${adoptionResult.rows.length} rows`);

      if (adoptionResult.rows.length !== sessionAudienceCount) {
        console.error(`⚠️ [${adoptionId}] Adoption count mismatch: expected ${sessionAudienceCount}, got ${adoptionResult.rows.length}`);
      }

      // Verify adoption was successful
      const verificationCheck = await db.query(`
        SELECT COUNT(*) as adopted_count
        FROM audiences 
        WHERE user_id = $1 AND session_id IS NULL
      `, [userContext.userId]);

      const adoptedCount = parseInt(verificationCheck.rows[0].adopted_count);
      console.log(`🔍 [${adoptionId}] Verification: User now has ${adoptedCount} audiences after adoption`);

      // Commit transaction
      await db.query('COMMIT');
      console.log(`✅ [${adoptionId}] Transaction committed successfully`);

      return {
        adopted: true,
        audiencesAdopted: adoptionResult.rows.length,
        reason: 'Session data successfully adopted automatically'
      };

    } catch (transactionError) {
      await db.query('ROLLBACK');
      console.error(`❌ [${adoptionId}] Transaction rolled back due to error:`, transactionError);
      throw transactionError;
    }

  } catch (error) {
    console.error(`❌ [${adoptionId}] Automatic session adoption failed:`, {
      message: error.message,
      code: error.code,
      constraint: error.constraint,
      detail: error.detail
    });
    
    // Check if it's a foreign key constraint error (user doesn't exist)
    if (error.code === '23503' && error.constraint === 'audiences_user_id_fkey') {
      console.error(`🚨 [${adoptionId}] Foreign key constraint violation: User ${userContext.userId} does not exist in users table`);
      return { adopted: false, reason: 'Adoption failed: User does not exist in database' };
    }
    
    return { adopted: false, reason: `Adoption failed: ${error.message}` };
  }
};

router.post('/', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    validateUserContext(userContext);

    // Debug logging for audience creation
    console.log('🎯 Creating audience with data:', {
      userContext: { 
        isAuthenticated: userContext.isAuthenticated, 
        userId: userContext.userId, 
        sessionId: userContext.sessionId 
      },
      bodyKeys: Object.keys(req.body),
      target_segment_type: typeof req.body.target_segment,
      customer_language_type: typeof req.body.customer_language,
      business_value_type: typeof req.body.business_value
    });

    const {
      organization_intelligence_id,
      project_id,
      target_segment,
      customer_problem,
      customer_language,
      conversion_path,
      business_value,
      priority = 1,
      pitch,
      image_url
    } = req.body;

    // Validate input data to prevent corruption
    const validationErrors = validateAudienceData({
      target_segment,
      customer_language,
      business_value
    });

    if (validationErrors.length > 0) {
      console.warn('🚨 Validation failed for audience data:', {
        errors: validationErrors,
        userContext,
        requestBody: {
          target_segment_type: typeof target_segment,
          customer_language_type: typeof customer_language,
          business_value_type: typeof business_value
        }
      });

      return res.status(400).json({
        success: false,
        error: 'Invalid input data',
        message: 'Data validation failed',
        details: validationErrors
      });
    }

    // Enhanced safe JSON stringification with corruption detection
    const safeStringify = (obj, fieldName) => {
      if (obj === null || obj === undefined) return null;
      
      // If it's already a string, validate and process
      if (typeof obj === 'string') {
        // Detect corruption patterns
        if (obj === '[object Object]' || obj.includes('[object Object]')) {
          console.error(`🚨 Corruption detected in ${fieldName}:`, obj);
          throw new Error(`Corrupted data detected in ${fieldName}: Contains "[object Object]" pattern`);
        }
        
        try {
          // Try to parse it to see if it's already valid JSON
          JSON.parse(obj);
          return obj; // It's already valid JSON string
        } catch {
          // Not valid JSON, so stringify it to make it a valid JSON string
          return JSON.stringify(obj);
        }
      }
      
      // For objects, check for corruption patterns before stringifying
      if (typeof obj === 'object') {
        const stringified = JSON.stringify(obj);
        
        // Check if JSON.stringify resulted in corruption
        if (stringified === '{}' && Object.keys(obj).length > 0) {
          console.error(`🚨 Object stringification failure for ${fieldName}:`, obj);
          throw new Error(`Failed to properly stringify object for ${fieldName}`);
        }
        
        // Check for [object Object] pattern in result
        if (stringified.includes('[object Object]')) {
          console.error(`🚨 Stringified object contains corruption in ${fieldName}:`, stringified);
          throw new Error(`Stringified object contains "[object Object]" pattern in ${fieldName}`);
        }
        
        return stringified;
      }
      
      try {
        const result = JSON.stringify(obj);
        
        // Final check for corruption in result
        if (result.includes('[object Object]')) {
          console.error(`🚨 Final result contains corruption in ${fieldName}:`, result);
          throw new Error(`JSON stringify result contains "[object Object]" pattern in ${fieldName}`);
        }
        
        return result;
      } catch (error) {
        console.error(`JSON stringify error for ${fieldName}:`, error);
        console.error(`Value causing error:`, obj);
        throw new Error(`Invalid JSON data for ${fieldName}: ${error.message}`);
      }
    };

    const audienceData = {
      user_id: userContext.userId,
      session_id: userContext.sessionId,
      project_id,
      organization_intelligence_id,
      target_segment: safeStringify(target_segment, 'target_segment'),
      customer_problem,
      customer_language: safeStringify(customer_language, 'customer_language'),
      conversion_path,
      business_value: safeStringify(business_value, 'business_value'),
      priority,
      pitch,
      image_url: image_url || null,
      // Profit metrics (extracted by OpenAI service)
      projected_revenue_low: req.body.projected_revenue_low || null,
      projected_revenue_high: req.body.projected_revenue_high || null,
      projected_profit_low: req.body.projected_profit_low || null,
      projected_profit_high: req.body.projected_profit_high || null,
      profit_margin_percent: req.body.profit_margin_percent || null,
      price_per_unit: req.body.price_per_unit || null,
      unit_type: req.body.unit_type || 'consultation'
    };

    const result = await db.query(`
      INSERT INTO audiences (
        user_id, session_id, project_id, organization_intelligence_id,
        target_segment, customer_problem, customer_language,
        conversion_path, business_value, priority, pitch, image_url,
        projected_revenue_low, projected_revenue_high,
        projected_profit_low, projected_profit_high,
        profit_margin_percent, price_per_unit, unit_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [
      audienceData.user_id,
      audienceData.session_id,
      audienceData.project_id,
      audienceData.organization_intelligence_id,
      audienceData.target_segment,
      audienceData.customer_problem,
      audienceData.customer_language,
      audienceData.conversion_path,
      audienceData.business_value,
      audienceData.priority,
      audienceData.pitch,
      audienceData.image_url,
      audienceData.projected_revenue_low,
      audienceData.projected_revenue_high,
      audienceData.projected_profit_low,
      audienceData.projected_profit_high,
      audienceData.profit_margin_percent,
      audienceData.price_per_unit,
      audienceData.unit_type
    ]);

    const audience = result.rows[0];

    res.status(201).json({
      success: true,
      audience: {
        id: audience.id,
        user_id: audience.user_id,
        session_id: audience.session_id,
        project_id: audience.project_id,
        organization_intelligence_id: audience.organization_intelligence_id,
        target_segment: safeParse(audience.target_segment, 'target_segment_response', audience.id),
        customer_problem: audience.customer_problem,
        customer_language: safeParse(audience.customer_language, 'customer_language_response', audience.id),
        conversion_path: audience.conversion_path,
        business_value: safeParse(audience.business_value, 'business_value_response', audience.id),
        priority: audience.priority,
        pitch: audience.pitch,
        created_at: audience.created_at,
        updated_at: audience.updated_at
      }
    });

  } catch (error) {
    if (error.message === AUTH_REQUIRED_MSG) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication or session ID (x-session-id header) is required'
      });
    }
    console.error('Create audience error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create audience',
      message: error.message
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    validateUserContext(userContext);

    // Debug logging for audience retrieval
    console.log('📖 Getting audiences with context:', {
      userContext: { 
        isAuthenticated: userContext.isAuthenticated, 
        userId: userContext.userId, 
        sessionId: userContext.sessionId 
      },
      queryParams: req.query,
      headers: {
        mockUserId: req.headers['x-mock-user-id'],
        sessionId: req.headers['x-session-id']
      }
    });

    // CRITICAL DEBUG: Compare with /me endpoint user ID
    if (userContext.isAuthenticated) {
      console.log('🔍 AUDIENCES endpoint - User ID comparison:', {
        audienceUserId: userContext.userId,
        reqUserUserId: req.user?.userId,
        userIdsMatch: userContext.userId === req.user?.userId,
        authHeaderPresent: !!req.headers.authorization
      });
      
      // Check if this user exists in database for audience queries
      const userExistsCheck = await db.query('SELECT id, email FROM users WHERE id = $1', [userContext.userId]);
      console.log('🔍 AUDIENCES endpoint - User exists in database check:', {
        requestUserId: userContext.userId,
        userFoundInDb: userExistsCheck.rows.length > 0,
        dbUserData: userExistsCheck.rows[0] || 'NOT_FOUND'
      });
    }

    // Attempt automatic session adoption for authenticated users
    let adoptionResult = null;
    console.log(`🔍 Checking adoption conditions: isAuthenticated=${userContext.isAuthenticated}, sessionId=${userContext.sessionId}`);
    
    if (userContext.isAuthenticated && userContext.sessionId) {
      console.log(`🚀 Starting session adoption process...`);
      adoptionResult = await attemptSessionAdoption(userContext);
      console.log(`🔍 DEBUG: Adoption result:`, adoptionResult);
      if (adoptionResult.adopted) {
        console.log(`🎯 Session data automatically adopted: ${adoptionResult.reason}`);
      } else {
        console.log(`⚠️ Session adoption skipped: ${adoptionResult.reason}`);
      }
    } else {
      console.log(`❌ Session adoption conditions not met`);
    }

    const { organization_intelligence_id, project_id, limit = 25, offset = 0 } = req.query;

    let whereConditions = [];
    let queryParams = [];
    let paramIndex = 1;

    if (userContext.isAuthenticated) {
      whereConditions.push(`a.user_id = $${paramIndex}`);
      queryParams.push(userContext.userId);
      paramIndex++;
    } else {
      whereConditions.push(`a.session_id = $${paramIndex}`);
      queryParams.push(userContext.sessionId);
      paramIndex++;
    }

    if (organization_intelligence_id) {
      whereConditions.push(`a.organization_intelligence_id = $${paramIndex}`);
      queryParams.push(organization_intelligence_id);
      paramIndex++;
    }

    if (project_id) {
      whereConditions.push(`a.project_id = $${paramIndex}`);
      queryParams.push(project_id);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    const fullQuery = `
      SELECT 
        a.*,
        COUNT(sk.id) as keywords_count,
        COUNT(ct.id) as topics_count
      FROM audiences a
      LEFT JOIN seo_keywords sk ON a.id = sk.audience_id
      LEFT JOIN content_topics ct ON a.id = ct.audience_id
      ${whereClause}
      GROUP BY a.id
      ORDER BY a.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    // Debug: Log exact query being executed
    console.log('🗃️ Executing query:', {
      query: fullQuery,
      params: [...queryParams, parseInt(limit), parseInt(offset)],
      whereClause: whereClause,
      userContext: userContext
    });

    const result = await db.query(fullQuery, [...queryParams, parseInt(limit), parseInt(offset)]);

    // Debug logging for raw database results
    console.log('📊 Database query returned:', {
      rowCount: result.rows.length
    });

    // CRITICAL DEBUG: If no results, check what data actually exists for this user
    if (result.rows.length === 0 && userContext.isAuthenticated) {
      console.log('🔍 ZERO RESULTS - Investigating what data exists for user:');
      
      // Check all audiences for this user (ignore session_id)
      const allUserAudiences = await db.query(`
        SELECT id, user_id, session_id, customer_problem, created_at,
               target_segment::text as target_segment_text
        FROM audiences 
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [userContext.userId]);
      
      console.log('🔍 All audiences for user:', {
        userId: userContext.userId,
        totalAudiences: allUserAudiences.rows.length,
        audiences: allUserAudiences.rows
      });
      
      // Check if session still has data
      if (userContext.sessionId) {
        const sessionAudiences = await db.query(`
          SELECT id, user_id, session_id, customer_problem, created_at
          FROM audiences 
          WHERE session_id = $1
        `, [userContext.sessionId]);
        
        console.log('🔍 Remaining session audiences:', {
          sessionId: userContext.sessionId,
          sessionAudiences: sessionAudiences.rows.length,
          audiences: sessionAudiences.rows
        });
      }
    }
    
    // Log each individual record to identify corrupted data
    result.rows.forEach((row, index) => {
      console.log(`📝 Record ${index + 1}/${result.rows.length}:`, {
        id: row.id,
        user_id: row.user_id,
        session_id: row.session_id,
        customer_problem: row.customer_problem,
        target_segment_type: typeof row.target_segment,
        target_segment_preview: String(row.target_segment).substring(0, 100),
        created_at: row.created_at,
        isGenericAudience: String(row.target_segment).includes('General Audience')
      });
    });

    // Using safeParse function defined at top of file

    const audiences = result.rows.map(row => ({
      id: row.id,
      target_segment: safeParse(row.target_segment, 'target_segment', row.id),
      customer_problem: row.customer_problem,
      priority: row.priority,
      pitch: row.pitch,
      topics_count: parseInt(row.topics_count),
      keywords_count: parseInt(row.keywords_count),
      content_calendar_generated_at: row.content_calendar_generated_at,
      has_content_calendar: Array.isArray(row.content_ideas) && row.content_ideas.length > 0,
      created_at: row.created_at
    }));

    const response = {
      success: true,
      audiences,
      total: audiences.length
    };

    // Include adoption information if it occurred
    if (adoptionResult && adoptionResult.adopted) {
      response.sessionAdoption = {
        adopted: true,
        audiencesAdopted: adoptionResult.audiencesAdopted,
        message: 'Your previous session data has been automatically saved to your account'
      };
    }

    res.json(response);

  } catch (error) {
    if (error.message === AUTH_REQUIRED_MSG) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication or session ID (x-session-id header) is required'
      });
    }
    console.error('Get audiences error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve audiences',
      message: error.message
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    validateUserContext(userContext);
    const { id } = req.params;

    let whereCondition = 'a.id = $1';
    let queryParams = [id];
    
    if (userContext.isAuthenticated) {
      whereCondition += ' AND a.user_id = $2';
      queryParams.push(userContext.userId);
    } else {
      whereCondition += ' AND a.session_id = $2';
      queryParams.push(userContext.sessionId);
    }

    const audienceResult = await db.query(`
      SELECT * FROM audiences a WHERE ${whereCondition}
    `, queryParams);

    if (audienceResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Audience not found',
        message: 'The requested audience does not exist or you do not have access to it'
      });
    }

    const audience = audienceResult.rows[0];

    const topicsResult = await db.query(`
      SELECT id, title, description, category
      FROM content_topics 
      WHERE audience_id = $1
      ORDER BY created_at DESC
    `, [id]);

    const keywordsResult = await db.query(`
      SELECT id, keyword, search_volume, competition, relevance_score
      FROM seo_keywords 
      WHERE audience_id = $1
      ORDER BY relevance_score DESC
    `, [id]);

    const contentIdeas = audience.content_ideas != null
      ? (typeof audience.content_ideas === 'string' ? (() => { try { return JSON.parse(audience.content_ideas); } catch { return null; } })() : audience.content_ideas)
      : null;

    res.json({
      success: true,
      audience: {
        id: audience.id,
        target_segment: safeParse(audience.target_segment, 'target_segment_get', audience.id),
        customer_problem: audience.customer_problem,
        customer_language: safeParse(audience.customer_language, 'customer_language_get', audience.id),
        conversion_path: audience.conversion_path,
        business_value: safeParse(audience.business_value, 'business_value_get', audience.id),
        priority: audience.priority,
        pitch: audience.pitch,
        content_ideas: contentIdeas,
        content_calendar_generated_at: audience.content_calendar_generated_at,
        created_at: audience.created_at,
        updated_at: audience.updated_at,
        topics: topicsResult.rows,
        keywords: keywordsResult.rows
      }
    });

  } catch (error) {
    if (error.message === AUTH_REQUIRED_MSG) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication or session ID (x-session-id header) is required'
      });
    }
    console.error('Get audience error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve audience',
      message: error.message
    });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    validateUserContext(userContext);
    const { id } = req.params;

    let whereCondition = 'id = $1';
    let queryParams = [id];
    
    if (userContext.isAuthenticated) {
      whereCondition += ' AND user_id = $2';
      queryParams.push(userContext.userId);
    } else {
      whereCondition += ' AND session_id = $2';
      queryParams.push(userContext.sessionId);
    }

    const existingResult = await db.query(`
      SELECT id FROM audiences WHERE ${whereCondition}
    `, queryParams);

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Audience not found',
        message: 'The requested audience does not exist or you do not have access to it'
      });
    }

    const {
      target_segment,
      customer_problem,
      customer_language,
      conversion_path,
      business_value,
      priority,
      pitch
    } = req.body;

    // Validate input data to prevent corruption
    const validationErrors = validateAudienceData({
      target_segment,
      customer_language,
      business_value
    });

    if (validationErrors.length > 0) {
      console.warn('🚨 PUT validation failed for audience data:', {
        errors: validationErrors,
        audienceId: id,
        userContext,
        requestBody: {
          target_segment_type: typeof target_segment,
          customer_language_type: typeof customer_language,
          business_value_type: typeof business_value
        }
      });

      return res.status(400).json({
        success: false,
        error: 'Invalid input data',
        message: 'Data validation failed',
        details: validationErrors
      });
    }

    const updates = [];
    const updateValues = [id];
    let paramIndex = 2;

    // Enhanced safe JSON stringification (same as POST route)
    const safeStringifyUpdate = (obj, fieldName) => {
      if (obj === null || obj === undefined) return null;
      
      // If it's already a string, validate and process
      if (typeof obj === 'string') {
        // Detect corruption patterns
        if (obj === '[object Object]' || obj.includes('[object Object]')) {
          console.error(`🚨 Corruption detected in ${fieldName}:`, obj);
          throw new Error(`Corrupted data detected in ${fieldName}: Contains "[object Object]" pattern`);
        }
        
        try {
          // Try to parse it to see if it's already valid JSON
          JSON.parse(obj);
          return obj; // It's already valid JSON string
        } catch {
          // Not valid JSON, so stringify it to make it a valid JSON string
          return JSON.stringify(obj);
        }
      }
      
      // For objects, check for corruption patterns before stringifying
      if (typeof obj === 'object') {
        const stringified = JSON.stringify(obj);
        
        // Check if JSON.stringify resulted in corruption
        if (stringified === '{}' && Object.keys(obj).length > 0) {
          console.error(`🚨 Object stringification failure for ${fieldName}:`, obj);
          throw new Error(`Failed to properly stringify object for ${fieldName}`);
        }
        
        // Check for [object Object] pattern in result
        if (stringified.includes('[object Object]')) {
          console.error(`🚨 Stringified object contains corruption in ${fieldName}:`, stringified);
          throw new Error(`Stringified object contains "[object Object]" pattern in ${fieldName}`);
        }
        
        return stringified;
      }
      
      try {
        const result = JSON.stringify(obj);
        
        // Final check for corruption in result
        if (result.includes('[object Object]')) {
          console.error(`🚨 Final result contains corruption in ${fieldName}:`, result);
          throw new Error(`JSON stringify result contains "[object Object]" pattern in ${fieldName}`);
        }
        
        return result;
      } catch (error) {
        console.error(`JSON stringify error for ${fieldName}:`, error);
        console.error(`Value causing error:`, obj);
        throw new Error(`Invalid JSON data for ${fieldName}: ${error.message}`);
      }
    };

    if (target_segment !== undefined) {
      updates.push(`target_segment = $${paramIndex}`);
      updateValues.push(safeStringifyUpdate(target_segment, 'target_segment'));
      paramIndex++;
    }

    if (customer_problem !== undefined) {
      updates.push(`customer_problem = $${paramIndex}`);
      updateValues.push(customer_problem);
      paramIndex++;
    }

    if (customer_language !== undefined) {
      updates.push(`customer_language = $${paramIndex}`);
      updateValues.push(customer_language ? safeStringifyUpdate(customer_language, 'customer_language') : null);
      paramIndex++;
    }

    if (conversion_path !== undefined) {
      updates.push(`conversion_path = $${paramIndex}`);
      updateValues.push(conversion_path);
      paramIndex++;
    }

    if (business_value !== undefined) {
      updates.push(`business_value = $${paramIndex}`);
      updateValues.push(business_value ? safeStringifyUpdate(business_value, 'business_value') : null);
      paramIndex++;
    }

    if (priority !== undefined) {
      updates.push(`priority = $${paramIndex}`);
      updateValues.push(priority);
      paramIndex++;
    }

    if (pitch !== undefined) {
      updates.push(`pitch = $${paramIndex}`);
      updateValues.push(pitch);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No updates provided',
        message: 'At least one field must be provided for update'
      });
    }

    updates.push('updated_at = NOW()');

    const result = await db.query(`
      UPDATE audiences 
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *
    `, updateValues);

    const audience = result.rows[0];

    res.json({
      success: true,
      audience: {
        id: audience.id,
        target_segment: safeParse(audience.target_segment, 'target_segment_update', audience.id),
        customer_problem: audience.customer_problem,
        customer_language: safeParse(audience.customer_language, 'customer_language_update', audience.id),
        conversion_path: audience.conversion_path,
        business_value: safeParse(audience.business_value, 'business_value_update', audience.id),
        priority: audience.priority,
        pitch: audience.pitch,
        created_at: audience.created_at,
        updated_at: audience.updated_at
      }
    });

  } catch (error) {
    if (error.message === AUTH_REQUIRED_MSG) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication or session ID (x-session-id header) is required'
      });
    }
    console.error('Update audience error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update audience',
      message: error.message
    });
  }
});

// Admin endpoint to clean up corrupted data and related records
router.delete('/cleanup-corrupted', async (req, res) => {
  try {
    console.log('🧹 Starting comprehensive cleanup of corrupted audience data and related records (ADMIN ENDPOINT)');

    // Start transaction for atomic cleanup
    await db.query('BEGIN');

    try {
      // Step 1: Find corrupted audience records
      const corruptedAudiences = await db.query(`
        SELECT id, user_id, session_id, target_segment, customer_problem, created_at
        FROM audiences 
        WHERE target_segment::text LIKE '%General Audience%' 
           OR target_segment::text LIKE '%[object Object]%'
           OR target_segment::text = '"[object Object]"'
           OR (target_segment IS NOT NULL AND target_segment::text !~ '^{.*}$')
      `);

      const corruptedAudienceIds = corruptedAudiences.rows.map(row => row.id);

      console.log('🔍 Found corrupted audience records:', {
        count: corruptedAudiences.rows.length,
        audienceIds: corruptedAudienceIds,
        records: corruptedAudiences.rows.map(row => ({
          id: row.id,
          user_id: row.user_id,
          session_id: row.session_id,
          customer_problem: row.customer_problem,
          target_segment_preview: String(row.target_segment).substring(0, 50) + '...'
        }))
      });

      let cleanupResults = {
        audiencesDeleted: 0,
        keywordsDeleted: 0,
        topicsOrphaned: 0,
        strategiesOrphaned: 0,
        orphanedTopicsDeleted: 0,
        orphanedStrategiesDeleted: 0
      };

      if (corruptedAudienceIds.length > 0) {
        // Step 2: Check related records before cleanup
        const relatedKeywords = await db.query(`
          SELECT COUNT(*) as count FROM seo_keywords 
          WHERE audience_id = ANY($1)
        `, [corruptedAudienceIds]);

        const relatedTopics = await db.query(`
          SELECT COUNT(*) as count FROM content_topics 
          WHERE audience_id = ANY($1)
        `, [corruptedAudienceIds]);

        const relatedStrategies = await db.query(`
          SELECT COUNT(*) as count FROM content_strategies 
          WHERE audience_id = ANY($1)
        `, [corruptedAudienceIds]);

        console.log('📊 Related records found:', {
          keywords: parseInt(relatedKeywords.rows[0].count),
          topics: parseInt(relatedTopics.rows[0].count),
          strategies: parseInt(relatedStrategies.rows[0].count)
        });

        // Step 3: Delete corrupted audiences (CASCADE will handle keywords)
        const deleteAudiencesResult = await db.query(`
          DELETE FROM audiences 
          WHERE target_segment::text LIKE '%General Audience%' 
             OR target_segment::text LIKE '%[object Object]%'
             OR target_segment::text = '"[object Object]"'
             OR (target_segment IS NOT NULL AND target_segment::text !~ '^{.*}$')
        `);

        cleanupResults.audiencesDeleted = deleteAudiencesResult.rowCount;
        cleanupResults.keywordsDeleted = parseInt(relatedKeywords.rows[0].count); // CASCADE deleted
        cleanupResults.topicsOrphaned = parseInt(relatedTopics.rows[0].count); // SET NULL
        cleanupResults.strategiesOrphaned = parseInt(relatedStrategies.rows[0].count); // SET NULL

        console.log('🗑️ Deleted corrupted audiences (CASCADE handled keywords):', {
          audiencesDeleted: cleanupResults.audiencesDeleted,
          keywordsCascadeDeleted: cleanupResults.keywordsDeleted
        });
      }

      // Step 4: Clean up orphaned content_topics (audience_id = NULL)
      const orphanedTopicsResult = await db.query(`
        DELETE FROM content_topics 
        WHERE audience_id IS NULL
      `);

      cleanupResults.orphanedTopicsDeleted = orphanedTopicsResult.rowCount;

      // Step 5: Clean up orphaned content_strategies (audience_id = NULL)  
      const orphanedStrategiesResult = await db.query(`
        DELETE FROM content_strategies 
        WHERE audience_id IS NULL
      `);

      cleanupResults.orphanedStrategiesDeleted = orphanedStrategiesResult.rowCount;

      console.log('🧽 Cleaned up orphaned records:', {
        orphanedTopicsDeleted: cleanupResults.orphanedTopicsDeleted,
        orphanedStrategiesDeleted: cleanupResults.orphanedStrategiesDeleted
      });

      // Step 6: Check for any remaining data integrity issues
      const integrityCheck = await db.query(`
        SELECT 
          (SELECT COUNT(*) FROM audiences WHERE target_segment::text LIKE '%[object Object]%') as remaining_corrupted,
          (SELECT COUNT(*) FROM content_topics WHERE audience_id IS NULL) as orphaned_topics,
          (SELECT COUNT(*) FROM content_strategies WHERE audience_id IS NULL) as orphaned_strategies,
          (SELECT COUNT(*) FROM seo_keywords sk LEFT JOIN audiences a ON sk.audience_id = a.id WHERE a.id IS NULL) as orphaned_keywords
      `);

      const integrityData = integrityCheck.rows[0];

      // Commit transaction
      await db.query('COMMIT');

      console.log('✅ Comprehensive cleanup completed:', {
        ...cleanupResults,
        integrityCheck: {
          remainingCorrupted: parseInt(integrityData.remaining_corrupted),
          orphanedTopics: parseInt(integrityData.orphaned_topics),
          orphanedStrategies: parseInt(integrityData.orphaned_strategies), 
          orphanedKeywords: parseInt(integrityData.orphaned_keywords)
        }
      });

      res.json({
        success: true,
        message: 'Comprehensive cleanup completed successfully',
        cleanupResults,
        corruptedAudiencesFound: corruptedAudiences.rows.length,
        integrityCheck: {
          remainingCorrupted: parseInt(integrityData.remaining_corrupted),
          orphanedTopics: parseInt(integrityData.orphaned_topics),
          orphanedStrategies: parseInt(integrityData.orphaned_strategies),
          orphanedKeywords: parseInt(integrityData.orphaned_keywords)
        },
        cleanedRecords: corruptedAudiences.rows
      });

    } catch (cleanupError) {
      // Rollback transaction on error
      await db.query('ROLLBACK');
      throw cleanupError;
    }

  } catch (error) {
    if (error.message === AUTH_REQUIRED_MSG) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication or session ID (x-session-id header) is required'
      });
    }
    console.error('Comprehensive cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform comprehensive cleanup',
      message: error.message
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    validateUserContext(userContext);
    const { id } = req.params;

    let whereCondition = 'id = $1';
    let queryParams = [id];
    
    if (userContext.isAuthenticated) {
      whereCondition += ' AND user_id = $2';
      queryParams.push(userContext.userId);
    } else {
      whereCondition += ' AND session_id = $2';
      queryParams.push(userContext.sessionId);
    }

    const result = await db.query(`
      DELETE FROM audiences WHERE ${whereCondition}
      RETURNING id
    `, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Audience not found',
        message: 'The requested audience does not exist or you do not have access to it'
      });
    }

    res.json({
      success: true,
      message: 'Audience deleted successfully'
    });

  } catch (error) {
    if (error.message === AUTH_REQUIRED_MSG) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication or session ID (x-session-id header) is required'
      });
    }
    console.error('Delete audience error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete audience',
      message: error.message
    });
  }
});

export default router;