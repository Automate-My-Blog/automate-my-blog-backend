import express from 'express';
import db from '../services/database.js';

const router = express.Router();

// Enhanced user context extraction with comprehensive debugging
const extractUserContext = (req) => {
  const sessionId = req.headers['x-session-id'] || req.body?.session_id;
  
  // Enhanced debugging for authentication issues
  console.log('🔍 Posts extractUserContext debug:', {
    hasAuthHeader: !!req.headers.authorization,
    authHeaderStart: req.headers.authorization?.substring(0, 20),
    hasReqUser: !!req.user,
    reqUserKeys: req.user ? Object.keys(req.user) : [],
    reqUserId: req.user?.userId,
    sessionId: sessionId,
    endpoint: req.path,
    method: req.method
  });
  
  // Check for mock user ID (for testing)
  const mockUserId = req.headers['x-mock-user-id'];
  if (mockUserId && process.env.NODE_ENV !== 'production') {
    return {
      isAuthenticated: true,
      userId: mockUserId,
      sessionId: sessionId || null
    };
  }
  
  if (req.user?.userId) {
    console.log('✅ Posts extractUserContext: Authenticated user found:', req.user.userId);
    return {
      isAuthenticated: true,
      userId: req.user.userId,
      sessionId: sessionId || null
    };
  }
  
  console.log('❌ Posts extractUserContext: No authenticated user, falling back to session');
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
  console.log('✅ Posts validateUserContext passed:', {
    isAuthenticated: context.isAuthenticated,
    hasSessionId: !!context.sessionId,
    userId: context.userId
  });
};

// Safe JSON parsing for corrupted data
const safeParse = (jsonString, fieldName, recordId) => {
  if (!jsonString) return null;
  if (typeof jsonString === 'object') return jsonString;
  
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error(`🚨 JSON Parse Error in ${fieldName} for record ${recordId}:`, {
      error: error.message,
      rawValue: jsonString,
      valueType: typeof jsonString
    });
    return null;
  }
};

// =============================================================================
// CREATE POST - Supports both authenticated and session-based creation
// =============================================================================
router.post('/', async (req, res) => {
  try {
    console.log('📝 Creating new blog post...');
    const context = extractUserContext(req);
    validateUserContext(context);
    
    const {
      title,
      content,
      status = 'draft',
      topic_data,
      generation_metadata,
      project_id,
      strategy_id
    } = req.body;
    
    // Validation
    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: 'Title and content are required'
      });
    }
    
    console.log('📊 Post creation context:', {
      isAuthenticated: context.isAuthenticated,
      userId: context.userId,
      sessionId: context.sessionId,
      hasProjectId: !!project_id,
      hasStrategyId: !!strategy_id
    });
    
    // Build query based on authentication status
    let query, params;
    
    if (context.isAuthenticated) {
      // Authenticated user
      query = `
        INSERT INTO blog_posts (
          user_id, title, content, status, topic_data, 
          generation_metadata, project_id, strategy_id, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        RETURNING *
      `;
      params = [
        context.userId, title, content, status,
        topic_data ? JSON.stringify(topic_data) : null,
        generation_metadata ? JSON.stringify(generation_metadata) : null,
        project_id || null,
        strategy_id || null
      ];
    } else {
      // Session-based user
      query = `
        INSERT INTO blog_posts (
          session_id, title, content, status, topic_data,
          generation_metadata, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING *
      `;
      params = [
        context.sessionId, title, content, status,
        topic_data ? JSON.stringify(topic_data) : null,
        generation_metadata ? JSON.stringify(generation_metadata) : null
      ];
    }
    
    const result = await db.query(query, params);
    const post = result.rows[0];
    
    console.log('✅ Post created successfully:', {
      id: post.id,
      title: post.title,
      status: post.status,
      userId: post.user_id,
      sessionId: post.session_id
    });
    
    res.json({
      success: true,
      post: {
        ...post,
        topic_data: safeParse(post.topic_data, 'topic_data', post.id),
        generation_metadata: safeParse(post.generation_metadata, 'generation_metadata', post.id)
      }
    });
    
  } catch (error) {
    console.error('❌ Post creation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create post',
      details: error.message
    });
  }
});

// =============================================================================
// GET POSTS - Retrieves posts for authenticated user or session
// =============================================================================
router.get('/', async (req, res) => {
  try {
    console.log('📖 Retrieving user posts...');
    const context = extractUserContext(req);
    validateUserContext(context);
    
    let query, params;
    
    if (context.isAuthenticated) {
      // Get posts for authenticated user
      query = `
        SELECT p.*, pr.name as project_name
        FROM blog_posts p
        LEFT JOIN projects pr ON p.project_id = pr.id
        WHERE p.user_id = $1
        ORDER BY p.created_at DESC
      `;
      params = [context.userId];
    } else {
      // Get posts for session
      query = `
        SELECT *
        FROM blog_posts
        WHERE session_id = $1
        ORDER BY created_at DESC
      `;
      params = [context.sessionId];
    }
    
    const result = await db.query(query, params);
    
    // Parse JSON fields safely
    const posts = result.rows.map(post => ({
      ...post,
      topic_data: safeParse(post.topic_data, 'topic_data', post.id),
      generation_metadata: safeParse(post.generation_metadata, 'generation_metadata', post.id)
    }));
    
    console.log('✅ Posts retrieved successfully:', {
      count: posts.length,
      isAuthenticated: context.isAuthenticated,
      userId: context.userId,
      sessionId: context.sessionId
    });
    
    res.json({
      success: true,
      posts: posts
    });
    
  } catch (error) {
    console.error('❌ Posts retrieval failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve posts',
      details: error.message
    });
  }
});

// =============================================================================
// SESSION ADOPTION - Transfer posts from session to authenticated user
// =============================================================================
router.post('/adopt-session', async (req, res) => {
  try {
    console.log('🔄 Starting posts session adoption...');
    const context = extractUserContext(req);
    
    // Must be authenticated to adopt session
    if (!context.isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required for session adoption'
      });
    }
    
    const { session_id } = req.body;
    const sessionId = session_id || context.sessionId;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID required for adoption'
      });
    }
    
    console.log('📊 Session adoption context:', {
      userId: context.userId,
      sessionId: sessionId,
      endpoint: 'posts/adopt-session'
    });
    
    // Use the database function for safe adoption
    const adoptionResult = await db.query(
      'SELECT * FROM adopt_posts_session($1, $2)',
      [context.userId, sessionId]
    );
    
    const adoption = adoptionResult.rows[0];
    
    console.log('✅ Posts session adoption completed:', {
      userId: context.userId,
      sessionId: sessionId,
      adoptedPosts: adoption.adopted_posts_count,
      adoptedTopics: adoption.adopted_topics_count,
      adoptedStrategies: adoption.adopted_strategies_count
    });
    
    res.json({
      success: true,
      message: 'Posts session adopted successfully',
      adoption: {
        postsCount: adoption.adopted_posts_count,
        topicsCount: adoption.adopted_topics_count,
        strategiesCount: adoption.adopted_strategies_count,
        sessionId: sessionId,
        userId: context.userId
      }
    });
    
  } catch (error) {
    console.error('❌ Posts session adoption failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to adopt posts session',
      details: error.message
    });
  }
});

// =============================================================================
// GET SINGLE POST - Retrieve specific post by ID
// =============================================================================
router.get('/:id', async (req, res) => {
  try {
    console.log('📖 Retrieving single post...');
    const context = extractUserContext(req);
    validateUserContext(context);
    
    const { id } = req.params;
    
    let query, params;
    
    if (context.isAuthenticated) {
      query = `
        SELECT p.*, pr.name as project_name
        FROM blog_posts p
        LEFT JOIN projects pr ON p.project_id = pr.id
        WHERE p.id = $1 AND p.user_id = $2
      `;
      params = [id, context.userId];
    } else {
      query = `
        SELECT * FROM blog_posts
        WHERE id = $1 AND session_id = $2
      `;
      params = [id, context.sessionId];
    }
    
    const result = await db.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }
    
    const post = result.rows[0];
    
    console.log('✅ Single post retrieved:', {
      id: post.id,
      title: post.title,
      userId: post.user_id,
      sessionId: post.session_id
    });
    
    res.json({
      success: true,
      post: {
        ...post,
        topic_data: safeParse(post.topic_data, 'topic_data', post.id),
        generation_metadata: safeParse(post.generation_metadata, 'generation_metadata', post.id)
      }
    });
    
  } catch (error) {
    console.error('❌ Single post retrieval failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve post',
      details: error.message
    });
  }
});

// =============================================================================
// UPDATE POST - Update existing post
// =============================================================================
router.put('/:id', async (req, res) => {
  try {
    console.log('✏️ Updating post...');
    const context = extractUserContext(req);
    validateUserContext(context);
    
    const { id } = req.params;
    const {
      title,
      content,
      status,
      custom_feedback,
      topic_data,
      generation_metadata
    } = req.body;
    
    // Build update query
    const updateFields = [];
    const params = [];
    let paramIndex = 1;
    
    if (title !== undefined) {
      updateFields.push(`title = $${paramIndex++}`);
      params.push(title);
    }
    if (content !== undefined) {
      updateFields.push(`content = $${paramIndex++}`);
      params.push(content);
    }
    if (status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (custom_feedback !== undefined) {
      updateFields.push(`custom_feedback = $${paramIndex++}`);
      params.push(custom_feedback);
    }
    if (topic_data !== undefined) {
      updateFields.push(`topic_data = $${paramIndex++}`);
      params.push(topic_data ? JSON.stringify(topic_data) : null);
    }
    if (generation_metadata !== undefined) {
      updateFields.push(`generation_metadata = $${paramIndex++}`);
      params.push(generation_metadata ? JSON.stringify(generation_metadata) : null);
    }
    
    updateFields.push(`updated_at = NOW()`);
    
    // Add WHERE condition
    let whereClause;
    if (context.isAuthenticated) {
      whereClause = `WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}`;
      params.push(id, context.userId);
    } else {
      whereClause = `WHERE id = $${paramIndex++} AND session_id = $${paramIndex++}`;
      params.push(id, context.sessionId);
    }
    
    const query = `
      UPDATE blog_posts 
      SET ${updateFields.join(', ')} 
      ${whereClause}
      RETURNING *
    `;
    
    const result = await db.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Post not found or access denied'
      });
    }
    
    const post = result.rows[0];
    
    console.log('✅ Post updated successfully:', {
      id: post.id,
      title: post.title,
      status: post.status
    });
    
    res.json({
      success: true,
      post: {
        ...post,
        topic_data: safeParse(post.topic_data, 'topic_data', post.id),
        generation_metadata: safeParse(post.generation_metadata, 'generation_metadata', post.id)
      }
    });
    
  } catch (error) {
    console.error('❌ Post update failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update post',
      details: error.message
    });
  }
});

// =============================================================================
// DELETE POST - Delete existing post
// =============================================================================
router.delete('/:id', async (req, res) => {
  try {
    console.log('🗑️ Deleting post...');
    const context = extractUserContext(req);
    validateUserContext(context);
    
    const { id } = req.params;
    
    let query, params;
    
    if (context.isAuthenticated) {
      query = `DELETE FROM blog_posts WHERE id = $1 AND user_id = $2 RETURNING id, title`;
      params = [id, context.userId];
    } else {
      query = `DELETE FROM blog_posts WHERE id = $1 AND session_id = $2 RETURNING id, title`;
      params = [id, context.sessionId];
    }
    
    const result = await db.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Post not found or access denied'
      });
    }
    
    const deletedPost = result.rows[0];
    
    console.log('✅ Post deleted successfully:', {
      id: deletedPost.id,
      title: deletedPost.title
    });
    
    res.json({
      success: true,
      message: 'Post deleted successfully',
      deletedPost: deletedPost
    });
    
  } catch (error) {
    console.error('❌ Post deletion failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete post',
      details: error.message
    });
  }
});

export default router;