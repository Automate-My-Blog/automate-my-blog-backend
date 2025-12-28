import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import openaiService from './services/openai.js';
import webScraperService from './services/webscraper.js';
import DatabaseAuthService from './services/auth-database.js';
const authService = new DatabaseAuthService();
import contentService from './services/content.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configure Express to trust Vercel proxy for accurate IP detection
app.set('trust proxy', 1);

// Rate limiting with Vercel-compatible configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  // Use default key generator which properly handles IPv6
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

// Middleware
app.use(limiter);
app.use(cors({
  origin: [
    'https://automatemyblog.com',
    'https://www.automatemyblog.com',
    'https://automatemyblog.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const keyLength = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0;
  
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'AutoBlog API',
    env: {
      nodeEnv: process.env.NODE_ENV,
      hasOpenAIKey,
      openaiKeyLength: keyLength,
      openaiModel: process.env.OPENAI_MODEL || 'gpt-3.5-turbo'
    }
  });
});

// API routes index
app.get('/api', (req, res) => {
  res.json({
    message: 'AutoBlog API v1.0.0',
    description: 'AI-powered blog content generation API',
    version: '1.0.0',
    endpoints: {
      'GET /health': 'Health check endpoint',
      'POST /api/v1/auth/register': 'Register a new user account',
      'POST /api/v1/auth/login': 'Login with email and password',
      'GET /api/v1/auth/me': 'Get current user information (requires auth)',
      'POST /api/v1/auth/refresh': 'Refresh access token',
      'POST /api/v1/auth/logout': 'Logout user',
      'POST /api/analyze-website': 'Analyze website content and extract business information',
      'POST /api/trending-topics': 'Generate trending blog topics for a business',
      'POST /api/generate-content': 'Generate complete blog post content',
      'POST /api/analyze-changes': 'Analyze conceptual changes between content versions',
      'POST /api/export': 'Export blog content in different formats (markdown, html, json)',
      'GET /api/v1/blog-posts': 'Get user blog posts (requires auth)',
      'POST /api/v1/blog-posts': 'Create new blog post (requires auth)',
      'GET /api/v1/blog-posts/:id': 'Get specific blog post (requires auth)',
      'PUT /api/v1/blog-posts/:id': 'Update blog post (requires auth)',
      'DELETE /api/v1/blog-posts/:id': 'Delete blog post (requires auth)'
    },
    documentation: 'https://github.com/james-frankel-123/automatemyblog-backend'
  });
});

// Authentication Routes
// Register endpoint
app.post('/api/v1/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, organizationName } = req.body;

    // Validate required fields
    if (!email || !password || !firstName || !lastName || !organizationName) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'email, password, firstName, lastName, and organizationName are required'
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'Invalid email format',
        message: 'Please provide a valid email address'
      });
    }

    // Password validation
    if (password.length < 8) {
      return res.status(400).json({
        error: 'Invalid password',
        message: 'Password must be at least 8 characters long'
      });
    }

    const result = await authService.register({
      email: email.toLowerCase().trim(),
      password,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      organizationName: organizationName.trim()
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({
      error: 'Registration failed',
      message: error.message
    });
  }
});

// Login endpoint
app.post('/api/v1/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Missing credentials',
        message: 'Email and password are required'
      });
    }

    const result = await authService.login(email.toLowerCase().trim(), password);

    res.json({
      success: true,
      message: 'Login successful',
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({
      error: 'Login failed',
      message: error.message
    });
  }
});

// Get current user endpoint
app.get('/api/v1/auth/me', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const user = authService.getUserById(req.user.userId);
    
    res.json({
      success: true,
      user
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(404).json({
      error: 'User not found',
      message: error.message
    });
  }
});

// Refresh token endpoint
app.post('/api/v1/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: 'Missing refresh token',
        message: 'Refresh token is required'
      });
    }

    const tokens = await authService.refreshTokens(refreshToken);

    res.json({
      success: true,
      message: 'Tokens refreshed successfully',
      ...tokens
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({
      error: 'Token refresh failed',
      message: error.message
    });
  }
});

// Logout endpoint
app.post('/api/v1/auth/logout', (req, res) => {
  // For JWT-based auth, logout is typically handled client-side
  // by removing the tokens from storage
  res.json({
    success: true,
    message: 'Logout successful'
  });
});

// Analyze website endpoint
app.post('/api/analyze-website', async (req, res) => {
  console.log('=== Website Analysis Request ===');
  console.log('Request body:', req.body);
  console.log('Headers:', req.headers);
  console.log('User-Agent:', req.headers['user-agent']);
  
  try {
    const { url } = req.body;

    console.log('Analyzing URL:', url);

    if (!url) {
      console.log('Error: No URL provided');
      return res.status(400).json({
        error: 'URL is required',
        message: 'Please provide a valid website URL'
      });
    }

    if (!webScraperService.isValidUrl(url)) {
      console.log('Error: Invalid URL format:', url);
      return res.status(400).json({
        error: 'Invalid URL format',
        message: 'Please provide a valid HTTP or HTTPS URL'
      });
    }

    console.log('Starting website scraping...');
    // Scrape website content
    const scrapedContent = await webScraperService.scrapeWebsite(url);
    console.log('Scraping completed. Title:', scrapedContent.title);
    console.log('Content length:', scrapedContent.content?.length || 0);
    
    // Combine title, description, content for analysis
    const fullContent = `
      Title: ${scrapedContent.title}
      Meta Description: ${scrapedContent.metaDescription}
      Headings: ${scrapedContent.headings.join(', ')}
      Content: ${scrapedContent.content}
    `.trim();

    console.log('Starting OpenAI analysis...');
    // Analyze with OpenAI (using smart default colors)
    const analysis = await openaiService.analyzeWebsite(fullContent, url);
    console.log('OpenAI analysis completed:', analysis?.businessType || 'N/A');

    const response = {
      success: true,
      url,
      scrapedAt: scrapedContent.scrapedAt,
      analysis,
      metadata: {
        title: scrapedContent.title,
        headings: scrapedContent.headings
      }
    };

    console.log('Sending successful response');
    res.json(response);

  } catch (error) {
    console.error('=== Website Analysis Error ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('================================');
    
    res.status(500).json({
      error: 'Analysis failed',
      message: error.message
    });
  }
});

// Trending topics endpoint
app.post('/api/trending-topics', async (req, res) => {
  try {
    const { businessType, targetAudience, contentFocus } = req.body;

    if (!businessType || !targetAudience || !contentFocus) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'businessType, targetAudience, and contentFocus are required'
      });
    }

    const topics = await openaiService.generateTrendingTopics(
      businessType, 
      targetAudience, 
      contentFocus
    );

    res.json({
      success: true,
      businessType,
      targetAudience,
      contentFocus,
      topics,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Trending topics error:', error);
    res.status(500).json({
      error: 'Failed to generate trending topics',
      message: error.message
    });
  }
});

// Generate content endpoint (with optional auth for saving)
app.post('/api/generate-content', authService.optionalAuthMiddleware.bind(authService), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { topic, businessInfo, additionalInstructions, saveToAccount } = req.body;

    if (!topic || !businessInfo) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'topic and businessInfo are required'
      });
    }

    if (!topic.title || !topic.subheader) {
      return res.status(400).json({
        error: 'Invalid topic format',
        message: 'topic must include title and subheader'
      });
    }

    // Generate the blog post content
    const blogPost = await openaiService.generateBlogPost(
      topic,
      businessInfo,
      additionalInstructions || ''
    );

    const generationTime = Date.now() - startTime;
    let savedPost = null;

    // Save to user account if authenticated and requested
    if (req.user && (saveToAccount === true || saveToAccount === 'true')) {
      try {
        savedPost = await contentService.saveBlogPost(req.user.userId, {
          title: blogPost.title,
          content: blogPost.content,
          topic,
          businessInfo,
          generationMetadata: {
            tokensUsed: blogPost.tokensUsed || 0,
            generationTime,
            aiModel: 'gpt-4'
          },
          status: 'draft'
        });
        
        console.log(`✅ Blog post saved for user ${req.user.userId}: ${savedPost.id}`);
      } catch (saveError) {
        console.warn('Failed to save blog post:', saveError.message);
        // Don't fail the whole request if saving fails
      }
    }

    // Record generation history for authenticated users
    if (req.user) {
      await contentService.recordGenerationHistory(req.user.userId, {
        type: 'blog_post',
        inputData: { topic, businessInfo, additionalInstructions },
        outputData: { 
          title: blogPost.title, 
          wordCount: blogPost.content?.split(' ').length,
          savedPostId: savedPost?.id
        },
        tokensUsed: blogPost.tokensUsed || 0,
        durationMs: generationTime,
        successStatus: true,
        aiModel: 'gpt-4'
      });
    }

    const response = {
      success: true,
      topic,
      businessInfo: {
        businessType: businessInfo.businessType,
        targetAudience: businessInfo.targetAudience,
        brandVoice: businessInfo.brandVoice
      },
      blogPost,
      generatedAt: new Date().toISOString(),
      generationTimeMs: generationTime
    };

    // Include saved post info if applicable
    if (savedPost) {
      response.savedPost = savedPost;
      response.message = 'Blog post generated and saved to your account';
    }

    res.json(response);

  } catch (error) {
    console.error('Content generation error:', error);
    
    // Record failed generation for authenticated users
    if (req.user) {
      await contentService.recordGenerationHistory(req.user.userId, {
        type: 'blog_post',
        inputData: { topic: req.body.topic, businessInfo: req.body.businessInfo },
        outputData: { error: error.message },
        tokensUsed: 0,
        durationMs: Date.now() - startTime,
        successStatus: false,
        aiModel: 'gpt-4'
      });
    }

    res.status(500).json({
      error: 'Failed to generate content',
      message: error.message
    });
  }
});

// Analyze changes endpoint
app.post('/api/analyze-changes', async (req, res) => {
  try {
    const { previousContent, newContent, customFeedback } = req.body;

    if (!previousContent || !newContent) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'previousContent and newContent are required'
      });
    }

    if (previousContent === newContent) {
      return res.json({
        success: true,
        analysis: {
          summary: 'No changes detected in the content.',
          keyChanges: [],
          feedbackApplied: customFeedback ? 'No changes needed based on feedback.' : ''
        },
        analyzedAt: new Date().toISOString()
      });
    }

    console.log('Analyzing content changes...');
    console.log('Previous content length:', previousContent.length);
    console.log('New content length:', newContent.length);
    console.log('Custom feedback provided:', !!customFeedback);

    const analysis = await openaiService.analyzeContentChanges(
      previousContent,
      newContent,
      customFeedback || ''
    );

    res.json({
      success: true,
      analysis,
      analyzedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Change analysis error:', error);
    res.status(500).json({
      error: 'Failed to analyze changes',
      message: error.message
    });
  }
});

// Blog Posts CRUD Endpoints

// Get user's blog posts
app.get('/api/v1/blog-posts', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const {
      limit = 25,
      offset = 0,
      status = 'all',
      sortBy = 'created_at',
      order = 'DESC',
      search = ''
    } = req.query;

    const options = {
      limit: parseInt(limit),
      offset: parseInt(offset),
      status,
      sortBy,
      order,
      search
    };

    const result = await contentService.getUserBlogPosts(req.user.userId, options);

    res.json({
      success: true,
      data: {
        posts: result.posts,
        pagination: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          hasMore: result.hasMore
        }
      }
    });

  } catch (error) {
    console.error('Get blog posts error:', error);
    res.status(500).json({
      error: 'Failed to retrieve blog posts',
      message: error.message
    });
  }
});

// Create new blog post
app.post('/api/v1/blog-posts', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { title, content, topic, businessInfo, status = 'draft' } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'title and content are required'
      });
    }

    const savedPost = await contentService.saveBlogPost(req.user.userId, {
      title,
      content,
      topic,
      businessInfo,
      status
    });

    res.status(201).json({
      success: true,
      post: savedPost,
      message: 'Blog post created successfully'
    });

  } catch (error) {
    console.error('Create blog post error:', error);
    res.status(500).json({
      error: 'Failed to create blog post',
      message: error.message
    });
  }
});

// Get specific blog post
app.get('/api/v1/blog-posts/:id', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { id } = req.params;
    const post = await contentService.getBlogPost(id, req.user.userId);

    res.json({
      success: true,
      post
    });

  } catch (error) {
    console.error('Get blog post error:', error);
    
    if (error.message === 'Blog post not found') {
      res.status(404).json({
        error: 'Blog post not found',
        message: 'The requested blog post does not exist or you do not have access to it'
      });
    } else {
      res.status(500).json({
        error: 'Failed to retrieve blog post',
        message: error.message
      });
    }
  }
});

// Update blog post
app.put('/api/v1/blog-posts/:id', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, status } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'No updates provided',
        message: 'At least one field (title, content, status) must be provided'
      });
    }

    const updatedPost = await contentService.updateBlogPost(id, req.user.userId, updates);

    res.json({
      success: true,
      post: updatedPost,
      message: 'Blog post updated successfully'
    });

  } catch (error) {
    console.error('Update blog post error:', error);
    
    if (error.message === 'Blog post not found') {
      res.status(404).json({
        error: 'Blog post not found',
        message: 'The requested blog post does not exist or you do not have access to it'
      });
    } else {
      res.status(500).json({
        error: 'Failed to update blog post',
        message: error.message
      });
    }
  }
});

// Delete blog post
app.delete('/api/v1/blog-posts/:id', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { id } = req.params;
    await contentService.deleteBlogPost(id, req.user.userId);

    res.json({
      success: true,
      message: 'Blog post deleted successfully'
    });

  } catch (error) {
    console.error('Delete blog post error:', error);
    
    if (error.message === 'Blog post not found') {
      res.status(404).json({
        error: 'Blog post not found',
        message: 'The requested blog post does not exist or you do not have access to it'
      });
    } else {
      res.status(500).json({
        error: 'Failed to delete blog post',
        message: error.message
      });
    }
  }
});

// Export endpoint
app.post('/api/export', async (req, res) => {
  try {
    const { blogPost, format } = req.body;

    if (!blogPost || !format) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'blogPost and format are required'
      });
    }

    const supportedFormats = ['markdown', 'html', 'json'];
    if (!supportedFormats.includes(format.toLowerCase())) {
      return res.status(400).json({
        error: 'Unsupported format',
        message: `Supported formats: ${supportedFormats.join(', ')}`
      });
    }

    const exportedContent = await openaiService.generateExportContent(blogPost, format);

    // Set appropriate content type and filename
    let contentType = 'text/plain';
    let fileExtension = 'txt';
    
    switch (format.toLowerCase()) {
      case 'markdown':
        contentType = 'text/markdown';
        fileExtension = 'md';
        break;
      case 'html':
        contentType = 'text/html';
        fileExtension = 'html';
        break;
      case 'json':
        contentType = 'application/json';
        fileExtension = 'json';
        break;
    }

    const filename = `${blogPost.title?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'blog-post'}.${fileExtension}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(exportedContent);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      error: 'Export failed',
      message: error.message
    });
  }
});

// Test endpoint for OpenAI without web scraping
app.post('/api/test-openai', async (req, res) => {
  try {
    console.log('Testing OpenAI directly...');
    
    // First test basic OpenAI connectivity
    const OpenAI = (await import('openai')).default;
    const testClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    console.log('Testing basic OpenAI call...');
    const simpleTest = await testClient.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Say hello' }],
      max_tokens: 10
    });
    
    console.log('Basic test successful:', simpleTest.choices[0].message.content);
    
    // Now test our service
    const mockContent = `
      Title: Test Website
      Meta Description: A test website for debugging
      Headings: Welcome, About Us
      Content: This is a test website for debugging the OpenAI integration.
    `;

    const analysis = await openaiService.analyzeWebsite(mockContent, 'https://test.com');
    
    console.log('OpenAI test successful:', analysis);
    
    res.json({
      success: true,
      message: 'OpenAI is working correctly',
      basicTest: simpleTest.choices[0].message.content,
      analysis
    });

  } catch (error) {
    console.error('OpenAI test failed:', error);
    res.status(500).json({
      error: 'OpenAI test failed',
      message: error.message
    });
  }
});

// Impersonation middleware to check super admin permissions
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'You must be logged in to access this endpoint'
    });
  }

  // Check if user has impersonation permission
  if (!req.user.permissions || !req.user.permissions.includes('impersonate_users')) {
    return res.status(403).json({
      error: 'Access forbidden',
      message: 'Super admin privileges required for user impersonation'
    });
  }

  next();
};

// Get all users for admin management
app.get('/api/v1/admin/users', authService.authMiddleware.bind(authService), requireSuperAdmin, async (req, res) => {
  try {
    const { 
      limit = 50, 
      offset = 0, 
      search = '', 
      role = 'all',
      status = 'active',
      sortBy = 'created_at',
      order = 'DESC'
    } = req.query;

    // For super admins, get all platform users
    // For org admins, get only their organization users (future feature)
    const result = await authService.getAllUsers({
      limit: parseInt(limit),
      offset: parseInt(offset),
      search,
      role,
      status,
      sortBy,
      order
    });

    res.json({
      success: true,
      data: {
        users: result.users || result,
        pagination: {
          total: result.total || result.length,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: result.hasMore || false
        }
      }
    });

  } catch (error) {
    console.error('Get admin users error:', error);
    res.status(500).json({
      error: 'Failed to retrieve users',
      message: error.message
    });
  }
});

// Start impersonation session
app.post('/api/v1/admin/impersonate/:userId', authService.authMiddleware.bind(authService), requireSuperAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const adminUserId = req.user.userId;

    // Validate target user exists
    const targetUser = await authService.getUserById(userId);
    if (!targetUser) {
      return res.status(404).json({
        error: 'User not found',
        message: 'The specified user does not exist'
      });
    }

    // Prevent self-impersonation
    if (userId === adminUserId) {
      return res.status(400).json({
        error: 'Invalid operation',
        message: 'You cannot impersonate yourself'
      });
    }

    // Create impersonation session token
    const impersonationPayload = {
      userId: targetUser.id,
      email: targetUser.email,
      firstName: targetUser.firstName,
      lastName: targetUser.lastName,
      organizationName: targetUser.organizationName,
      planTier: targetUser.planTier,
      role: targetUser.role,
      permissions: targetUser.permissions,
      hierarchyLevel: targetUser.hierarchyLevel,
      isImpersonating: true,
      impersonatedBy: adminUserId,
      originalAdmin: {
        userId: req.user.userId,
        email: req.user.email,
        firstName: req.user.firstName,
        lastName: req.user.lastName
      }
    };

    const impersonationToken = jwt.sign(impersonationPayload, process.env.JWT_SECRET || 'fallback-secret-for-development', {
      expiresIn: '2h', // Shorter expiry for security
      issuer: 'autoblog-api'
    });

    // Log the impersonation for audit purposes
    await authService.logUserActivity(adminUserId, 'user_impersonation_started', {
      target_user_id: userId,
      target_user_email: targetUser.email,
      impersonation_duration: '2h'
    });

    res.json({
      success: true,
      message: `Now impersonating ${targetUser.firstName} ${targetUser.lastName}`,
      impersonationToken,
      targetUser: {
        id: targetUser.id,
        email: targetUser.email,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        organizationName: targetUser.organizationName,
        role: targetUser.role
      },
      expiresIn: '2h'
    });

  } catch (error) {
    console.error('Start impersonation error:', error);
    res.status(500).json({
      error: 'Failed to start impersonation',
      message: error.message
    });
  }
});

// End impersonation session
app.delete('/api/v1/admin/impersonate', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    // Check if currently impersonating
    if (!req.user.isImpersonating) {
      return res.status(400).json({
        error: 'Not impersonating',
        message: 'You are not currently impersonating any user'
      });
    }

    const originalAdminId = req.user.impersonatedBy;
    const impersonatedUserId = req.user.userId;

    // Log the end of impersonation
    await authService.logUserActivity(originalAdminId, 'user_impersonation_ended', {
      target_user_id: impersonatedUserId,
      target_user_email: req.user.email,
      impersonation_ended_by: 'admin'
    });

    res.json({
      success: true,
      message: 'Impersonation session ended',
      originalAdmin: req.user.originalAdmin
    });

  } catch (error) {
    console.error('End impersonation error:', error);
    res.status(500).json({
      error: 'Failed to end impersonation',
      message: error.message
    });
  }
});

// Get user details for admin (enhanced user info)
app.get('/api/v1/admin/users/:userId', authService.authMiddleware.bind(authService), requireSuperAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await authService.getUserById(userId);
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'The specified user does not exist'
      });
    }

    // Get additional admin-only information
    // This could include session history, activity logs, etc.
    res.json({
      success: true,
      user: {
        ...user,
        canImpersonate: userId !== req.user.userId // Can't impersonate self
      }
    });

  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({
      error: 'Failed to retrieve user details',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AutoBlog API server running on port ${PORT} (v2.0 - auth fix deployed)`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 API base: http://localhost:${PORT}/api`);
});

export default app;