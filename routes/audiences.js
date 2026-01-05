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
    console.error(`JSON parse error for ${fieldName} in record ${recordId}:`, {
      error: error.message,
      rawValue: jsonString,
      valueType: typeof jsonString
    });
    // Return a fallback object instead of failing
    return fieldName === 'target_segment' 
      ? { demographics: 'Data parsing error', psychographics: 'Please recreate audience', searchBehavior: 'N/A' }
      : null;
  }
};

const extractUserContext = (req) => {
  if (req.user?.userId) {
    return {
      isAuthenticated: true,
      userId: req.user.userId,
      sessionId: null
    };
  }
  
  const sessionId = req.headers['x-session-id'] || req.body?.session_id;
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
      priority = 1
    } = req.body;

    if (!target_segment) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field',
        message: 'target_segment is required'
      });
    }

    // Safe JSON stringification with error handling
    const safeStringify = (obj, fieldName) => {
      if (obj === null || obj === undefined) return null;
      if (typeof obj === 'string') return obj;
      
      try {
        return JSON.stringify(obj);
      } catch (error) {
        console.error(`JSON stringify error for ${fieldName}:`, error);
        console.error(`Value causing error:`, obj);
        throw new Error(`Invalid JSON data for ${fieldName}`);
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
      priority
    };

    const result = await db.query(`
      INSERT INTO audiences (
        user_id, session_id, project_id, organization_intelligence_id,
        target_segment, customer_problem, customer_language, 
        conversion_path, business_value, priority
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      audienceData.priority
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
        created_at: audience.created_at,
        updated_at: audience.updated_at
      }
    });

  } catch (error) {
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
      queryParams: req.query
    });

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
      topics_count: parseInt(row.topics_count),
      keywords_count: parseInt(row.keywords_count),
      created_at: row.created_at
    }));

    res.json({
      success: true,
      audiences,
      total: audiences.length
    });

  } catch (error) {
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
        created_at: audience.created_at,
        updated_at: audience.updated_at,
        topics: topicsResult.rows,
        keywords: keywordsResult.rows
      }
    });

  } catch (error) {
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
      priority
    } = req.body;

    const updates = [];
    const updateValues = [id];
    let paramIndex = 2;

    if (target_segment !== undefined) {
      updates.push(`target_segment = $${paramIndex}`);
      updateValues.push(JSON.stringify(target_segment));
      paramIndex++;
    }

    if (customer_problem !== undefined) {
      updates.push(`customer_problem = $${paramIndex}`);
      updateValues.push(customer_problem);
      paramIndex++;
    }

    if (customer_language !== undefined) {
      updates.push(`customer_language = $${paramIndex}`);
      updateValues.push(customer_language ? JSON.stringify(customer_language) : null);
      paramIndex++;
    }

    if (conversion_path !== undefined) {
      updates.push(`conversion_path = $${paramIndex}`);
      updateValues.push(conversion_path);
      paramIndex++;
    }

    if (business_value !== undefined) {
      updates.push(`business_value = $${paramIndex}`);
      updateValues.push(business_value ? JSON.stringify(business_value) : null);
      paramIndex++;
    }

    if (priority !== undefined) {
      updates.push(`priority = $${paramIndex}`);
      updateValues.push(priority);
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
        created_at: audience.created_at,
        updated_at: audience.updated_at
      }
    });

  } catch (error) {
    console.error('Update audience error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update audience',
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
    console.error('Delete audience error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete audience',
      message: error.message
    });
  }
});

// Admin endpoint to clean up corrupted data and related records
router.delete('/cleanup-corrupted', async (req, res) => {
  try {
    console.log('🧹 Starting comprehensive cleanup of corrupted audience data and related records');

    // Start transaction for atomic cleanup
    await db.query('BEGIN');

    try {
      // Step 1: Find corrupted audience records
      const corruptedAudiences = await db.query(`
        SELECT id, user_id, session_id, target_segment, customer_problem, created_at
        FROM audiences 
        WHERE target_segment LIKE '%General Audience%' 
           OR target_segment LIKE '%[object Object]%'
           OR target_segment = '[object Object]'
           OR (target_segment IS NOT NULL AND target_segment !~ '^{.*}$')
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
          WHERE target_segment LIKE '%General Audience%' 
             OR target_segment LIKE '%[object Object]%'
             OR target_segment = '[object Object]'
             OR (target_segment IS NOT NULL AND target_segment !~ '^{.*}$')
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
          (SELECT COUNT(*) FROM audiences WHERE target_segment LIKE '%[object Object]%') as remaining_corrupted,
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
    console.error('Comprehensive cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform comprehensive cleanup',
      message: error.message
    });
  }
});

export default router;