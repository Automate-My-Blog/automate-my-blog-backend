import express from 'express';
import db from '../services/database.js';

const router = express.Router();

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

const validateAudienceAccess = async (audienceId, userContext) => {
  let whereCondition = 'id = $1';
  let queryParams = [audienceId];
  
  if (userContext.isAuthenticated) {
    whereCondition += ' AND user_id = $2';
    queryParams.push(userContext.userId);
  } else {
    whereCondition += ' AND session_id = $2';
    queryParams.push(userContext.sessionId);
  }

  const result = await db.query(`
    SELECT id FROM audiences WHERE ${whereCondition}
  `, queryParams);

  if (result.rows.length === 0) {
    throw new Error('Audience not found or access denied');
  }
  
  return result.rows[0];
};

router.post('/', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    validateUserContext(userContext);

    const { audience_id, keywords } = req.body;

    if (!audience_id || !keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'audience_id and keywords array are required'
      });
    }

    await validateAudienceAccess(audience_id, userContext);

    const insertPromises = keywords.map(keyword => {
      const { keyword: keywordText, search_volume, competition, relevance_score } = keyword;
      
      if (!keywordText) {
        throw new Error('Keyword text is required for all keywords');
      }

      return db.query(`
        INSERT INTO seo_keywords (
          user_id, session_id, audience_id, keyword, search_volume, competition, relevance_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        userContext.userId,
        userContext.sessionId,
        audience_id,
        keywordText,
        search_volume || null,
        competition || null,
        relevance_score || null
      ]);
    });

    const results = await Promise.all(insertPromises);
    const createdKeywords = results.map(result => result.rows[0]);

    res.status(201).json({
      success: true,
      keywords: createdKeywords,
      count: createdKeywords.length
    });

  } catch (error) {
    console.error('Create keywords error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create keywords',
      message: error.message
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    validateUserContext(userContext);

    const { audience_id } = req.query;

    if (!audience_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter',
        message: 'audience_id is required'
      });
    }

    await validateAudienceAccess(audience_id, userContext);

    const result = await db.query(`
      SELECT 
        id, keyword, search_volume, competition, relevance_score, created_at
      FROM seo_keywords 
      WHERE audience_id = $1
      ORDER BY relevance_score DESC NULLS LAST, keyword ASC
    `, [audience_id]);

    res.json({
      success: true,
      keywords: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    console.error('Get keywords error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve keywords',
      message: error.message
    });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const userContext = extractUserContext(req);
    validateUserContext(userContext);
    const { id } = req.params;

    let whereCondition = 'sk.id = $1';
    let queryParams = [id];
    
    if (userContext.isAuthenticated) {
      whereCondition += ' AND sk.user_id = $2';
      queryParams.push(userContext.userId);
    } else {
      whereCondition += ' AND sk.session_id = $2';
      queryParams.push(userContext.sessionId);
    }

    const existingResult = await db.query(`
      SELECT sk.id, sk.audience_id 
      FROM seo_keywords sk
      WHERE ${whereCondition}
    `, queryParams);

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Keyword not found',
        message: 'The requested keyword does not exist or you do not have access to it'
      });
    }

    const {
      keyword,
      search_volume,
      competition,
      relevance_score
    } = req.body;

    const updates = [];
    const updateValues = [id];
    let paramIndex = 2;

    if (keyword !== undefined) {
      updates.push(`keyword = $${paramIndex}`);
      updateValues.push(keyword);
      paramIndex++;
    }

    if (search_volume !== undefined) {
      updates.push(`search_volume = $${paramIndex}`);
      updateValues.push(search_volume);
      paramIndex++;
    }

    if (competition !== undefined) {
      updates.push(`competition = $${paramIndex}`);
      updateValues.push(competition);
      paramIndex++;
    }

    if (relevance_score !== undefined) {
      updates.push(`relevance_score = $${paramIndex}`);
      updateValues.push(relevance_score);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No updates provided',
        message: 'At least one field must be provided for update'
      });
    }

    const result = await db.query(`
      UPDATE seo_keywords 
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *
    `, updateValues);

    res.json({
      success: true,
      keyword: result.rows[0]
    });

  } catch (error) {
    console.error('Update keyword error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update keyword',
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
      DELETE FROM seo_keywords WHERE ${whereCondition}
      RETURNING id
    `, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Keyword not found',
        message: 'The requested keyword does not exist or you do not have access to it'
      });
    }

    res.json({
      success: true,
      message: 'Keyword deleted successfully'
    });

  } catch (error) {
    console.error('Delete keyword error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete keyword',
      message: error.message
    });
  }
});

export default router;