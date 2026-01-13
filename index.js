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
import referralService from './services/referrals.js';
import billingService from './services/billing.js';
import leadService from './services/leads.js';
import organizationService from './services/organizations.js';
import projectsService from './services/projects.js';
import db from './services/database.js';
import enhancedBlogGenerationService from './services/enhanced-blog-generation.js';
import sessionRoutes from './routes/session.js';
import audienceRoutes from './routes/audiences.js';
import keywordRoutes from './routes/keywords.js';
import userRoutes from './routes/users.js';
import postsRoutes from './routes/posts.js';
import analysisRoutes from './routes/analysis.js';
import seoAnalysisRoutes from './routes/seo-analysis.js';
import contentUploadRoutes from './routes/content-upload.js';
import manualInputRoutes from './routes/manual-inputs.js';
import visualContentRoutes from './routes/visual-content.js';
import enhancedBlogGenerationRoutes from './routes/enhanced-blog-generation.js';

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
// CORS configuration - restored to working version
app.use(cors({
  origin: [
    'https://automatemyblog.com',
    'https://www.automatemyblog.com',
    'https://automatemyblog.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002'
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id'],
  credentials: true
}));

// JSON parsing with proper error handling
app.use((req, res, next) => {
  express.json({ limit: '10mb' })(req, res, (err) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({
        error: 'Invalid JSON format',
        message: 'The request body contains malformed JSON'
      });
    }
    next(err);
  });
});

app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API Routes
app.use('/api/v1/session', sessionRoutes);
app.use('/api/v1/audiences', authService.optionalAuthMiddleware.bind(authService), audienceRoutes);
app.use('/api/v1/keywords', authService.optionalAuthMiddleware.bind(authService), keywordRoutes);
app.use('/api/v1/users', authService.optionalAuthMiddleware.bind(authService), userRoutes);
app.use('/api/v1/posts', authService.optionalAuthMiddleware.bind(authService), postsRoutes);
app.use('/api/v1/analysis', authService.optionalAuthMiddleware.bind(authService), analysisRoutes);
app.use('/api/v1/seo-analysis', authService.authMiddleware.bind(authService), seoAnalysisRoutes);
app.use('/api/v1/content-upload', authService.authMiddleware.bind(authService), contentUploadRoutes);
app.use('/api/v1/manual-inputs', authService.authMiddleware.bind(authService), manualInputRoutes);
app.use('/api/v1/visual-content', authService.authMiddleware.bind(authService), visualContentRoutes);
app.use('/api/v1/enhanced-blog-generation', authService.authMiddleware.bind(authService), enhancedBlogGenerationRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const keyLength = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0;
  
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'AutoBlog API',
    version: 'v2.0-auth-fix-deployed',
    authSystemStatus: authService.getStorageStatus(),
    env: {
      nodeEnv: process.env.NODE_ENV,
      hasOpenAIKey,
      openaiKeyLength: keyLength,
      openaiModel: process.env.OPENAI_MODEL || 'gpt-3.5-turbo'
    }
  });
});

// Debug endpoint to check what headers are actually received
app.get('/api/v1/debug/headers', (req, res) => {
  res.json({
    success: true,
    headers: req.headers,
    hasAuth: !!req.headers.authorization,
    hasSessionId: !!req.headers['x-session-id'],
    authHeader: req.headers.authorization ? 'Bearer ***' : null,
    sessionId: req.headers['x-session-id'] || null,
    timestamp: new Date().toISOString()
  });
});

// Test direct audiences endpoint without router (for comparison)
app.get('/api/v1/audiences-direct', authService.optionalAuthMiddleware.bind(authService), async (req, res) => {
  console.log('🧪 DIRECT AUDIENCES ENDPOINT - Header comparison test');
  res.json({
    success: true,
    message: 'Direct audiences endpoint for header testing',
    hasAuth: !!req.user,
    userId: req.user?.userId || null,
    timestamp: new Date().toISOString()
  });
});

// Production Environment Validation Endpoint
app.get('/api/v1/debug/production-env', async (req, res) => {
  const debugId = `env_debug_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
  console.log(`🔍 [${debugId}] Production environment validation requested`);
  
  try {
    // Test database connection with full debugging
    const dbTestResult = await db.testConnection();
    const dbHealthStats = await db.getHealthStats();
    const authStatus = authService.getStorageStatus();
    
    // Test auth service database connection specifically
    const authDbTestResult = await authService.testDatabaseConnection();
    
    const envValidation = {
      timestamp: new Date().toISOString(),
      debugId: debugId,
      environment: {
        nodeEnv: process.env.NODE_ENV,
        isProduction: process.env.NODE_ENV === 'production',
        platform: process.platform,
        nodeVersion: process.version
      },
      database: {
        connectionTest: dbTestResult,
        healthStats: dbHealthStats,
        hasUrl: !!process.env.DATABASE_URL,
        urlStart: process.env.DATABASE_URL?.substring(0, 20) || 'Not set',
        urlLength: process.env.DATABASE_URL?.length || 0,
        urlProtocol: process.env.DATABASE_URL?.split('://')[0] || 'none'
      },
      authService: {
        ...authStatus,
        connectionTest: authDbTestResult,
        useDatabaseStorage: process.env.USE_DATABASE === 'true'
      },
      environment: {
        databaseUrl: {
          exists: !!process.env.DATABASE_URL,
          format: process.env.DATABASE_URL ? 'connection_string' : 'individual_params'
        },
        individualParams: {
          dbUser: !!process.env.DB_USER,
          dbHost: !!process.env.DB_HOST,
          dbName: !!process.env.DB_NAME,
          dbPassword: !!process.env.DB_PASSWORD,
          dbPort: !!process.env.DB_PORT
        },
        apiKeys: {
          hasOpenAI: !!process.env.OPENAI_API_KEY,
          hasJwtSecret: !!process.env.JWT_SECRET,
          hasJwtRefreshSecret: !!process.env.JWT_REFRESH_SECRET
        }
      },
      diagnostics: {
        canConnectToDatabase: dbTestResult,
        authUsingDatabase: authDbTestResult,
        potentialIssues: []
      }
    };
    
    // Add potential issue detection
    if (!dbTestResult) {
      envValidation.diagnostics.potentialIssues.push('Database connection test failed');
    }
    
    if (!authDbTestResult) {
      envValidation.diagnostics.potentialIssues.push('Auth service cannot connect to database - will use memory fallback');
    }
    
    if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
      envValidation.diagnostics.potentialIssues.push('Production environment missing DATABASE_URL');
    }
    
    if (!process.env.OPENAI_API_KEY) {
      envValidation.diagnostics.potentialIssues.push('Missing OPENAI_API_KEY');
    }
    
    console.log(`✅ [${debugId}] Environment validation completed:`, {
      dbTest: dbTestResult,
      authTest: authDbTestResult,
      issues: envValidation.diagnostics.potentialIssues.length
    });
    
    res.json({
      success: true,
      validation: envValidation
    });
    
  } catch (error) {
    console.error(`❌ [${debugId}] Environment validation failed:`, {
      message: error.message,
      stack: error.stack?.split('\n')[0]
    });
    
    res.status(500).json({
      success: false,
      error: 'Environment validation failed',
      message: error.message,
      debugId: debugId
    });
  }
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
      'DELETE /api/v1/blog-posts/:id': 'Delete blog post (requires auth)',
      'PUT /api/v1/user/profile': 'Update user profile (requires auth)',
      'POST /api/v1/user/change-password': 'Change user password (requires auth)',
      'GET /api/v1/user/credits': 'Get user credits and billing info (requires auth)',
      'POST /api/v1/user/apply-rewards': 'Apply pending referral rewards (requires auth)', 
      'GET /api/v1/user/usage-history': 'Get usage history and analytics (requires auth)',
      'POST /api/v1/user/request-plan-change': 'Request plan upgrade/change (requires auth)',
      'GET /api/v1/user/billing-history': 'Get billing history and invoices (requires auth)',
      'PUT /api/v1/user/billing-info': 'Update billing information (requires auth)',
      'GET /api/v1/referrals/link': 'Generate personal referral link (requires auth)',
      'POST /api/v1/referrals/invite': 'Send referral invitation for customer acquisition (requires auth)',
      'GET /api/v1/referrals/stats': 'Get referral statistics and earnings (requires auth)',
      'POST /api/v1/referrals/process-signup': 'Process referral signup and grant rewards (requires auth)',
      'PUT /api/v1/organization/profile': 'Update organization name and website (requires auth)',
      'POST /api/v1/organization/invite': 'Send organization team member invitation (requires auth)',
      'GET /api/v1/organization/members': 'Get organization members list (requires auth)',
      'DELETE /api/v1/organization/members/:id': 'Remove organization member (requires auth)',
      'GET /api/v1/admin/leads': 'Get website leads with filters (super admin only)',
      'GET /api/v1/admin/leads/analytics': 'Get lead analytics and metrics (super admin only)',
      'GET /api/v1/admin/leads/:id': 'Get detailed lead information (super admin only)',
      'PUT /api/v1/admin/leads/:id/status': 'Update lead status (super admin only)',
      'GET /api/v1/admin/organizations': 'Get organizations with business intelligence (super admin only)',
      'GET /api/v1/admin/organizations/:id': 'Get organization profile with full intelligence data (super admin only)',
      'GET /api/v1/admin/organizations/:id/contacts': 'Get organization contacts and decision makers (super admin only)',
      'GET /api/v1/admin/organizations/:id/intelligence': 'Get organization intelligence analysis (super admin only)'
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
    const user = await authService.getUserById(req.user.userId);
    
    // Debug logging to verify role data is being returned
    console.log('🔍 /me endpoint returning user data:', {
      userId: user.id,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
      hierarchyLevel: user.hierarchyLevel
    });
    
    // CRITICAL DEBUG: Check if this user exists in database for audience queries
    const userExistsCheck = await db.query('SELECT id, email FROM users WHERE id = $1', [req.user.userId]);
    console.log('🔍 /me endpoint - User exists in database check:', {
      requestUserId: req.user.userId,
      userFoundInDb: userExistsCheck.rows.length > 0,
      dbUserData: userExistsCheck.rows[0] || 'NOT_FOUND'
    });
    
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

// Get user's most recent website analysis endpoint
app.get('/api/v1/user/recent-analysis', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log(`📊 Getting most recent analysis for user: ${userId}`);
    
    const recentAnalysis = await projectsService.getUserMostRecentAnalysis(userId);
    
    if (!recentAnalysis) {
      return res.json({
        success: true,
        analysis: null,
        message: 'No analysis found for this user'
      });
    }
    
    console.log(`✅ Found recent analysis: ${recentAnalysis.websiteUrl} (updated: ${recentAnalysis.updatedAt})`);
    
    res.json({
      success: true,
      analysis: recentAnalysis,
      message: 'Recent analysis retrieved successfully'
    });

  } catch (error) {
    console.error('Get recent analysis error:', error);
    res.status(500).json({
      error: 'Failed to retrieve recent analysis',
      message: error.message
    });
  }
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

    // Capture website lead for anonymous users (for super admin analytics)
    try {
      const sessionInfo = {
        ipAddress: req.ip || req.connection?.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        referrer: req.headers['referer'] || req.headers['referrer'] || null
      };
      
      await leadService.captureLead(url, analysis, sessionInfo);
      console.log('📊 Lead captured for website analysis:', analysis?.businessName || url);
    } catch (leadError) {
      // Don't fail the main request if lead capture fails
      console.warn('Failed to capture lead:', leadError.message);
    }

    // Save analysis to organizations and organization intelligence tables with session support
    try {
      const sessionId = req.headers['x-session-id'];
      const token = req.headers.authorization?.replace('Bearer ', '');
      let userId = null;
      
      // Extract user ID from JWT token if authenticated
      if (token) {
        try {
          const jwt = await import('jsonwebtoken');
          const payload = jwt.default.verify(token, process.env.JWT_SECRET || 'fallback-secret-for-development');
          userId = payload.userId;
          console.log('🔍 Authenticated user found for organization intelligence save:', userId);
        } catch (jwtError) {
          console.warn('Failed to extract user from JWT:', jwtError.message);
        }
      }
      
      // Only save if we have either userId or sessionId
      if (userId || sessionId) {
        const { v4: uuidv4 } = await import('uuid');
        const now = new Date();
        
        // Create organization name from business name or URL
        const organizationName = analysis?.businessName || analysis?.companyName || new URL(url).hostname;
        
        const organizationData = {
          name: organizationName,
          website_url: url,
          business_type: analysis?.businessType,
          industry_category: analysis?.industryCategory,
          business_model: analysis?.businessModel,
          company_size: analysis?.companySize,
          description: analysis?.description,
          target_audience: analysis?.targetAudience,
          brand_voice: analysis?.brandVoice,
          website_goals: analysis?.websiteGoals,
          search_behavior_summary: analysis?.searchBehavior,
          last_analyzed_at: now
        };
        
        const intelligenceData = {
          customer_scenarios: analysis?.customerScenarios ? JSON.stringify(analysis.customerScenarios) : null,
          business_value_assessment: analysis?.businessValueAssessment ? JSON.stringify(analysis.businessValueAssessment) : null,
          customer_language_patterns: analysis?.customerLanguagePatterns ? JSON.stringify(analysis.customerLanguagePatterns) : null,
          search_behavior_insights: analysis?.searchBehaviorInsights ? JSON.stringify(analysis.searchBehaviorInsights) : null,
          seo_opportunities: analysis?.seoOpportunities ? JSON.stringify(analysis.seoOpportunities) : null,
          content_strategy_recommendations: analysis?.contentStrategyRecommendations ? JSON.stringify(analysis.contentStrategyRecommendations) : null,
          competitive_intelligence: analysis?.competitiveIntelligence ? JSON.stringify(analysis.competitiveIntelligence) : null,
          analysis_confidence_score: analysis?.analysisConfidenceScore || 0.75,
          data_sources: analysis?.dataSources ? JSON.stringify(analysis.dataSources) : JSON.stringify(['website_analysis']),
          ai_model_used: analysis?.aiModelUsed || 'gpt-4',
          raw_openai_response: analysis?.rawOpenaiResponse ? JSON.stringify(analysis.rawOpenaiResponse) : null,
          is_current: true
        };
        
        // Check if organization already exists for this user/session and URL
        let existingOrganization = null;
        if (userId) {
          const existingResult = await db.query(
            'SELECT id FROM organizations WHERE owner_user_id = $1 AND website_url = $2 ORDER BY updated_at DESC LIMIT 1',
            [userId, url]
          );
          existingOrganization = existingResult.rows[0];
        } else if (sessionId) {
          const existingResult = await db.query(
            'SELECT id FROM organizations WHERE session_id = $1 AND website_url = $2 ORDER BY updated_at DESC LIMIT 1',
            [sessionId, url]
          );
          existingOrganization = existingResult.rows[0];
        }
        
        let organizationId;
        
        if (existingOrganization) {
          // Update existing organization
          organizationId = existingOrganization.id;
          
          const updateFields = [];
          const updateValues = [];
          let paramIndex = 1;
          
          for (const [key, value] of Object.entries(organizationData)) {
            if (key !== 'name') { // Don't update name usually
              updateFields.push(`${key} = $${paramIndex}`);
              updateValues.push(value);
              paramIndex++;
            }
          }
          updateFields.push(`updated_at = NOW()`);
          updateValues.push(organizationId);
          
          await db.query(
            `UPDATE organizations SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
            updateValues
          );
          
          console.log('✅ Updated existing organization:', organizationId);
          
          // Mark previous intelligence records as not current
          await db.query(
            'UPDATE organization_intelligence SET is_current = FALSE WHERE organization_id = $1',
            [organizationId]
          );
          
        } else {
          // Create new organization
          organizationId = uuidv4();
          
          const insertFields = ['id', 'slug', ...Object.keys(organizationData), 'created_at', 'updated_at'];
          const orgSlug = organizationName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').substring(0, 100);
          const insertValues = [organizationId, orgSlug, ...Object.values(organizationData), now, now];
          
          // Add owner_user_id or session_id
          if (userId) {
            insertFields.push('owner_user_id');
            insertValues.push(userId);
          } else {
            insertFields.push('session_id');
            insertValues.push(sessionId);
          }
          
          const insertPlaceholders = insertFields.map((_, i) => `$${i + 1}`).join(', ');
          
          await db.query(
            `INSERT INTO organizations (${insertFields.join(', ')}) VALUES (${insertPlaceholders})`,
            insertValues
          );
          
          console.log('✅ Created new organization for:', userId ? `user ${userId}` : `session ${sessionId}`);
        }
        
        // Create new intelligence record
        const intelligenceId = uuidv4();
        const intelInsertFields = ['id', 'organization_id', ...Object.keys(intelligenceData), 'created_at', 'updated_at'];
        const intelInsertValues = [intelligenceId, organizationId, ...Object.values(intelligenceData), now, now];
        
        // Add session_id for session-based intelligence (organization_id will be null for sessions)
        if (!userId && sessionId) {
          intelInsertFields.push('session_id');
          intelInsertValues.push(sessionId);
          // Remove organization_id for session-based records
          const orgIdIndex = intelInsertFields.indexOf('organization_id');
          intelInsertFields.splice(orgIdIndex, 1);
          intelInsertValues.splice(orgIdIndex, 1);
        }
        
        const intelInsertPlaceholders = intelInsertFields.map((_, i) => `$${i + 1}`).join(', ');
        
        await db.query(
          `INSERT INTO organization_intelligence (${intelInsertFields.join(', ')}) VALUES (${intelInsertPlaceholders})`,
          intelInsertValues
        );
        
        console.log('✅ Created new organization intelligence record');
        
      } else {
        console.warn('⚠️ No userId or sessionId available - analysis not saved to database');
      }
    } catch (saveError) {
      // Don't fail the main request if saving to database fails
      console.error('Failed to save organization intelligence to database:', saveError.message);
    }

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

// Generate content endpoint (with optional auth for saving) - Enhanced with Phase 3 features
app.post('/api/generate-content', authService.optionalAuthMiddleware.bind(authService), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { 
      topic, 
      businessInfo, 
      additionalInstructions, 
      saveToAccount,
      // Enhanced Phase 3 parameters (backward compatible)
      organizationId,
      useEnhancedGeneration = false,
      targetSEOScore = 95,
      includeVisuals = false,
      iterativeOptimization = false
    } = req.body;

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

    // Generate the blog post content using enhanced or basic generation
    let blogPost;
    let visualSuggestions = [];
    let qualityPrediction = null;
    
    if (useEnhancedGeneration && organizationId) {
      console.log(`🚀 Using enhanced blog generation for organization: ${organizationId}`);
      console.log(`📊 Enhanced generation parameters:`, {
        organizationId,
        targetSEOScore,
        includeVisuals,
        iterativeOptimization,
        hasBusinessInfo: !!businessInfo,
        hasTopic: !!topic
      });
      
      if (iterativeOptimization) {
        // Use iterative optimization to reach target score
        const optimizationResult = await enhancedBlogGenerationService.generateWithOptimization(
          topic,
          businessInfo,
          organizationId,
          targetSEOScore,
          { additionalInstructions: additionalInstructions || '', includeVisuals }
        );
        blogPost = optimizationResult.bestResult;
        qualityPrediction = optimizationResult.finalScore;
      } else {
        // Use enhanced generation
        try {
          console.log(`📝 Starting enhanced blog generation...`);
          const enhancedResult = await enhancedBlogGenerationService.generateCompleteEnhancedBlog(
            topic,
            businessInfo,
            organizationId,
            { 
              additionalInstructions: additionalInstructions || '', 
              includeVisuals 
            }
          );
          console.log(`✅ Enhanced generation completed successfully`);
          console.log(`🎨 Visual suggestions received:`, {
            count: enhancedResult.visualContentSuggestions?.length || 0,
            hasVisualSuggestions: !!enhancedResult.visualContentSuggestions,
            suggestions: enhancedResult.visualContentSuggestions
          });
          blogPost = enhancedResult;
          visualSuggestions = enhancedResult.visualContentSuggestions || [];
          qualityPrediction = enhancedResult.qualityPrediction;
        } catch (enhancedError) {
          console.error(`❌ Enhanced generation failed:`, enhancedError.message);
          console.error(`📊 Error details:`, {
            name: enhancedError.name,
            stack: enhancedError.stack?.split('\n')[0],
            organizationId
          });
          throw enhancedError;
        }
      }
    } else {
      console.log('📝 Using basic blog generation');
      // Use existing basic generation
      blogPost = await openaiService.generateBlogPost(
        topic,
        businessInfo,
        additionalInstructions || ''
      );
    }

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
      generationTimeMs: generationTime,
      // Enhanced features (only included if used)
      ...(useEnhancedGeneration && {
        enhanced: true,
        organizationId,
        targetSEOScore,
        qualityPrediction,
        visualSuggestions: visualSuggestions, // Always include, even if empty
        visualSuggestionsDebug: {
          count: visualSuggestions.length,
          hasVisuals: visualSuggestions.length > 0
        },
        // Include enhanced metadata if available
        ...(blogPost.seoOptimizationScore && { 
          seoAnalysis: {
            score: blogPost.seoOptimizationScore,
            keywords: blogPost.seoKeywords || [],
            recommendations: blogPost.seoRecommendations || []
          }
        }),
        ...(blogPost.organizationContext && {
          contentQuality: {
            enhancementLevel: blogPost.organizationContext.enhancementLevel,
            dataCompleteness: blogPost.organizationContext.dataCompleteness,
            hasWebsiteData: blogPost.organizationContext.hasWebsiteData,
            hasManualInputs: blogPost.organizationContext.hasManualInputs
          }
        }),
        ...(blogPost.internalLinks && { 
          strategicElements: {
            internalLinks: blogPost.internalLinks,
            ctaSuggestions: blogPost.ctaSuggestions || []
          }
        }),
        ...(blogPost.enhancementRecommendations && {
          improvementSuggestions: blogPost.enhancementRecommendations
        }),
        ...(iterativeOptimization && { 
          optimization: {
            targetReached: qualityPrediction >= targetSEOScore,
            finalScore: qualityPrediction
          }
        })
      })
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

// =============================================================================
// WEBSITE LEAD MANAGEMENT API ENDPOINTS (Super Admin Only)
// =============================================================================

// Get all website leads with filtering and pagination
app.get('/api/v1/admin/leads', authService.authMiddleware.bind(authService), requireSuperAdmin, async (req, res) => {
  try {
    const options = {
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0,
      status: req.query.status || 'all',
      source: req.query.source || 'all',
      minScore: parseInt(req.query.minScore) || 0,
      maxScore: parseInt(req.query.maxScore) || 100,
      dateRange: req.query.dateRange || 'all',
      search: req.query.search || '',
      sortBy: req.query.sortBy || 'created_at',
      sortOrder: req.query.sortOrder || 'DESC'
    };

    const result = await leadService.getLeads(options);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({
      error: 'Failed to get leads',
      message: error.message
    });
  }
});

// Get lead analytics and metrics
app.get('/api/v1/admin/leads/analytics', authService.authMiddleware.bind(authService), requireSuperAdmin, async (req, res) => {
  try {
    const dateRange = req.query.dateRange || 'month';
    const analytics = await leadService.getLeadAnalytics(dateRange);
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Get lead analytics error:', error);
    res.status(500).json({
      error: 'Failed to get lead analytics',
      message: error.message
    });
  }
});

// Get detailed information for a specific lead
app.get('/api/v1/admin/leads/:leadId', authService.authMiddleware.bind(authService), requireSuperAdmin, async (req, res) => {
  try {
    const { leadId } = req.params;
    const leadDetails = await leadService.getLeadDetails(leadId);
    
    res.json({
      success: true,
      data: leadDetails
    });
  } catch (error) {
    console.error('Get lead details error:', error);
    res.status(500).json({
      error: 'Failed to get lead details',
      message: error.message
    });
  }
});

// Update lead status
app.put('/api/v1/admin/leads/:leadId/status', authService.authMiddleware.bind(authService), requireSuperAdmin, async (req, res) => {
  try {
    const { leadId } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'Status is required'
      });
    }

    const result = await leadService.updateLeadStatus(leadId, status, notes || '');
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Update lead status error:', error);
    res.status(500).json({
      error: 'Failed to update lead status',
      message: error.message
    });
  }
});

// =============================================================================
// ORGANIZATION INTELLIGENCE API ENDPOINTS (Super Admin Only)
// =============================================================================

// Get all organizations with business intelligence data
app.get('/api/v1/admin/organizations', authService.authMiddleware.bind(authService), requireSuperAdmin, async (req, res) => {
  try {
    const options = {
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0,
      search: req.query.search || '',
      industry: req.query.industry || 'all',
      sortBy: req.query.sortBy || 'last_analyzed_at',
      sortOrder: req.query.sortOrder || 'DESC'
    };

    // Build query for organizations with intelligence data
    let whereConditions = [];
    let queryParams = [];
    let paramIndex = 1;

    // Industry filter
    if (options.industry !== 'all') {
      whereConditions.push(`o.industry_category = $${paramIndex}`);
      queryParams.push(options.industry);
      paramIndex++;
    }

    // Search filter
    if (options.search && options.search.length > 0) {
      whereConditions.push(`(
        LOWER(o.name) LIKE $${paramIndex} OR 
        LOWER(o.website_url) LIKE $${paramIndex} OR
        LOWER(o.business_type) LIKE $${paramIndex}
      )`);
      queryParams.push(`%${options.search.toLowerCase()}%`);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    // Validate sort parameters
    const allowedSortFields = ['name', 'last_analyzed_at', 'created_at', 'business_type'];
    const safeSortBy = allowedSortFields.includes(options.sortBy) ? `o.${options.sortBy}` : 'o.last_analyzed_at';
    const safeSortOrder = options.sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Get organizations with intelligence summary
    const orgResult = await db.query(`
      SELECT 
        o.id,
        o.name,
        o.website_url,
        o.business_type,
        o.industry_category,
        o.business_model,
        o.company_size,
        o.description,
        o.target_audience,
        o.brand_voice,
        o.website_goals,
        o.last_analyzed_at,
        o.created_at,
        o.updated_at,
        -- Intelligence summary
        oi.analysis_confidence_score,
        (oi.customer_scenarios::jsonb -> 0 ->> 'problem') as primary_customer_problem,
        COALESCE(jsonb_array_length(oi.customer_scenarios::jsonb), 0) as scenarios_count,
        -- Contact counts
        COUNT(oc.id) as contacts_count,
        COUNT(CASE WHEN oc.role_type = 'decision_maker' THEN 1 END) as decision_makers_count,
        -- Lead counts
        COUNT(wl.id) as leads_count,
        AVG(ls.overall_score) as avg_lead_score
      FROM organizations o
      LEFT JOIN organization_intelligence oi ON o.id = oi.organization_id AND oi.is_current = TRUE
      LEFT JOIN organization_contacts oc ON o.id = oc.organization_id
      LEFT JOIN website_leads wl ON o.id = wl.organization_id
      LEFT JOIN lead_scoring ls ON wl.id = ls.website_lead_id
      ${whereClause}
      GROUP BY o.id, o.name, o.website_url, o.business_type, o.industry_category, 
               o.business_model, o.company_size, o.description, o.target_audience, 
               o.brand_voice, o.website_goals, o.last_analyzed_at, o.created_at, o.updated_at,
               oi.analysis_confidence_score, oi.customer_scenarios
      ORDER BY ${safeSortBy} ${safeSortOrder}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...queryParams, options.limit, options.offset]);

    // Get total count for pagination
    const countResult = await db.query(`
      SELECT COUNT(DISTINCT o.id) as total
      FROM organizations o
      LEFT JOIN organization_intelligence oi ON o.id = oi.organization_id AND oi.is_current = TRUE
      ${whereClause}
    `, queryParams);

    const total = parseInt(countResult.rows[0]?.total || 0);

    res.json({
      success: true,
      data: {
        organizations: orgResult.rows.map(org => ({
          id: org.id,
          name: org.name,
          websiteUrl: org.website_url,
          businessType: org.business_type,
          industryCategory: org.industry_category,
          businessModel: org.business_model,
          companySize: org.company_size,
          description: org.description,
          targetAudience: org.target_audience,
          brandVoice: org.brand_voice,
          websiteGoals: org.website_goals,
          lastAnalyzedAt: org.last_analyzed_at,
          createdAt: org.created_at,
          updatedAt: org.updated_at,
          // Intelligence metrics
          analysisConfidenceScore: parseFloat(org.analysis_confidence_score || 0),
          primaryCustomerProblem: org.primary_customer_problem,
          scenariosCount: parseInt(org.scenarios_count),
          contactsCount: parseInt(org.contacts_count),
          decisionMakersCount: parseInt(org.decision_makers_count),
          leadsCount: parseInt(org.leads_count),
          averageLeadScore: parseFloat(org.avg_lead_score || 0).toFixed(1)
        })),
        pagination: {
          total,
          limit: options.limit,
          offset: options.offset,
          hasMore: options.offset + options.limit < total,
          totalPages: Math.ceil(total / options.limit),
          currentPage: Math.floor(options.offset / options.limit) + 1
        }
      }
    });
  } catch (error) {
    console.error('Get organizations error:', error);
    res.status(500).json({
      error: 'Failed to get organizations',
      message: error.message
    });
  }
});

// Get detailed organization profile with full intelligence data
app.get('/api/v1/admin/organizations/:id', authService.authMiddleware.bind(authService), requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Import organization service to get full profile
    const { default: organizationService } = await import('./services/organizations.js');
    const profile = await organizationService.getOrganizationProfile(id);
    
    // Get related leads for this organization
    const leadsResult = await db.query(`
      SELECT 
        wl.id,
        wl.website_url,
        wl.business_name,
        wl.lead_source,
        wl.status,
        wl.created_at,
        ls.overall_score as lead_score
      FROM website_leads wl
      LEFT JOIN lead_scoring ls ON wl.id = ls.website_lead_id
      WHERE wl.organization_id = $1
      ORDER BY wl.created_at DESC
      LIMIT 10
    `, [id]);

    res.json({
      success: true,
      data: {
        ...profile,
        relatedLeads: leadsResult.rows.map(lead => ({
          id: lead.id,
          websiteUrl: lead.website_url,
          businessName: lead.business_name,
          leadSource: lead.lead_source,
          status: lead.status,
          leadScore: parseInt(lead.lead_score || 0),
          createdAt: lead.created_at
        }))
      }
    });
  } catch (error) {
    console.error('Get organization details error:', error);
    res.status(500).json({
      error: 'Failed to get organization details',
      message: error.message
    });
  }
});


// =============================================================================
// USER MANAGEMENT API ENDPOINTS  
// =============================================================================

// Update user profile
app.put('/api/v1/user/profile', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    const userId = req.user.userId;

    // Validate required fields
    if (!firstName || !lastName || !email) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'firstName, lastName, and email are required'
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

    const updates = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim()
    };

    const updatedUser = await authService.updateUserProfile(userId, updates);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      error: 'Failed to update profile',
      message: error.message
    });
  }
});

// Update organization information
app.put('/api/v1/organization/profile', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { organizationName, websiteUrl } = req.body;
    const userId = req.user.userId;

    // Validate that user has permission to update organization
    const userOrgResult = await db.query(`
      SELECT om.role, o.id as organization_id, o.name as current_name, o.website_url as current_website 
      FROM organization_members om
      JOIN organizations o ON om.organization_id = o.id
      WHERE om.user_id = $1 AND om.status = 'active'
    `, [userId]);

    if (userOrgResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Organization not found',
        message: 'User is not a member of any organization'
      });
    }

    const userOrg = userOrgResult.rows[0];
    
    // Only owners can update organization details
    if (userOrg.role !== 'owner') {
      return res.status(403).json({
        error: 'Permission denied',
        message: 'Only organization owners can update organization details'
      });
    }

    // Build update query
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (organizationName && organizationName.trim() && organizationName.trim() !== userOrg.current_name) {
      updates.push(`name = $${paramIndex}`);
      values.push(organizationName.trim());
      paramIndex++;
    }

    if (websiteUrl !== undefined && websiteUrl !== userOrg.current_website) {
      updates.push(`website_url = $${paramIndex}`);
      values.push(websiteUrl?.trim() || null);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.json({
        success: true,
        message: 'No changes to update',
        organization: {
          id: userOrg.organization_id,
          name: userOrg.current_name,
          websiteUrl: userOrg.current_website
        }
      });
    }

    // Update organization
    updates.push(`updated_at = NOW()`);
    values.push(userOrg.organization_id);

    const updateQuery = `
      UPDATE organizations 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, name, website_url as "websiteUrl", updated_at
    `;

    const result = await db.query(updateQuery, values);

    res.json({
      success: true,
      message: 'Organization updated successfully',
      organization: result.rows[0]
    });

  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({
      error: 'Failed to update organization',
      message: error.message
    });
  }
});

// =============================================================================
// BILLING AND USAGE API ENDPOINTS  
// =============================================================================

// Get user's credits and billing info
app.get('/api/v1/user/credits', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const userId = req.user.userId;
    const credits = await billingService.getUserCredits(userId);
    
    res.json({
      success: true,
      data: credits
    });
  } catch (error) {
    console.error('Get user credits error:', error);
    res.status(500).json({
      error: 'Failed to get credits',
      message: error.message
    });
  }
});

// Apply pending referral rewards to user account
app.post('/api/v1/user/apply-rewards', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await billingService.applyPendingRewards(userId);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Apply rewards error:', error);
    res.status(500).json({
      error: 'Failed to apply rewards',
      message: error.message
    });
  }
});

// Get billing history
app.get('/api/v1/user/billing-history', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 50;
    const history = await billingService.getBillingHistory(userId, limit);
    
    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('Get billing history error:', error);
    res.status(500).json({
      error: 'Failed to get billing history',
      message: error.message
    });
  }
});

// =============================================================================
// REFERRAL SYSTEM API ENDPOINTS  
// =============================================================================

// Get user's referral link and code
app.get('/api/v1/referrals/link', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const userId = req.user.userId;
    const referralData = await referralService.generateReferralLink(userId);
    
    res.json({
      success: true,
      data: referralData
    });
  } catch (error) {
    console.error('Get referral link error:', error);
    res.status(500).json({
      error: 'Failed to get referral link',
      message: error.message
    });
  }
});

// Send referral invitation
app.post('/api/v1/referrals/invite', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { email, personalMessage } = req.body;
    const userId = req.user.userId;

    // Validate input
    if (!email || !email.trim()) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Email address is required'
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        error: 'Invalid email format',
        message: 'Please provide a valid email address'
      });
    }

    const inviteData = await referralService.sendReferralInvite(
      userId,
      email.trim(),
      personalMessage || ''
    );
    
    res.json({
      success: true,
      data: inviteData
    });
  } catch (error) {
    console.error('Send referral invite error:', error);
    res.status(400).json({
      error: 'Failed to send referral invite',
      message: error.message
    });
  }
});

// Get referral statistics
app.get('/api/v1/referrals/stats', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const userId = req.user.userId;
    const stats = await referralService.getReferralStats(userId);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get referral stats error:', error);
    res.status(500).json({
      error: 'Failed to get referral stats',
      message: error.message
    });
  }
});

// Process referral signup (called during registration)
app.post('/api/v1/referrals/process-signup', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { userId, inviteCode } = req.body;
    
    if (!userId || !inviteCode) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'userId and inviteCode are required'
      });
    }

    const result = await referralService.processReferralSignup(userId, inviteCode);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Process referral signup error:', error);
    res.status(400).json({
      error: 'Failed to process referral signup',
      message: error.message
    });
  }
});

// Debug endpoint to check referral codes in database
app.get('/api/v1/debug/referral-codes', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    // Get all users with their referral codes for debugging
    const result = await db.query(`
      SELECT id, email, first_name, last_name, referral_code, 
             total_referrals_made, successful_referrals
      FROM users 
      WHERE referral_code IS NOT NULL
      ORDER BY created_at DESC 
      LIMIT 20
    `);
    
    res.json({
      success: true,
      users: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Debug referral codes error:', error);
    res.status(500).json({
      error: 'Failed to get referral codes',
      message: error.message
    });
  }
});

// Change user password
app.post('/api/v1/user/change-password', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.userId;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'oldPassword and newPassword are required'
      });
    }

    // Password validation
    if (newPassword.length < 8) {
      return res.status(400).json({
        error: 'Invalid password',
        message: 'Password must be at least 8 characters long'
      });
    }

    await authService.changePassword(userId, oldPassword, newPassword);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(400).json({
      error: 'Failed to change password',
      message: error.message
    });
  }
});

// Get user usage history
app.get('/api/v1/user/usage-history', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit = 30 } = req.query;

    // For now, return mock data since usage tracking isn't fully implemented
    const mockHistory = [
      {
        id: '1',
        date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        activity: 'Blog Post Generated',
        postsUsed: 1,
        value: 15
      },
      {
        id: '2', 
        date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        activity: 'Content Export',
        postsUsed: 0,
        value: 0
      }
    ];

    res.json({
      success: true,
      data: mockHistory.slice(0, parseInt(limit))
    });

  } catch (error) {
    console.error('Get usage history error:', error);
    res.status(500).json({
      error: 'Failed to retrieve usage history',
      message: error.message
    });
  }
});

// Request plan change
app.post('/api/v1/user/request-plan-change', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { planType, reason } = req.body;
    const userId = req.user.userId;
    const user = await authService.getUserById(userId);

    if (!planType) {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'planType is required'
      });
    }

    // Log the plan change request (in a real system, this would go to a support queue)
    await authService.logUserActivity(userId, 'plan_change_requested', {
      current_plan: user.billingStatus || 'Pay-as-you-go',
      requested_plan: planType,
      reason: reason || 'No reason provided',
      user_email: user.email,
      user_name: `${user.firstName} ${user.lastName}`
    });

    res.json({
      success: true,
      message: 'Plan change request submitted successfully'
    });

  } catch (error) {
    console.error('Request plan change error:', error);
    res.status(500).json({
      error: 'Failed to submit plan change request',
      message: error.message
    });
  }
});

// Get billing history
app.get('/api/v1/user/billing-history', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit = 50 } = req.query;

    // For now, return mock data since billing isn't integrated yet
    const mockBilling = [
      {
        id: '1',
        date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        description: 'Monthly usage - November 2024',
        amount: 45,
        status: 'paid',
        invoiceUrl: '#'
      }
    ];

    res.json({
      success: true,
      data: mockBilling.slice(0, parseInt(limit))
    });

  } catch (error) {
    console.error('Get billing history error:', error);
    res.status(500).json({
      error: 'Failed to retrieve billing history',
      message: error.message
    });
  }
});

// Update billing information
app.put('/api/v1/user/billing-info', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const userId = req.user.userId;
    const billingInfo = req.body;

    // Log billing info update (in real system, this would be stored in database)
    await authService.logUserActivity(userId, 'billing_info_updated', {
      company_name: billingInfo.companyName,
      billing_email: billingInfo.billingEmail,
      has_address: !!(billingInfo.address && billingInfo.city),
      has_tax_id: !!billingInfo.taxId
    });

    res.json({
      success: true,
      message: 'Billing information updated successfully'
    });

  } catch (error) {
    console.error('Update billing info error:', error);
    res.status(500).json({
      error: 'Failed to update billing information',
      message: error.message
    });
  }
});

// =============================================================================
// REFERRAL SYSTEM API ENDPOINTS
// =============================================================================

// Generate personal referral link
app.get('/api/v1/referrals/link', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const result = await referralService.generateReferralLink(req.user.userId);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Generate referral link error:', error);
    res.status(500).json({
      error: 'Failed to generate referral link',
      message: error.message
    });
  }
});

// Send referral invitation (for customer acquisition)
app.post('/api/v1/referrals/invite', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { email, personalMessage } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'Email is required'
      });
    }

    const result = await referralService.sendReferralInvite(
      req.user.userId, 
      email, 
      personalMessage
    );
    
    res.json({
      success: true,
      message: 'Referral invitation sent successfully',
      data: result
    });
  } catch (error) {
    console.error('Send referral invite error:', error);
    res.status(400).json({
      error: 'Failed to send referral invitation',
      message: error.message
    });
  }
});

// Get referral statistics
app.get('/api/v1/referrals/stats', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const stats = await referralService.getReferralStats(req.user.userId);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get referral stats error:', error);
    res.status(500).json({
      error: 'Failed to retrieve referral statistics',
      message: error.message
    });
  }
});

// =============================================================================
// ORGANIZATION MANAGEMENT API ENDPOINTS
// =============================================================================

// Send organization member invitation (for team building)
app.post('/api/v1/organization/invite', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { email, role = 'member' } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'Email is required'
      });
    }

    if (!['member', 'admin'].includes(role)) {
      return res.status(400).json({
        error: 'Invalid role',
        message: 'Role must be either "member" or "admin"'
      });
    }

    const result = await referralService.sendOrganizationInvite(
      req.user.userId, 
      email, 
      role
    );
    
    res.json({
      success: true,
      message: 'Organization invitation sent successfully',
      data: result
    });
  } catch (error) {
    console.error('Send organization invite error:', error);
    res.status(400).json({
      error: 'Failed to send organization invitation',
      message: error.message
    });
  }
});

// Get organization members
app.get('/api/v1/organization/members', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const result = await referralService.getOrganizationMembers(req.user.userId);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get organization members error:', error);
    res.status(500).json({
      error: 'Failed to retrieve organization members',
      message: error.message
    });
  }
});

// Remove organization member
app.delete('/api/v1/organization/members/:memberId', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { memberId } = req.params;
    
    await referralService.removeOrganizationMember(req.user.userId, memberId);
    
    res.json({
      success: true,
      message: 'Organization member removed successfully'
    });
  } catch (error) {
    console.error('Remove organization member error:', error);
    res.status(400).json({
      error: 'Failed to remove organization member',
      message: error.message
    });
  }
});

// Process referral signup (called during registration)
app.post('/api/v1/referrals/process-signup', async (req, res) => {
  try {
    const { userId, inviteCode } = req.body;

    if (!userId || !inviteCode) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'userId and inviteCode are required'
      });
    }

    const result = await referralService.processReferralSignup(userId, inviteCode);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Process referral signup error:', error);
    res.status(400).json({
      error: 'Failed to process referral signup',
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