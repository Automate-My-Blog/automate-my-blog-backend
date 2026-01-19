import { v4 as uuidv4 } from 'uuid';
import db from './database.js';

/**
 * Content Management Service
 * Handles blog posts, generation history, and content-related operations
 */
class ContentService {
  constructor() {
    this.useDatabaseStorage = process.env.USE_DATABASE === 'true';
    this.databaseAvailable = false;
    
    // In-memory fallback for when database is unavailable
    this.fallbackPosts = new Map();
    this.fallbackGenerations = [];
    
    // Test database availability
    this.testDatabaseConnection();
  }

  async testDatabaseConnection() {
    try {
      await db.testConnection();
      this.databaseAvailable = true;
      console.log('✅ Content service using database storage');
    } catch (error) {
      this.databaseAvailable = false;
      console.log('⚠️  Content service falling back to in-memory storage');
    }
  }

  /**
   * Save blog post to storage
   */
  async saveBlogPost(userId, blogPostData) {
    try {
      if (this.databaseAvailable && this.useDatabaseStorage) {
        return await this.saveBlogPostToDatabase(userId, blogPostData);
      } else {
        return await this.saveBlogPostToMemory(userId, blogPostData);
      }
    } catch (error) {
      console.error('Save blog post error:', error.message);
      
      // Fallback to memory if database fails
      if (this.databaseAvailable && error.message.includes('database')) {
        console.warn('Database save failed, using memory fallback');
        return await this.saveBlogPostToMemory(userId, blogPostData);
      }
      throw error;
    }
  }

  /**
   * Save blog post to database
   */
  async saveBlogPostToDatabase(userId, blogPostData) {
    const {
      title,
      content,
      topic,
      businessInfo,
      generationMetadata,
      status = 'draft'
    } = blogPostData;

    const blogPostId = uuidv4();

    // Insert blog post
    const blogPostResult = await db.query(`
      INSERT INTO blog_posts (
        id, user_id, title, content, topic_data,
        status, word_count, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING id, title, status, created_at, updated_at
    `, [
      blogPostId,
      userId,
      title,
      content,
      JSON.stringify(topic),
      status,
      content ? content.split(' ').length : 0
    ]);

    const savedPost = blogPostResult.rows[0];

    // Record generation history if provided
    if (generationMetadata) {
      await this.recordGenerationHistory(userId, {
        type: 'blog_post',
        inputData: { topic, businessInfo },
        outputData: { blogPostId, title, wordCount: content?.split(' ').length },
        tokensUsed: generationMetadata.tokensUsed || 0,
        durationMs: generationMetadata.generationTime || 0,
        successStatus: true,
        aiModel: generationMetadata.aiModel || 'unknown'
      });
    }

    return {
      id: savedPost.id,
      title: savedPost.title,
      status: savedPost.status,
      createdAt: savedPost.created_at,
      updatedAt: savedPost.updated_at
    };
  }

  /**
   * Save blog post to memory (fallback)
   */
  async saveBlogPostToMemory(userId, blogPostData) {
    const { title, content, topic, businessInfo, status = 'draft' } = blogPostData;

    const blogPost = {
      id: uuidv4(),
      userId,
      title,
      content,
      topicData: topic,
      businessContext: businessInfo,
      status,
      wordCount: content ? content.split(' ').length : 0,
      exportCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.fallbackPosts.set(blogPost.id, blogPost);

    return {
      id: blogPost.id,
      title: blogPost.title,
      status: blogPost.status,
      createdAt: blogPost.createdAt,
      updatedAt: blogPost.updatedAt
    };
  }

  /**
   * Get user's blog posts
   */
  async getUserBlogPosts(userId, options = {}) {
    const {
      limit = 25,
      offset = 0,
      status = 'all',
      sortBy = 'created_at',
      order = 'DESC',
      search = ''
    } = options;

    try {
      if (this.databaseAvailable && this.useDatabaseStorage) {
        return await this.getUserBlogPostsFromDatabase(userId, options);
      } else {
        return await this.getUserBlogPostsFromMemory(userId, options);
      }
    } catch (error) {
      console.error('Get blog posts error:', error.message);
      
      // Fallback to memory
      if (this.databaseAvailable && error.message.includes('database')) {
        return await this.getUserBlogPostsFromMemory(userId, options);
      }
      throw error;
    }
  }

  /**
   * Get user's blog posts from database
   */
  async getUserBlogPostsFromDatabase(userId, options) {
    const { limit, offset, status, sortBy, order, search } = options;

    let whereClause = 'WHERE user_id = $1';
    const queryParams = [userId];
    let paramIndex = 2;

    // Add status filter
    if (status !== 'all') {
      whereClause += ` AND status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    // Add search filter
    if (search) {
      whereClause += ` AND title ILIKE $${paramIndex}`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // Build query
    const query = `
      SELECT id, title, LEFT(content, 200) as content_preview, 
             status, word_count, export_count, created_at, updated_at,
             topic_data, business_context
      FROM blog_posts 
      ${whereClause}
      ORDER BY ${sortBy} ${order}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    queryParams.push(limit, offset);

    // Get posts
    const postsResult = await db.query(query, queryParams);
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM blog_posts ${whereClause}`;
    const countResult = await db.query(countQuery, queryParams.slice(0, -2)); // Remove limit/offset

    return {
      posts: postsResult.rows.map(row => ({
        id: row.id,
        title: row.title,
        contentPreview: row.content_preview,
        status: row.status,
        wordCount: row.word_count,
        exportCount: row.export_count,
        topicData: row.topic_data,
        businessContext: row.business_context,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
      hasMore: offset + limit < parseInt(countResult.rows[0].total)
    };
  }

  /**
   * Get user's blog posts from memory (fallback)
   */
  async getUserBlogPostsFromMemory(userId, options) {
    const { limit, offset, status, search } = options;

    let userPosts = Array.from(this.fallbackPosts.values())
      .filter(post => post.userId === userId);

    // Apply filters
    if (status !== 'all') {
      userPosts = userPosts.filter(post => post.status === status);
    }

    if (search) {
      userPosts = userPosts.filter(post => 
        post.title.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Sort by creation date (newest first)
    userPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = userPosts.length;
    const paginatedPosts = userPosts.slice(offset, offset + limit);

    return {
      posts: paginatedPosts.map(post => ({
        id: post.id,
        title: post.title,
        contentPreview: post.content?.substring(0, 200) + '...',
        status: post.status,
        wordCount: post.wordCount,
        exportCount: post.exportCount,
        topicData: post.topicData,
        businessContext: post.businessContext,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt
      })),
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    };
  }

  /**
   * Get single blog post by ID
   */
  async getBlogPost(postId, userId) {
    try {
      if (this.databaseAvailable && this.useDatabaseStorage) {
        const result = await db.query(`
          SELECT id, title, content, status, word_count, export_count,
                 topic_data, business_context, created_at, updated_at
          FROM blog_posts 
          WHERE id = $1 AND user_id = $2
        `, [postId, userId]);

        if (result.rows.length === 0) {
          throw new Error('Blog post not found');
        }

        const post = result.rows[0];
        return {
          id: post.id,
          title: post.title,
          content: post.content,
          status: post.status,
          wordCount: post.word_count,
          exportCount: post.export_count,
          topicData: post.topic_data,
          businessContext: post.business_context,
          createdAt: post.created_at,
          updatedAt: post.updated_at
        };
      } else {
        const post = this.fallbackPosts.get(postId);
        if (!post || post.userId !== userId) {
          throw new Error('Blog post not found');
        }
        return post;
      }
    } catch (error) {
      if (error.message === 'Blog post not found') {
        throw error;
      }
      
      // Fallback to memory
      const post = this.fallbackPosts.get(postId);
      if (!post || post.userId !== userId) {
        throw new Error('Blog post not found');
      }
      return post;
    }
  }

  /**
   * Update blog post
   */
  async updateBlogPost(postId, userId, updates) {
    try {
      if (this.databaseAvailable && this.useDatabaseStorage) {
        const result = await db.query(`
          UPDATE blog_posts 
          SET title = COALESCE($1, title),
              content = COALESCE($2, content),
              status = COALESCE($3, status),
              updated_at = NOW()
          WHERE id = $4 AND user_id = $5
          RETURNING id, title, status, updated_at
        `, [updates.title, updates.content, updates.status, postId, userId]);

        if (result.rows.length === 0) {
          throw new Error('Blog post not found');
        }

        return result.rows[0];
      } else {
        const post = this.fallbackPosts.get(postId);
        if (!post || post.userId !== userId) {
          throw new Error('Blog post not found');
        }

        // Update post
        if (updates.title) post.title = updates.title;
        if (updates.content) post.content = updates.content;
        if (updates.status) post.status = updates.status;
        post.updatedAt = new Date().toISOString();

        this.fallbackPosts.set(postId, post);
        
        return {
          id: post.id,
          title: post.title,
          status: post.status,
          updatedAt: post.updatedAt
        };
      }
    } catch (error) {
      if (error.message === 'Blog post not found') {
        throw error;
      }
      
      // Try fallback
      const post = this.fallbackPosts.get(postId);
      if (!post || post.userId !== userId) {
        throw new Error('Blog post not found');
      }

      if (updates.title) post.title = updates.title;
      if (updates.content) post.content = updates.content;
      if (updates.status) post.status = updates.status;
      post.updatedAt = new Date().toISOString();

      return {
        id: post.id,
        title: post.title,
        status: post.status,
        updatedAt: post.updatedAt
      };
    }
  }

  /**
   * Delete blog post (soft delete)
   */
  async deleteBlogPost(postId, userId) {
    try {
      if (this.databaseAvailable && this.useDatabaseStorage) {
        const result = await db.query(`
          UPDATE blog_posts 
          SET status = 'deleted', updated_at = NOW()
          WHERE id = $1 AND user_id = $2
          RETURNING id
        `, [postId, userId]);

        if (result.rows.length === 0) {
          throw new Error('Blog post not found');
        }

        return { success: true };
      } else {
        const post = this.fallbackPosts.get(postId);
        if (!post || post.userId !== userId) {
          throw new Error('Blog post not found');
        }

        this.fallbackPosts.delete(postId);
        return { success: true };
      }
    } catch (error) {
      if (error.message === 'Blog post not found') {
        throw error;
      }
      
      // Try fallback
      const post = this.fallbackPosts.get(postId);
      if (!post || post.userId !== userId) {
        throw new Error('Blog post not found');
      }

      this.fallbackPosts.delete(postId);
      return { success: true };
    }
  }

  /**
   * Record generation history
   */
  async recordGenerationHistory(userId, generationData) {
    if (!this.databaseAvailable || !this.useDatabaseStorage) {
      // Store in memory for fallback
      this.fallbackGenerations.push({
        id: uuidv4(),
        userId,
        ...generationData,
        createdAt: new Date().toISOString()
      });
      return;
    }

    try {
      await db.query(`
        INSERT INTO generation_history (
          id, user_id, type, input_data, output_data, tokens_used,
          duration_ms, success_status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `, [
        uuidv4(),
        userId,
        generationData.type,
        JSON.stringify(generationData.inputData),
        JSON.stringify(generationData.outputData),
        generationData.tokensUsed || 0,
        generationData.durationMs || 0,
        generationData.successStatus
      ]);
    } catch (error) {
      console.warn('Failed to record generation history:', error.message);
    }
  }

  /**
   * Get storage status
   */
  getStorageStatus() {
    return {
      useDatabaseStorage: this.useDatabaseStorage,
      databaseAvailable: this.databaseAvailable,
      mode: this.databaseAvailable && this.useDatabaseStorage ? 'database' : 'memory',
      fallbackPostCount: this.fallbackPosts.size,
      fallbackGenerationCount: this.fallbackGenerations.length
    };
  }
}

// Export singleton instance
const contentService = new ContentService();
export default contentService;