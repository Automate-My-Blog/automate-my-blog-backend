import express from 'express';
import db from '../services/database.js';

const router = express.Router();

const extractUserContext = (req) => {
  // Debug logging for JWT token verification issues
  console.log('🔍 extractUserContext debug:', {
    hasReqUser: !!req.user,
    userKeys: req.user ? Object.keys(req.user) : null,
    authHeader: req.headers.authorization ? 'Bearer ***' : null,
    sessionHeader: req.headers['x-session-id'],
    bodySessionId: req.body?.session_id
  });
  
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

    const audienceData = {
      user_id: userContext.userId,
      session_id: userContext.sessionId,
      project_id,
      organization_intelligence_id,
      target_segment: typeof target_segment === 'string' ? target_segment : JSON.stringify(target_segment),
      customer_problem,
      customer_language: customer_language ? (typeof customer_language === 'string' ? customer_language : JSON.stringify(customer_language)) : null,
      conversion_path,
      business_value: business_value ? (typeof business_value === 'string' ? business_value : JSON.stringify(business_value)) : null,
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
        target_segment: JSON.parse(audience.target_segment),
        customer_problem: audience.customer_problem,
        customer_language: audience.customer_language ? JSON.parse(audience.customer_language) : null,
        conversion_path: audience.conversion_path,
        business_value: audience.business_value ? JSON.parse(audience.business_value) : null,
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

    const result = await db.query(`
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
    `, [...queryParams, parseInt(limit), parseInt(offset)]);

    const audiences = result.rows.map(row => ({
      id: row.id,
      target_segment: JSON.parse(row.target_segment),
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
        target_segment: JSON.parse(audience.target_segment),
        customer_problem: audience.customer_problem,
        customer_language: audience.customer_language ? JSON.parse(audience.customer_language) : null,
        conversion_path: audience.conversion_path,
        business_value: audience.business_value ? JSON.parse(audience.business_value) : null,
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
        target_segment: JSON.parse(audience.target_segment),
        customer_problem: audience.customer_problem,
        customer_language: audience.customer_language ? JSON.parse(audience.customer_language) : null,
        conversion_path: audience.conversion_path,
        business_value: audience.business_value ? JSON.parse(audience.business_value) : null,
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

export default router;