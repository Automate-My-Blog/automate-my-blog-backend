import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../services/database.js';
import { PLATFORM_KEYS, getConnectedPlatforms, normalizePlatformKey } from '../lib/publishing-platforms.js';
import { getConnectionCredentials } from '../services/publishing-connections.js';
import { publishToContentful } from '../services/contentful-publish.js';
import { publishToGhost } from '../services/ghost-publish.js';
import { publishToMedium } from '../services/medium-publish.js';
import { publishToSubstack } from '../services/substack-publish.js';
import { publishToWordPress } from '../services/wordpress-publish.js';
import postsAutomationRoutes from './posts-automation.js';

const router = express.Router();

// Mount automation routes before /:id so /automation is not captured as id
router.use('/automation', postsAutomationRoutes);

const extractUserContext = (req) => {
  const sessionId = req.headers['x-session-id'] || req.body?.session_id;

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
    return {
      isAuthenticated: true,
      userId: req.user.userId,
      sessionId: sessionId || null
    };
  }

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

// Format a raw post row for API response (includes publication metadata per handoff §6)
const formatPostForResponse = (post) => {
  if (!post) return null;
  const topicData = safeParse(post.topic_data, 'topic_data', post.id);
  const generationMetadata = safeParse(post.generation_metadata, 'generation_metadata', post.id);
  let platformPublications = post.platform_publications;
  if (platformPublications === null || platformPublications === undefined) {
    platformPublications = [];
  } else if (typeof platformPublications === 'string') {
    platformPublications = safeParse(platformPublications, 'platform_publications', post.id) || [];
  }
  if (!Array.isArray(platformPublications)) {
    platformPublications = [];
  }
  return {
    ...post,
    topic_data: topicData,
    generation_metadata: generationMetadata,
    publication_status: post.publication_status ?? 'draft',
    platform_publications: platformPublications
  };
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
        error: 'Title and content are required',
        code: 'TITLE_AND_CONTENT_REQUIRED',
        hint: 'When using content-generation stream, only call create post after receiving blog-result or complete, and pass the title and content from that payload. If autoSave is true, the backend creates the post and returns it in complete.result.savedPost.'
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

    // Track post generation event for analytics funnel
    if (context.userId) {
      try {
        // Check if this is the first post generated by the user
        const isFirstPost = await db.query(`
          SELECT COUNT(*) as post_count
          FROM user_activity_events
          WHERE user_id = $1 AND event_type = 'post_generated'
        `, [context.userId]);

        const postCount = parseInt(isFirstPost.rows[0]?.post_count || 0);
        const funnelStep = postCount === 0 ? 'first_generation' : null;

        await db.query(`
          INSERT INTO user_activity_events (
            id, user_id, event_type, conversion_funnel_step,
            event_data, timestamp
          ) VALUES (
            $1, $2, 'post_generated',
            $3, $4, NOW()
          )
        `, [
          uuidv4(),
          context.userId,
          funnelStep,
          JSON.stringify({
            post_id: post.id,
            project_id: project_id,
            strategy_id: strategy_id,
            title: title
          })
        ]);
        console.log(`📊 Analytics event tracked: post_generated${funnelStep ? ' (first_generation)' : ''}`);
      } catch (eventError) {
        console.error(`⚠️ Failed to track analytics event:`, eventError.message);
        // Don't throw - analytics failure shouldn't block post creation
      }
    }

    res.json({
      success: true,
      post: formatPostForResponse(post)
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
    
    const { strategy_id } = req.query;
    let query, params;

    if (context.isAuthenticated) {
      // Get posts for authenticated user, optionally filtered by strategy
      query = `
        SELECT p.*, pr.name as project_name
        FROM blog_posts p
        LEFT JOIN projects pr ON p.project_id = pr.id
        WHERE p.user_id = $1
        ${strategy_id ? 'AND p.strategy_id = $2' : ''}
        ORDER BY p.created_at DESC
      `;
      params = strategy_id ? [context.userId, strategy_id] : [context.userId];
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
    
    const posts = result.rows.map(post => formatPostForResponse(post));
    
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
    const msg = error?.message ?? '';
    if (msg.includes('authentication') && msg.includes('session ID')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication or session required',
        message: 'Either authentication or session ID is required'
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve posts',
      details: msg
    });
  }
});

// =============================================================================
// RE-ANALYZE SEO - Run SEO analysis on existing post
// =============================================================================
router.post('/:postId/reanalyze-seo', async (req, res) => {
  try {
    const { postId } = req.params;
    const context = extractUserContext(req);
    validateUserContext(context);

    console.log(`🔍 Re-analyzing SEO for post: ${postId}`);

    // Fetch the post
    let query, params;
    if (context.isAuthenticated) {
      query = 'SELECT * FROM blog_posts WHERE id = $1 AND user_id = $2';
      params = [postId, context.userId];
    } else {
      query = 'SELECT * FROM blog_posts WHERE id = $1 AND session_id = $2';
      params = [postId, context.sessionId];
    }

    const postResult = await db.query(query, params);

    if (postResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Post not found or access denied'
      });
    }

    const post = postResult.rows[0];

    if (!post.content || post.content.trim().length < 200) {
      return res.status(400).json({
        success: false,
        error: 'Post content too short for meaningful SEO analysis (minimum 200 characters)'
      });
    }

    // Import enhanced blog generation service to use SEO analysis method
    const enhancedBlogService = (await import('../services/enhanced-blog-generation.js')).default;

    // Run SEO analysis
    const topicData = safeParse(post.topic_data, 'topic_data', post.id);
    const seoResult = await enhancedBlogService.runSEOAnalysis(
      post.content,
      context.userId || context.sessionId,
      postId,
      {
        businessType: topicData?.industry || 'Business',
        targetAudience: topicData?.targetAudience || 'General audience',
        primaryKeywords: topicData?.seoKeywords || [],
        businessGoals: 'Generate more customers through content'
      }
    );

    if (!seoResult.success) {
      return res.status(500).json({
        success: false,
        error: 'SEO analysis failed',
        details: seoResult.error
      });
    }

    // Update post with new SEO analysis
    const existingMetadata = safeParse(post.generation_metadata, 'generation_metadata', post.id) || {};
    const updatedMetadata = {
      ...existingMetadata,
      seoAnalysis: seoResult.analysis,
      qualityPrediction: {
        ...existingMetadata.qualityPrediction,
        actualSEOScore: seoResult.analysis.overallScore,
        topStrengths: seoResult.analysis.topStrengths || [],
        topImprovements: seoResult.analysis.topImprovements || []
      },
      lastSEOAnalysis: new Date().toISOString()
    };

    const updateQuery = `
      UPDATE blog_posts
      SET
        generation_metadata = $1,
        seo_score_prediction = $2,
        updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `;

    const updateResult = await db.query(updateQuery, [
      JSON.stringify(updatedMetadata),
      seoResult.analysis.overallScore,
      postId
    ]);

    const updatedPost = updateResult.rows[0];

    console.log(`✅ SEO re-analysis complete for post ${postId}: Score ${seoResult.analysis.overallScore}/100`);

    res.json({
      success: true,
      post: formatPostForResponse(updatedPost),
      analysis: seoResult.analysis,
      message: `SEO analysis complete! Score: ${seoResult.analysis.overallScore}/100`
    });

  } catch (error) {
    console.error('❌ SEO re-analysis failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to re-analyze post',
      details: error.message
    });
  }
});

// =============================================================================
// PUBLISH - Direct platform publishing (requires JWT)
// =============================================================================
router.post('/:id/publish', async (req, res) => {
  try {
    const context = extractUserContext(req);
    if (!context.isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Direct publishing requires a logged-in user. Use Authorization: Bearer <token>.'
      });
    }

    const { id } = req.params;
    const { platforms, publish_mode: publishMode, update_existing: updateExisting } = req.body || {};

    if (!Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        message: 'Body must include "platforms" (non-empty array of platform keys, e.g. ["wordpress", "medium"])'
      });
    }

    const normalizedPlatforms = platforms
      .filter((p) => typeof p === 'string' && p.trim())
      .map((p) => normalizePlatformKey(p))
      .filter(Boolean);
    if (normalizedPlatforms.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        message: `Body must include "platforms" (non-empty array of platform keys). Supported: ${[...PLATFORM_KEYS].sort().join(', ')}`
      });
    }

    const unknown = platforms.filter((p) => normalizePlatformKey(p) === null);
    if (unknown.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid platform',
        message: `Unsupported platform(s): ${unknown.join(', ')}. Supported: ${[...PLATFORM_KEYS].join(', ')}`
      });
    }

    const connected = await getConnectedPlatforms(context.userId);
    const notConnected = normalizedPlatforms.filter((p) => !connected.has(p));
    if (notConnected.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Platform not connected',
        message: `The following platform(s) are not connected for your account. Connect them in Settings first: ${notConnected.join(', ')}`
      });
    }

    const selectResult = await db.query(
      'SELECT * FROM blog_posts WHERE id = $1 AND user_id = $2',
      [id, context.userId]
    );
    if (selectResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Post not found or access denied'
      });
    }

    const post = selectResult.rows[0];
    const platformPublications = [];
    const isDraft = publishMode === 'draft';

    for (const platformKey of normalizedPlatforms) {
      if (platformKey === 'wordpress') {
        const creds = await getConnectionCredentials(context.userId, 'wordpress');
        if (!creds) {
          platformPublications.push({ platform: platformKey, status: 'failed', message: 'WordPress connection not found' });
          continue;
        }
        try {
          const result = await publishToWordPress(creds, {
            title: post.title,
            content: post.content || ''
          }, { status: isDraft ? 'draft' : 'publish' });
          platformPublications.push({
            platform: platformKey,
            status: 'published',
            url: result.url
          });
        } catch (err) {
          console.error('WordPress publish failed:', err.message);
          platformPublications.push({
            platform: platformKey,
            status: 'failed',
            message: err.message || 'Publish failed'
          });
        }
      } else if (platformKey === 'ghost') {
        const creds = await getConnectionCredentials(context.userId, 'ghost');
        if (!creds) {
          platformPublications.push({ platform: platformKey, status: 'failed', message: 'Ghost connection not found' });
          continue;
        }
        try {
          const result = await publishToGhost(creds, {
            title: post.title,
            content: post.content || ''
          });
          platformPublications.push({
            platform: platformKey,
            status: 'published',
            url: result.url || undefined,
            label: 'Ghost'
          });
        } catch (err) {
          console.error('Ghost publish failed:', err.message);
          platformPublications.push({
            platform: platformKey,
            status: 'failed',
            message: err.message || 'Publish failed'
          });
        }
      } else if (platformKey === 'medium') {
        const creds = await getConnectionCredentials(context.userId, 'medium');
        if (!creds) {
          platformPublications.push({ platform: platformKey, status: 'failed', message: 'Medium connection not found' });
          continue;
        }
        try {
          const result = await publishToMedium(creds, {
            title: post.title,
            content: post.content || ''
          }, { publishStatus: isDraft ? 'draft' : 'public' });
          platformPublications.push({
            platform: platformKey,
            status: 'published',
            url: result.url || undefined,
            label: 'Medium'
          });
        } catch (err) {
          console.error('Medium publish failed:', err.message);
          platformPublications.push({
            platform: platformKey,
            status: 'failed',
            message: err.message || 'Publish failed'
          });
        }
      } else if (platformKey === 'substack') {
        const creds = await getConnectionCredentials(context.userId, 'substack');
        if (!creds) {
          platformPublications.push({ platform: platformKey, status: 'failed', message: 'Substack connection not found' });
          continue;
        }
        try {
          const result = await publishToSubstack(creds, {
            title: post.title,
            content: post.content || ''
          });
          platformPublications.push({
            platform: platformKey,
            status: 'published',
            url: result?.url,
            label: 'Substack'
          });
        } catch (err) {
          console.error('Substack publish failed:', err.message);
          platformPublications.push({
            platform: platformKey,
            status: 'failed',
            message: err.message || 'Publish failed'
          });
        }
      } else if (platformKey === 'contentful') {
        const creds = await getConnectionCredentials(context.userId, 'contentful');
        if (!creds) {
          platformPublications.push({ platform: platformKey, status: 'failed', message: 'Contentful connection not found' });
          continue;
        }
        try {
          const result = await publishToContentful(creds, {
            title: post.title,
            content: post.content || ''
          });
          platformPublications.push({
            platform: platformKey,
            status: 'published',
            url: result?.url,
            label: 'Contentful'
          });
        } catch (err) {
          console.error('Contentful publish failed:', err.message);
          platformPublications.push({
            platform: platformKey,
            status: 'failed',
            message: err.message || 'Publish failed'
          });
        }
      } else {
        // Other platforms: not yet implemented; leave as publishing
        platformPublications.push({ platform: platformKey, status: 'publishing' });
      }
    }

    const anyPublished = platformPublications.some((p) => p.status === 'published');
    const anyFailed = platformPublications.some((p) => p.status === 'failed');
    const publicationStatus = anyFailed && !anyPublished ? 'failed' : anyPublished ? 'published' : 'publishing';

    const updateResult = await db.query(
      `UPDATE blog_posts
       SET publication_status = $1, platform_publications = $2, updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [publicationStatus, JSON.stringify(platformPublications), id, context.userId]
    );
    const updated = updateResult.rows[0];

    res.json({
      success: true,
      post: formatPostForResponse(updated)
    });
  } catch (error) {
    console.error('❌ Publish failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to publish post',
      details: error.message
    });
  }
});

// =============================================================================
// UNPUBLISH - Remove post from one platform or all (requires JWT)
// =============================================================================
router.post('/:id/unpublish', async (req, res) => {
  try {
    const context = extractUserContext(req);
    if (!context.isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Unpublishing requires a logged-in user. Use Authorization: Bearer <token>.'
      });
    }

    const { id } = req.params;
    const { platform } = req.body || {};

    if (platform !== undefined && platform !== null && String(platform).trim() !== '') {
      const key = normalizePlatformKey(String(platform).trim());
      if (!key) {
        return res.status(400).json({
          success: false,
          error: 'Invalid platform',
          message: `Unsupported platform. Supported: ${[...PLATFORM_KEYS].sort().join(', ')}`
        });
      }
    }

    const selectResult = await db.query(
      'SELECT * FROM blog_posts WHERE id = $1 AND user_id = $2',
      [id, context.userId]
    );
    if (selectResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Post not found or access denied'
      });
    }

    const post = selectResult.rows[0];
    let platformPublications = post.platform_publications;
    if (platformPublications === null || platformPublications === undefined) {
      platformPublications = [];
    } else if (typeof platformPublications === 'string') {
      platformPublications = safeParse(platformPublications, 'platform_publications', post.id) || [];
    }
    if (!Array.isArray(platformPublications)) {
      platformPublications = [];
    }

    let nextPublications;
    let nextStatus;
    if (platform === undefined || platform === null || String(platform).trim() === '') {
      nextPublications = [];
      nextStatus = 'draft';
    } else {
      const key = String(platform).toLowerCase();
      nextPublications = platformPublications.filter((item) => String(item.platform).toLowerCase() !== key);
      nextStatus = nextPublications.length === 0 ? 'draft' : post.publication_status;
    }

    const updateResult = await db.query(
      `UPDATE blog_posts
       SET platform_publications = $1, publication_status = $2, updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [JSON.stringify(nextPublications), nextStatus, id, context.userId]
    );
    const updated = updateResult.rows[0];

    res.json({
      success: true,
      post: formatPostForResponse(updated)
    });
  } catch (error) {
    console.error('❌ Unpublish failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unpublish post',
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
      post: formatPostForResponse(post)
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
      post: formatPostForResponse(post)
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