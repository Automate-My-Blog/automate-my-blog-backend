import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { waitUntil } from '@vercel/functions';
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
import { expireOldCredits } from './jobs/expireCredits.js';
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
import blogRoutes from './routes/blog.js';
import topicRoutes from './routes/topics.js';
import tweetRoutes from './routes/tweets.js';
import youtubeVideosRoutes from './routes/youtube-videos.js';
import newsArticlesRoutes from './routes/news-articles.js';
import organizationRoutes from './routes/organizations.js';
import stripeRoutes from './routes/stripe.js';
import analyticsRoutes from './routes/analytics.js';
import leadsRoutes from './routes/leads.js';
import emailTestRoutes from './routes/email-test.js';
import schedulerRoutes from './routes/scheduler.js';
import emailPreferencesRoutes from './routes/email-preferences.js';
import founderEmailRoutes from './routes/founderEmails.js';
import strategyRoutes from './routes/strategies.js';
import strategySubscriptionRoutes from './routes/strategy-subscriptions.js';
import bundleSubscriptionRoutes from './routes/bundle-subscriptions.js';
import jobsRoutes from './routes/jobs.js';
import voiceSamplesRoutes from './routes/voice-samples.js';
import { registerStreamRoute } from './routes/stream.js';
import googleIntegrationsRoutes from './routes/google-integrations.js';
import adminPanelRouter, { requireAdmin, adminPanelHtml, adminLoginHtml, adminShellHtml } from './routes/admin-panel.js';
import { startEmailScheduler } from './jobs/scheduler.js';
import { toHttpResponse, ValidationError } from './lib/errors.js';
import { validateRegistrationInput, validateLoginInput, validateRefreshInput } from './lib/auth-validation.js';
import { validateCreateBlogPostBody, validateUpdateBlogPostBody } from './lib/blog-post-validation.js';
import { saveAnalysisResult } from './services/website-analysis-persistence.js';

// Load environment variables
dotenv.config();

if (!process.env.REDIS_URL) {
  console.warn(
    'REDIS_URL is not set. POST /api/v1/jobs/website-analysis and other job endpoints will return 503. ' +
    'Set REDIS_URL (e.g. redis://localhost:6379) and run the job worker: node jobs/job-worker.js'
  );
}

const app = express();
const PORT = process.env.PORT || 3001;

// Configure Express to trust Vercel proxy for accurate IP detection
app.set('trust proxy', 1);

// CORS must run before rate limiter so every response (including 429) has CORS headers;
// otherwise the browser blocks with "No 'Access-Control-Allow-Origin' header" on errors.
const allowedOriginList = [
  'https://automatemyblog.com',
  'https://www.automatemyblog.com',
  'https://staging.automatemyblog.com',
  'https://automatemyblog.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:5173',
  'http://localhost:5173'
];
const extraOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const allAllowedOrigins = [...allowedOriginList, ...extraOrigins];

function isInAllowList(origin) {
  return allAllowedOrigins.includes(origin);
}

function isVercelPreviewOrigin(origin) {
  return origin.endsWith('.vercel.app') && (origin.startsWith('https://') || origin.startsWith('http://'));
}

function isLocalhostInDevelopment(origin) {
  if (process.env.NODE_ENV !== 'development') return false;
  try {
    const u = new URL(origin);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/** Single source of truth for CORS origin allow. */
function isOriginAllowed(origin) {
  if (!origin) return true;
  if (isInAllowList(origin)) return true;
  if (isVercelPreviewOrigin(origin)) return true;
  if (isLocalhostInDevelopment(origin)) return true;
  return false;
}

function corsOrigin(origin, callback) {
  // Pass the origin string when allowed so the cors package sets Access-Control-Allow-Origin correctly.
  callback(null, isOriginAllowed(origin) ? origin : false);
}

// Explicit OPTIONS (preflight) handler so CORS headers are always sent in serverless (Vercel).
// The browser sends OPTIONS first; without these headers the actual request is blocked.
// Only set Allow-Origin when origin is present; setting it to undefined can become "undefined" and break CORS.
app.use((req, res, next) => {
  if (req.method !== 'OPTIONS') return next();
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-session-id');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Vary', 'Origin');
  }
  res.status(204).end();
});

app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id'],
  credentials: true,
  optionsSuccessStatus: 204
}));

// Rate limiting (after CORS so error responses still have CORS headers)
const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
const isDev = process.env.NODE_ENV === 'development';
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDevelopment ? 1000 : 100,
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/manifest.json'
});

app.use(limiter);

function isStripeWebhook(req) {
  return req.method === 'POST' && req.url === '/api/v1/stripe/webhook';
}

function isJsonSyntaxError(err) {
  return err instanceof SyntaxError && err.status === 400 && 'body' in err;
}

// Body parsing - raw for webhook, JSON for everything else
app.use((req, res, next) => {
  if (isStripeWebhook(req)) {
    express.raw({ type: 'application/json' })(req, res, next);
    return;
  }
  express.json({ limit: '10mb' })(req, res, (err) => {
    if (err && isJsonSyntaxError(err)) {
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
app.use('/api/v1/jobs', authService.optionalAuthMiddleware.bind(authService), jobsRoutes);
app.use('/api/v1/voice-samples', authService.authMiddleware.bind(authService), voiceSamplesRoutes);
app.use('/api/v1/stream', registerStreamRoute(authService));
app.use('/api/v1/seo-analysis', authService.authMiddleware.bind(authService), seoAnalysisRoutes);
app.use('/api/v1/content-upload', authService.authMiddleware.bind(authService), contentUploadRoutes);
app.use('/api/v1/manual-inputs', authService.authMiddleware.bind(authService), manualInputRoutes);
app.use('/api/v1/visual-content', authService.authMiddleware.bind(authService), visualContentRoutes);
app.use('/api/v1/enhanced-blog-generation', authService.authMiddleware.bind(authService), enhancedBlogGenerationRoutes);
app.use('/api/v1/blog', authService.authMiddleware.bind(authService), blogRoutes);
app.use('/api/v1/topics', authService.optionalAuthMiddleware.bind(authService), topicRoutes);
app.use('/api/v1/tweets', authService.optionalAuthMiddleware.bind(authService), tweetRoutes);
app.use('/api/v1/youtube-videos', authService.optionalAuthMiddleware.bind(authService), youtubeVideosRoutes);
app.use('/api/v1/news-articles', authService.optionalAuthMiddleware.bind(authService), newsArticlesRoutes);
app.use('/api/v1/trending-topics', authService.optionalAuthMiddleware.bind(authService), topicRoutes);
app.use('/api/v1/organizations', authService.optionalAuthMiddleware.bind(authService), organizationRoutes);
app.use('/api/v1/leads', leadsRoutes);

// Stripe routes - webhook has NO auth (signature verified), other endpoints require auth
app.use('/api/v1/stripe', (req, res, next) => {
  // Skip auth for webhook endpoint (Stripe uses signature verification)
  if (req.path === '/webhook') {
    return next();
  }
  // All other Stripe endpoints require authentication
  authService.authMiddleware.bind(authService)(req, res, next);
}, stripeRoutes);

// Strategy subscription routes - all require authentication
// Note: Bundle routes must be registered BEFORE general strategy routes to avoid path conflicts
app.use('/api/v1/strategies/bundle', authService.authMiddleware.bind(authService), bundleSubscriptionRoutes);
// Strategy pitch generation routes (handles auth via query params for SSE compatibility)
app.use('/api/v1/strategies', strategyRoutes);
// Strategy subscription management routes (require header-based auth)
app.use('/api/v1/strategies', authService.authMiddleware.bind(authService), strategySubscriptionRoutes);

// Analytics routes - all require authentication
app.use('/api/v1/analytics', analyticsRoutes);

// Google API Integrations (Trends, Search Console, Analytics)
app.use('/api/v1/google', authService.optionalAuthMiddleware.bind(authService), googleIntegrationsRoutes);

// Email test routes (optional auth for testing)
app.use('/api/v1/email/test', authService.optionalAuthMiddleware.bind(authService), emailTestRoutes);

// Scheduler routes (optional auth for testing/admin)
app.use('/api/v1/scheduler', authService.optionalAuthMiddleware.bind(authService), schedulerRoutes);

// Email preferences and unsubscribe routes (no auth required for unsubscribe token)
app.use('/api/v1/email-preferences', emailPreferencesRoutes);

// Founder Email Routes (Admin only - should add auth middleware)
app.use(founderEmailRoutes);

// Admin panel: stats and cache management (super_admin JWT or ADMIN_API_KEY)
app.use('/api/v1/admin-panel', authService.optionalAuthMiddleware.bind(authService), requireAdmin, adminPanelRouter);
// Admin login page (public): same shell as /admin so login + redirect works
app.get('/admin/login', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(adminLoginHtml());
});
// Admin shell (public): client checks sessionStorage for token; if present fetches panel with Bearer token and renders it
app.get('/admin', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(adminShellHtml());
});

// PWA manifest — public, no auth (fixes 401 when frontend or proxy requests /manifest.json from backend origin).
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.json({
    name: 'AutoBlog',
    short_name: 'AutoBlog',
    description: 'AutoBlog — automate your blog',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#000000'
  });
});

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

// Debug/diagnostic endpoints - only available in development
if (isDev) {
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
}

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
      'POST /api/v1/jobs/website-analysis': 'Start async website analysis job (returns jobId)',
      'POST /api/v1/jobs/content-generation': 'Start async content generation job (returns jobId)',
      'GET /api/v1/jobs/:jobId/status': 'Get job status, progress, and result',
      'POST /api/v1/jobs/:jobId/retry': 'Retry a failed job',
      'POST /api/v1/jobs/:jobId/cancel': 'Cancel a queued or running job',
      'POST /api/trending-topics': 'Generate trending blog topics for a business',
      'POST /api/v1/topics/generate-stream': 'Stream topic generation (returns connectionId; stream via GET /api/v1/stream/:connectionId)',
      'POST /api/v1/tweets/search-for-topic-stream': 'Stream tweet search for a topic (returns connectionId; stream via GET /api/v1/stream/:connectionId)',
      'POST /api/v1/youtube-videos/search-for-topic-stream': 'Stream YouTube video search for a topic (returns connectionId; stream via GET /api/v1/stream/:connectionId)',
      'POST /api/v1/news-articles/search-for-topic-stream': 'Stream news article search for a topic (returns connectionId; stream via GET /api/v1/stream/:connectionId)',
      'POST /api/v1/trending-topics/stream': 'Stream trending topics (same as topics/generate-stream; returns connectionId; stream via GET /api/v1/stream/:connectionId)',
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
app.post('/api/v1/auth/register', async (req, res, next) => {
  try {
    const parsed = validateRegistrationInput(req.body);

    const result = await authService.register({
      email: parsed.email,
      password: parsed.password,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      organizationName: parsed.organizationName,
      websiteUrl: parsed.websiteUrl || null
    });

    // Send welcome and admin alert emails (async, don't block response)
    const emailService = (await import('./services/email.js')).default;
    emailService.sendWelcomeEmail(result.user.id)
      .catch(err => console.error('Failed to send welcome email:', err));
    emailService.sendNewUserSignupAlert(result.user.id)
      .catch(err => console.error('Failed to send admin signup alert:', err));

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
    next(error);
  }
});

// Login endpoint
app.post('/api/v1/auth/login', async (req, res, next) => {
  try {
    const { email, password } = validateLoginInput(req.body);

    const result = await authService.login(email, password);

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
    next(error);
  }
});

function isInfrastructureError(error) {
  const codes = ['28000', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', '57P01'];
  return error?.code != null && codes.includes(String(error.code));
}

// Get current user endpoint
app.get('/api/v1/auth/me', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const user = await authService.getUserById(req.user.userId);
    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get user error:', error);
    const statusCode = isInfrastructureError(error) ? 500 : 404;
    const errorLabel = isInfrastructureError(error) ? 'Service unavailable' : 'User not found';
    res.status(statusCode).json({
      error: errorLabel,
      message: error.message
    });
  }
});

// Refresh token endpoint
app.post('/api/v1/auth/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = validateRefreshInput(req.body);

    const tokens = await authService.refreshTokens(refreshToken);

    res.json({
      success: true,
      message: 'Tokens refreshed successfully',
      ...tokens
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    next(error);
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

// Analyze website endpoint — request timeout so we never hang indefinitely
const ANALYZE_WEBSITE_REQUEST_TIMEOUT_MS = Math.max(60000, parseInt(process.env.ANALYZE_WEBSITE_REQUEST_TIMEOUT_MS || '120000', 10));

app.post('/api/analyze-website', async (req, res, next) => {
  console.log('=== Website Analysis Request ===');
  console.log('Request body:', req.body);
  console.log('Headers:', req.headers);
  console.log('User-Agent:', req.headers['user-agent']);

  req.setTimeout(ANALYZE_WEBSITE_REQUEST_TIMEOUT_MS, function () {
    if (!res.headersSent) {
      console.warn('⚠️ /api/analyze-website request timeout after', ANALYZE_WEBSITE_REQUEST_TIMEOUT_MS, 'ms');
      res.status(504).json({
        error: 'Gateway Timeout',
        message: 'Website analysis took too long. Try the async job (POST /api/v1/jobs/website-analysis) for long-running analysis.'
      });
    }
  });

  try {
    const { url } = req.body;

    console.log('Analyzing URL:', url);

    if (!url) {
      throw new ValidationError('URL is required', 'Please provide a valid website URL');
    }
    if (!webScraperService.isValidUrl(url)) {
      throw new ValidationError('Invalid URL format', 'Please provide a valid HTTP or HTTPS URL');
    }

    console.log('Starting website scraping...');
    // Scrape website content
    const scrapedContent = await webScraperService.scrapeWebsite(url);
    console.log('Scraping completed. Title:', scrapedContent.title);
    console.log('Content length:', scrapedContent.content?.length || 0);

    console.log('🎯 [CTA DEBUG] Scraper found CTAs:', {
      url,
      ctaCount: scrapedContent.ctas?.length || 0,
      ctas: scrapedContent.ctas?.map(c => ({ text: c.text, type: c.type, href: c.href })) || []
    });
    
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

    // Persist analysis: org resolution, organization + intelligence, CTAs (single service call)
    let foundOrganizationId = null;
    let storedCTAs = [];
    let ctaStoredCount = 0;

    const sessionId = req.headers['x-session-id'] || null;
    let userId = null;
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const jwt = await import('jsonwebtoken');
        const payload = jwt.default.verify(token, process.env.JWT_SECRET || 'fallback-secret-for-development');
        userId = payload.userId;
      } catch (jwtError) {
        console.warn('Failed to extract user from JWT:', jwtError.message);
      }
    }

    try {
      const result = await saveAnalysisResult(db, {
        userId,
        sessionId,
        url,
        analysis,
        ctas: scrapedContent.ctas || []
      });
      foundOrganizationId = result.organizationId;
      storedCTAs = result.storedCTAs;
      ctaStoredCount = result.ctaStoredCount;
    } catch (saveError) {
      console.error('Failed to save organization intelligence to database:', saveError.message);
    }

    // Generate narrative analysis via job queue
    let narrativeData = { narrativeGenerating: true };

    if (foundOrganizationId) {
      console.log('🔍 [NARRATIVE] Creating narrative generation job for:', foundOrganizationId);

      try {
        // Create a job in the queue
        const jobResult = await db.query(
          `INSERT INTO narrative_generation_jobs (organization_id, status, priority, created_at)
           VALUES ($1, 'pending', 0, NOW())
           ON CONFLICT (organization_id) WHERE status = 'pending'
           DO UPDATE SET updated_at = NOW()
           RETURNING id`,
          [foundOrganizationId]
        );

        const jobId = jobResult.rows[0]?.id;

        console.log('✅ [NARRATIVE] Created job:', {
          jobId,
          organizationId: foundOrganizationId
        });

        narrativeData.narrativeJobId = jobId;
      } catch (jobError) {
        console.error('❌ [NARRATIVE] Failed to create job:', jobError.message);
        // Don't fail the request if job creation fails
        narrativeData.narrativeGenerating = false;
      }

      console.log('⚡ [NARRATIVE] Response sent immediately - narrative will be generated by worker');
    } else {
      console.log('⚠️ [NARRATIVE] Skipping narrative generation - no organization ID');
      narrativeData = {};
    }

    const response = {
      success: true,
      url,
      scrapedAt: scrapedContent.scrapedAt,
      analysis: {
        ...analysis,
        organizationId: foundOrganizationId,  // Add organizationId for frontend
        ...narrativeData  // Add narrative fields to analysis
      },
      metadata: {
        title: scrapedContent.title,
        headings: scrapedContent.headings
      },
      ctas: storedCTAs,  // Include CTAs in response
      ctaCount: storedCTAs.length,
      hasSufficientCTAs: storedCTAs.length >= 3
    };

    console.log('📊 [CTA DEBUG] Sending response with CTAs:', {
      ctaCount: storedCTAs.length,
      hasOrganizationId: !!foundOrganizationId
    });
    console.log('📤 [NARRATIVE] Final response analysis object:', {
      hasNarrative: !!response.analysis.narrative,
      narrativeLength: response.analysis.narrative?.length || 0,
      hasNarrativeConfidence: !!response.analysis.narrativeConfidence,
      hasKeyInsights: !!response.analysis.keyInsights,
      keyInsightsCount: response.analysis.keyInsights?.length || 0
    });
    console.log('Sending successful response');
    if (!res.headersSent) res.json(response);

  } catch (error) {
    console.error('=== Website Analysis Error ===', error?.message);
    if (!res.headersSent) next(error);
  }
});

// Fetch narrative analysis for organization (polling endpoint)
app.get('/api/narrative/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;

    console.log('📖 [NARRATIVE-FETCH] Fetching narrative for organization:', organizationId);

    // Get narrative from intelligence table
    const intelligenceResult = await db.query(
      `SELECT narrative_analysis, narrative_confidence, key_insights
       FROM organization_intelligence
       WHERE organization_id = $1 AND is_current = TRUE
       LIMIT 1`,
      [organizationId]
    );

    // Also get job status for UI updates
    const jobResult = await db.query(
      `SELECT id, status, attempts, error_message, created_at, completed_at
       FROM narrative_generation_jobs
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [organizationId]
    );

    const intelligence = intelligenceResult.rows[0];
    const job = jobResult.rows[0];

    if (intelligence?.narrative_analysis) {
      // Narrative is ready
      console.log('✅ [NARRATIVE-FETCH] Narrative found');
      res.json({
        success: true,
        ready: true,
        narrative: intelligence.narrative_analysis,
        narrativeConfidence: intelligence.narrative_confidence,
        keyInsights: intelligence.key_insights,
        job: job ? {
          status: job.status,
          completedAt: job.completed_at
        } : null
      });
    } else {
      // Still processing or failed
      console.log('⏳ [NARRATIVE-FETCH] Narrative still generating');
      res.json({
        success: true,
        ready: false,
        message: job?.error_message || 'Narrative is being generated',
        job: job ? {
          id: job.id,
          status: job.status,
          attempts: job.attempts,
          createdAt: job.created_at
        } : null
      });
    }
  } catch (error) {
    console.error('❌ [NARRATIVE-FETCH] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Generate audience scenarios endpoint (Step 2 of 3-step analysis)
app.post('/api/generate-audiences', async (req, res) => {
  console.log('=== Generate Audiences Request ===');

  try {
    const { analysisData, webSearchData, keywordData } = req.body;

    if (!analysisData) {
      return res.status(400).json({
        error: 'Analysis data is required',
        message: 'Please provide website analysis data'
      });
    }

    console.log('Generating audience scenarios for:', analysisData.businessName);

    // Query existing audiences to avoid duplicates
    let existingAudiences = [];
    try {
      const sessionId = req.headers['x-session-id'];
      const userId = req.user?.userId;

      let whereConditions = [];
      let queryParams = [];
      let paramIndex = 1;

      if (userId) {
        whereConditions.push(`user_id = $${paramIndex}`);
        queryParams.push(userId);
        paramIndex++;
      } else if (sessionId) {
        whereConditions.push(`session_id = $${paramIndex}`);
        queryParams.push(sessionId);
        paramIndex++;
      }

      if (whereConditions.length > 0) {
        const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
        const result = await db.query(
          `SELECT target_segment, customer_problem FROM audiences ${whereClause} ORDER BY created_at DESC`,
          queryParams
        );
        existingAudiences = result.rows;
        console.log(`📊 Found ${existingAudiences.length} existing audiences for deduplication`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to query existing audiences, continuing without deduplication:', error.message);
    }

    const scenarios = await openaiService.generateAudienceScenarios(
      analysisData,
      webSearchData || '',
      keywordData || '',
      existingAudiences
    );

    res.json({
      success: true,
      scenarios,
      count: scenarios.length
    });

  } catch (error) {
    console.error('Generate audiences error:', error);
    res.status(500).json({
      error: 'Failed to generate audience scenarios',
      message: error.message
    });
  }
});

// Generate pitches endpoint (Step 3 of 3-step analysis)
app.post('/api/generate-pitches', async (req, res) => {
  console.log('=== Generate Pitches Request ===');

  try {
    const { scenarios, businessContext } = req.body;

    if (!scenarios || !Array.isArray(scenarios)) {
      return res.status(400).json({
        error: 'Scenarios array is required',
        message: 'Please provide audience scenarios'
      });
    }

    if (!businessContext) {
      return res.status(400).json({
        error: 'Business context is required',
        message: 'Please provide business context'
      });
    }

    console.log(`Generating pitches for ${scenarios.length} scenarios`);

    const scenariosWithPitches = await openaiService.generatePitches(scenarios, businessContext);

    res.json({
      success: true,
      scenarios: scenariosWithPitches,
      count: scenariosWithPitches.length
    });

  } catch (error) {
    console.error('Generate pitches error:', error);
    res.status(500).json({
      error: 'Failed to generate pitches',
      message: error.message
    });
  }
});

// Generate audience images endpoint (Step 4 of 4-step analysis)
app.post('/api/generate-audience-images', async (req, res) => {
  console.log('=== Generate Audience Images Request ===');

  try {
    const { scenarios, brandContext } = req.body;

    if (!scenarios || !Array.isArray(scenarios)) {
      return res.status(400).json({
        error: 'Scenarios array is required',
        message: 'Please provide audience scenarios'
      });
    }

    console.log(`Generating images for ${scenarios.length} scenarios with brand voice: ${brandContext?.brandVoice || 'Professional'}`);

    const scenariosWithImages = await openaiService.generateAudienceImages(scenarios, brandContext || {});

    res.json({
      success: true,
      scenarios: scenariosWithImages,
      count: scenariosWithImages.length
    });

  } catch (error) {
    console.error('Generate audience images error:', error);
    res.status(500).json({
      error: 'Failed to generate audience images',
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

// Search for tweets for a selected topic
app.post('/api/tweets/search-for-topic', async (req, res) => {
  try {
    const { topic, businessInfo, maxTweets = 3 } = req.body;

    if (!topic || !businessInfo) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters',
        message: 'topic and businessInfo are required',
        tweets: []
      });
    }

    console.log('🐦 [TWEET SEARCH] Searching tweets for topic:', topic.title);

    // Step 1: Use OpenAI to extract simplified search terms from topic
    // We'll create a minimal "blog content" from the topic fields
    const topicDescription = `
      Title: ${topic.title}
      Subheader: ${topic.subheader || ''}
      Focus: ${topic.trend || ''}
      SEO: ${topic.seoBenefit || ''}
    `.trim();

    const searchQueries = await enhancedBlogGenerationService.extractTweetSearchQueries(
      topicDescription,
      topic,
      businessInfo
    );

    console.log('✅ [TWEET SEARCH] Extracted search queries:', searchQueries);

    // Step 2: Search for tweets using simplified queries
    const tweets = await enhancedBlogGenerationService.searchForTweetsWithMultipleQueries(
      searchQueries
    );

    console.log(`✅ [TWEET SEARCH] Found ${tweets.length} tweets`);

    res.json({
      success: true,
      tweets,
      searchTermsUsed: searchQueries
    });

  } catch (error) {
    console.error('❌ [TWEET SEARCH] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      tweets: []
    });
  }
});

/**
 * TEST ENDPOINT: Direct Grok search without OpenAI preprocessing (dev only)
 * Use this to diagnose Grok performance issues
 */
if (isDev) {
app.post('/api/test/grok-direct', async (req, res) => {
  try {
    const { query = 'postpartum depression support', maxTweets = 3 } = req.body;

    console.log('🧪 [TEST] Direct Grok search starting...');
    console.log(`🔍 Query: "${query}"`);

    const startTime = Date.now();

    // Import Grok service
    const { default: grokTweetSearch } = await import('./services/grok-tweet-search.js');

    // Call Grok directly
    const tweets = await grokTweetSearch.searchRelevantTweets({
      topic: query,
      businessType: 'Healthcare',
      targetAudience: 'General',
      maxTweets: maxTweets
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`✅ [TEST] Grok search completed in ${elapsed}s`);
    console.log(`📊 [TEST] Found ${tweets.length} tweets`);

    res.json({
      success: true,
      tweets,
      elapsed: `${elapsed}s`,
      query
    });

  } catch (error) {
    console.error('❌ [TEST] Grok direct test failed:', error.message);
    console.error('Error code:', error.code);
    console.error('Error response:', error.response?.status, error.response?.data);

    res.status(500).json({
      success: false,
      error: error.message,
      errorCode: error.code,
      responseStatus: error.response?.status,
      responseData: error.response?.data,
      isTimeout: error.code === 'ECONNABORTED' || error.message.includes('timeout')
    });
  }
});
}

/**
 * Generate images for a saved blog post
 * This endpoint is called AFTER blog generation to avoid timeout issues
 * Similar pattern to tweet search - separate endpoint with own 60s window
 */
app.post('/api/images/generate-for-blog', async (req, res) => {
  try {
    const { blogPostId, content, topic, organizationId } = req.body;

    if (!blogPostId || !content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters',
        message: 'blogPostId and content are required'
      });
    }

    console.log(`🎨 [IMAGE GEN] Generating images for blog: ${blogPostId}`);

    // Generate images for all placeholders in content
    const imageResult = await enhancedBlogGenerationService.generateImagesAsync(
      blogPostId,
      content,
      topic,
      organizationId
    );

    if (imageResult.success) {
      // Update the blog post in database with generated images
      await enhancedBlogGenerationService.updateBlogPostContent(
        blogPostId,
        imageResult.content
      );

      console.log(`✅ [IMAGE GEN] Successfully generated and saved images for blog: ${blogPostId}`);

      res.json({
        success: true,
        content: imageResult.content,
        blogPostId
      });
    } else {
      console.warn(`⚠️ [IMAGE GEN] Image generation failed for blog: ${blogPostId}`);

      res.json({
        success: false,
        error: imageResult.error,
        content: imageResult.content, // Return original content with placeholders
        blogPostId
      });
    }

  } catch (error) {
    console.error('❌ [IMAGE GEN] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
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
      tweets,  // Pre-fetched tweets for the topic
      articles, // Pre-fetched news articles (optional)
      videos,  // Pre-fetched YouTube videos (optional)
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

    // Check if user has credits available (if authenticated)
    if (req.user) {
      const hasCredits = await billingService.hasCredits(req.user.userId);
      if (!hasCredits) {
        const credits = await billingService.getUserCredits(req.user.userId);
        return res.status(402).json({
          success: false,
          error: 'Insufficient credits',
          message: 'You have used all your blog post credits for this billing period.',
          data: {
            currentPlan: credits.basePlan,
            creditsUsed: credits.usedCredits,
            creditsAvailable: credits.availableCredits,
            upgradeUrl: '/pricing'
          }
        });
      }
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
          { additionalInstructions: additionalInstructions || '', includeVisuals, preloadedTweets: tweets, preloadedArticles: articles, preloadedVideos: videos }
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
              includeVisuals,
              preloadedTweets: tweets,
              preloadedArticles: articles,
              preloadedVideos: videos
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

    // Save to user account if authenticated (default: true, unless explicitly disabled)
    if (req.user && (saveToAccount !== false && saveToAccount !== 'false')) {
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

        // Deduct credit for successful generation
        try {
          await billingService.useCredit(req.user.userId, 'generation', savedPost.id);
          console.log(`✅ Credit deducted for user ${req.user.userId}, post: ${savedPost.id}`);
        } catch (creditError) {
          console.error('Failed to deduct credit:', creditError);
          // Don't fail the response, but log for admin review
        }

        // ✨ REMOVED: Async image generation moved to dedicated endpoint
        // Images are now generated via /api/images/generate-for-blog
        // This prevents timeout issues by giving image generation its own 60s window
        // Frontend will call the image endpoint after receiving the blog response
        if (blogPost._hasImagePlaceholders && savedPost.id) {
          console.log(`🎨 Blog has image placeholders - frontend should call /api/images/generate-for-blog`);
        }

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

    // Safety check: Detect placeholders even if flag wasn't set
    const contentHasPlaceholders = blogPost.content?.includes('![IMAGE:') || blogPost.content?.includes('![CHART:');
    console.log('🔍 [IMAGE DEBUG] Fallback detection check:', {
      contentLength: blogPost.content?.length,
      hasImagePlaceholder: blogPost.content?.includes('![IMAGE:'),
      hasChartPlaceholder: blogPost.content?.includes('![CHART:'),
      flagWasSet: blogPost._hasImagePlaceholders,
      contentHasPlaceholders
    });

    if (contentHasPlaceholders && !blogPost._hasImagePlaceholders) {
      console.warn('⚠️ [IMAGE DEBUG] Found placeholders but flag not set - correcting');
      blogPost._hasImagePlaceholders = true;
      blogPost._topicForImages = topic;
      blogPost._organizationIdForImages = organizationId;
    }

    // NEW: Add image generation metadata for frontend
    response.imageGeneration = {
      hasPlaceholders: blogPost._hasImagePlaceholders || false,
      needsImageGeneration: !!(blogPost._hasImagePlaceholders && savedPost?.id),  // Force boolean
      blogPostId: savedPost?.id || null,
      topic: blogPost._topicForImages || topic,
      organizationId: blogPost._organizationIdForImages || organizationId
    };

    console.log('🔍 [IMAGE GEN DEBUG] Setting imageGeneration metadata:', {
      hasPlaceholders: blogPost._hasImagePlaceholders,
      hasSavedPost: !!savedPost,
      savedPostId: savedPost?.id,
      needsImageGeneration: response.imageGeneration.needsImageGeneration
    });

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
app.get('/api/v1/blog-posts', authService.authMiddleware.bind(authService), async (req, res, next) => {
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
    next(error);
  }
});

// Create new blog post
app.post('/api/v1/blog-posts', authService.authMiddleware.bind(authService), async (req, res, next) => {
  try {
    const parsed = validateCreateBlogPostBody(req.body);

    const savedPost = await contentService.saveBlogPost(req.user.userId, {
      title: parsed.title,
      content: parsed.content,
      topic: parsed.topic,
      businessInfo: parsed.businessInfo,
      status: parsed.status
    });

    res.status(201).json({
      success: true,
      post: savedPost,
      message: 'Blog post created successfully'
    });
  } catch (error) {
    console.error('Create blog post error:', error);
    next(error);
  }
});

// Get specific blog post
app.get('/api/v1/blog-posts/:id', authService.authMiddleware.bind(authService), async (req, res, next) => {
  try {
    const { id } = req.params;
    const post = await contentService.getBlogPost(id, req.user.userId);

    res.json({
      success: true,
      post
    });
  } catch (error) {
    console.error('Get blog post error:', error);
    next(error);
  }
});

// Update blog post
app.put('/api/v1/blog-posts/:id', authService.authMiddleware.bind(authService), async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = validateUpdateBlogPostBody(req.body);

    const updatedPost = await contentService.updateBlogPost(id, req.user.userId, updates);

    res.json({
      success: true,
      post: updatedPost,
      message: 'Blog post updated successfully'
    });
  } catch (error) {
    console.error('Update blog post error:', error);
    next(error);
  }
});

// Delete blog post
app.delete('/api/v1/blog-posts/:id', authService.authMiddleware.bind(authService), async (req, res, next) => {
  try {
    const { id } = req.params;
    await contentService.deleteBlogPost(id, req.user.userId);

    res.json({
      success: true,
      message: 'Blog post deleted successfully'
    });
  } catch (error) {
    console.error('Delete blog post error:', error);
    next(error);
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

// Test endpoint for OpenAI without web scraping (dev only)
if (isDev) {
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
}

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

// Debug endpoint to check referral codes in database (dev only)
if (isDev) {
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
}

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

// Error handling middleware: map domain errors to HTTP status; preserve production message hiding for 500
app.use((error, req, res, next) => {
  console.error('Error:', error);
  const { statusCode, body } = toHttpResponse(error);
  if (statusCode === 500 && process.env.NODE_ENV !== 'development') {
    body.message = 'Something went wrong';
  }
  res.status(statusCode).json(body);
});

// 404 handler (route not matched). Job "not found" 404s from /api/v1/jobs return success: false, error: 'Not found', message: 'Job not found or access denied'.
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    method: req.method,
    path: req.path
  });
});

// Start server (skip when NODE_ENV=test for integration tests using supertest)
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 AutoBlog API server running on port ${PORT} (v2.0 - auth fix deployed)`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🔗 API base: http://localhost:${PORT}/api`);

    // Start email campaign scheduler (includes credit expiration)
    if (process.env.EMAIL_SCHEDULER_ENABLED !== 'false') {
      startEmailScheduler();
    } else {
      console.log('⏰ Email scheduler disabled (EMAIL_SCHEDULER_ENABLED=false)');
    }
  });
}

export default app;