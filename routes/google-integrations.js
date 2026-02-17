import express from 'express';
import { google } from 'googleapis';
import db from '../services/database.js';
import googleTrendsService from '../services/google-trends.js';
import googleSearchConsoleService from '../services/google-search-console.js';
import googleAnalyticsService from '../services/google-analytics.js';
import oauthManager from '../services/oauth-manager.js';
import integrationPitchGenerator from '../services/integration-pitch-generator.js';
import DatabaseAuthService from '../services/auth-database.js';

const router = express.Router();
const authService = new DatabaseAuthService();

const GOOGLE_SCOPES = {
  trends: [], // No OAuth needed, uses API key
  search_console: ['https://www.googleapis.com/auth/webmasters.readonly'],
  analytics: ['https://www.googleapis.com/auth/analytics.readonly']
};

// ========================================
// OAUTH ENDPOINTS
// ========================================

/**
 * GET /api/v1/google/oauth/authorize/:service
 * Initiate OAuth flow for a Google service
 */
router.get('/oauth/authorize/:service', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { service } = req.params;
    const userId = req.user.userId;

    if (!GOOGLE_SCOPES[service]) {
      return res.status(400).json({ success: false, error: 'Invalid service' });
    }

    // Special handling for Google Trends (no OAuth needed)
    if (service === 'trends') {
      // Google Trends uses public API, no credentials to store
      // Just return success - the frontend will mark it as "connected"
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.json({
        success: true,
        noOAuthRequired: true,
        message: 'Google Trends connected successfully',
        redirectUrl: `${frontendUrl}/settings/google-integrations?connected=trends`
      });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.GOOGLE_REDIRECT_URI}?service=${service}`
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_SCOPES[service],
      state: Buffer.from(JSON.stringify({ userId, service })).toString('base64'),
      prompt: 'consent' // Force consent to get refresh token
    });

    res.json({ success: true, authUrl });
  } catch (error) {
    console.error('OAuth authorization error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/google/oauth/callback
 * OAuth callback handler
 */
router.get('/oauth/callback', async (req, res) => {
  try {
    const { code, state, service } = req.query;

    if (!code || !state) {
      throw new Error('Missing code or state parameter');
    }

    const { userId } = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.GOOGLE_REDIRECT_URI}?service=${service}`
    );

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    // Store encrypted tokens
    await oauthManager.storeCredentials(
      userId,
      `google_${service}`,
      tokens,
      GOOGLE_SCOPES[service]
    );

    // Redirect to success page
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/settings/google-integrations?connected=${service}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/settings/google-integrations?error=${encodeURIComponent(error.message)}`);
  }
});

/**
 * GET /api/v1/google/oauth/status/:service
 * Check OAuth connection status
 */
router.get('/oauth/status/:service', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { service } = req.params;
    const userId = req.user.userId;

    // Special handling for Google Trends (always "connected" - uses public API)
    if (service === 'trends') {
      return res.json({
        success: true,
        connected: true,
        message: 'Google Trends uses public API - no authentication required'
      });
    }

    const credentials = await oauthManager.getCredentials(userId, `google_${service}`);

    res.json({
      success: true,
      connected: !!credentials,
      expires_at: credentials?.expires_at,
      scopes: credentials?.scopes
    });
  } catch (error) {
    console.error('OAuth status check error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/v1/google/oauth/disconnect/:service
 * Disconnect OAuth integration
 */
router.delete('/oauth/disconnect/:service', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { service } = req.params;
    const userId = req.user.userId;

    await oauthManager.revokeCredentials(userId, `google_${service}`);

    res.json({ success: true, message: `${service} disconnected` });
  } catch (error) {
    console.error('OAuth disconnect error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// STREAMING PITCH ENDPOINTS
// ========================================

/**
 * GET /api/v1/google/pitch/:service
 * Stream personalized pitch for integrating a Google service
 * SSE endpoint
 */
router.get('/pitch/:service', async (req, res) => {
  const { service } = req.params; // 'trends', 'search_console', 'analytics'
  const token = req.query.token;

  // Validate auth token from query params (EventSource can't send headers)
  let userId = null;
  if (token) {
    try {
      const decoded = authService.verifyToken(token);
      userId = decoded?.userId;
    } catch (error) {
      console.warn('⚠️ Invalid auth token for integration pitch:', error.message);
      res.status(401).set('Content-Type', 'text/plain').end('Unauthorized');
      return;
    }
  }

  if (!userId) {
    res.status(401).set('Content-Type', 'text/plain').end('Unauthorized');
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.flushHeaders?.();

  try {
    let stream;

    switch (service) {
      case 'trends':
        stream = integrationPitchGenerator.generateTrendsPitch(userId);
        break;
      case 'search_console':
        stream = integrationPitchGenerator.generateSearchConsolePitch(userId);
        break;
      case 'analytics':
        stream = integrationPitchGenerator.generateAnalyticsPitch(userId);
        break;
      default:
        res.write(`data: ${JSON.stringify({ type: 'error', content: 'Invalid service' })}\n\n`);
        return res.end();
    }

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify({ type: 'pitch-chunk', content: chunk })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
    res.end();

  } catch (error) {
    console.error(`Error streaming ${service} pitch:`, error);
    res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
    res.end();
  }
});

/**
 * GET /api/v1/google/integration-pitch/stream
 * Stream LLM-generated pitch for a Google integration
 * Uses session-based auth (cookies) instead of token
 * SSE endpoint
 */
router.get('/integration-pitch/stream', authService.authMiddleware.bind(authService), async (req, res) => {
  const { service } = req.query; // 'trends', 'search_console', 'analytics'
  const userId = req.user.userId;

  if (!service || !['trends', 'search_console', 'analytics'].includes(service)) {
    return res.status(400).set('Content-Type', 'text/plain').end('Invalid service parameter');
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.flushHeaders?.();

  try {
    let stream;

    switch (service) {
      case 'trends':
        stream = integrationPitchGenerator.generateTrendsPitch(userId);
        break;
      case 'search_console':
        stream = integrationPitchGenerator.generateSearchConsolePitch(userId);
        break;
      case 'analytics':
        stream = integrationPitchGenerator.generateAnalyticsPitch(userId);
        break;
    }

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
    res.end();

  } catch (error) {
    console.error(`Error streaming ${service} pitch:`, error);
    res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
    res.end();
  }
});

/**
 * GET /api/v1/google/trends/preview
 * Fetch actual trending topics for the user and stream LLM summary
 * Shows immediate value when connecting Google Trends
 * SSE endpoint
 */
router.get('/trends/preview', async (req, res) => {
  // Extract token from query parameter (EventSource can't send headers)
  const token = req.query.token;

  if (!token) {
    return res.status(401).json({
      error: 'Access denied',
      message: 'No token provided'
    });
  }

  let userId;
  try {
    const decoded = authService.verifyToken(token);
    userId = decoded.userId;
  } catch (error) {
    return res.status(401).json({
      error: 'Access denied',
      message: 'Invalid token'
    });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.flushHeaders?.();

  try {
    // Get user's audiences and keywords
    const audiencesQuery = `
      SELECT
        a.id,
        a.customer_problem,
        COALESCE(
          (SELECT json_agg(keyword ORDER BY relevance_score DESC)
           FROM (
             SELECT keyword, relevance_score
             FROM seo_keywords
             WHERE audience_id = a.id
             ORDER BY relevance_score DESC
             LIMIT 3
           ) sub),
          '[]'::json
        ) as top_keywords
      FROM audiences a
      WHERE a.user_id = $1
        AND EXISTS (SELECT 1 FROM seo_keywords WHERE audience_id = a.id)
      LIMIT 2
    `;

    const audiencesResult = await db.query(audiencesQuery, [userId]);

    if (audiencesResult.rows.length === 0) {
      res.write(`data: ${JSON.stringify({
        type: 'chunk',
        content: 'No audiences found yet. Create a content strategy first to see personalized trending topics!'
      })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
      res.end();
      return;
    }

    // Helper function to extract broader keywords
    const getBroaderKeywords = (keyword) => {
      const broader = [];

      // Remove common B2B modifiers and make more generic
      const genericVersions = [
        keyword.replace(/solutions? for /gi, ''),
        keyword.replace(/implementation|platform|software|tool/gi, '').trim(),
        keyword.split(' ').slice(0, 2).join(' '), // First 2 words
        keyword.split(' ')[0] // Single most important word
      ];

      // Extract main topics
      const mainTopics = [];
      if (/\bAI\b|\bartificial intelligence\b/i.test(keyword)) mainTopics.push('artificial intelligence', 'AI technology');
      if (/healthcare|hospital|medical/i.test(keyword)) mainTopics.push('healthcare technology', 'digital health');
      if (/manufacturing|factory|industrial/i.test(keyword)) mainTopics.push('smart manufacturing', 'industry 4.0');
      if (/cloud|SaaS/i.test(keyword)) mainTopics.push('cloud computing', 'cloud technology');
      if (/data|analytics/i.test(keyword)) mainTopics.push('data analytics', 'big data');
      if (/automation|automate/i.test(keyword)) mainTopics.push('automation technology', 'workflow automation');

      broader.push(...mainTopics, ...genericVersions.filter(k => k && k.length > 3));

      // Remove duplicates and return
      return [...new Set(broader)];
    };

    // Fetch trending data for first 2-3 keywords
    const trendingData = [];
    for (const audience of audiencesResult.rows) {
      const keywords = audience.top_keywords.slice(0, 2); // Max 2 keywords per audience

      for (const keyword of keywords) {
        try {
          // Try original keyword first
          let queries = await googleTrendsService.getRisingQueries(keyword, 'US', 'today 1-m', userId);

          // If no results, try broader versions
          if (!queries || queries.length === 0) {
            const broaderKeywords = getBroaderKeywords(keyword);
            console.log(`📈 No trends for "${keyword}", trying broader: ${broaderKeywords.slice(0, 3).join(', ')}`);

            for (const broaderKeyword of broaderKeywords.slice(0, 3)) {
              queries = await googleTrendsService.getRisingQueries(broaderKeyword, 'US', 'today 1-m', userId);
              if (queries && queries.length > 0) {
                console.log(`✅ Found ${queries.length} trends using broader keyword: "${broaderKeyword}"`);
                trendingData.push({
                  keyword: `${broaderKeyword} (related to: ${keyword})`,
                  audience: audience.customer_problem || 'Your audience',
                  trends: queries.slice(0, 3) // Top 3 rising queries
                });
                break; // Stop after first successful broader keyword
              }
            }
          } else if (queries.length > 0) {
            trendingData.push({
              keyword,
              audience: audience.customer_problem || 'Your audience',
              trends: queries.slice(0, 3) // Top 3 rising queries
            });
          }
        } catch (error) {
          console.error(`Failed to fetch trends for "${keyword}":`, error.message);
        }
      }
    }

    if (trendingData.length === 0) {
      res.write(`data: ${JSON.stringify({
        type: 'chunk',
        content: 'No trending data found for your keywords right now. We\'ll keep checking daily and alert you when trending topics emerge!'
      })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
      res.end();
      return;
    }

    // Generate LLM summary of findings
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `Summarize trending topics in 2-3 sentences total. Be extremely concise.

DATA:
${trendingData.map(td => `${td.trends.slice(0, 5).map(t => `"${t.query}" (+${t.value}%)`).join(', ')}`).join('; ')}

Write EXACTLY this format:

**📈 TRENDING TOPICS**

[Number] topics including "[topic 1]", "[topic 2]", and "[topic 3]".

**🎯 WHAT TO DO NOW**

We will create content like "[specific article title 1]", "[specific article title 2]", and "[specific article title 3]" to target this opportunity.

**💡 WHY THIS MATTERS**

These topics are growing fast - create content now to capture early traffic.

RULES:
- No bullets anywhere
- Maximum 3 sentences per section
- No explanations, just the summary`;

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0.7,
      max_tokens: 200
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'complete', trendingData })}\n\n`);
    res.end();

  } catch (error) {
    console.error('Error generating trends preview:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      content: 'Failed to fetch trending topics. Please try again later.'
    })}\n\n`);
    res.end();
  }
});

// ========================================
// EXISTING GOOGLE API ENDPOINTS
// ========================================

/**
 * GET /api/v1/google/trends/rising-queries
 * Get rising search queries from Google Trends
 *
 * Query params:
 * - keyword (required): The keyword to search for
 * - geo (optional): Geographic region (default: 'US')
 * - timeframe (optional): Time range (default: '7d')
 */
router.get('/trends/rising-queries', async (req, res) => {
  try {
    const { keyword, geo = 'US', timeframe = '7d' } = req.query;

    if (!keyword) {
      return res.status(400).json({ error: 'keyword parameter required' });
    }

    const result = await googleTrendsService.getRisingQueries(keyword, geo, timeframe);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching Google Trends:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/google/trends/related-topics
 * Get related topics from Google Trends
 *
 * Query params:
 * - keyword (required): The keyword to search for
 * - geo (optional): Geographic region (default: 'US')
 */
router.get('/trends/related-topics', async (req, res) => {
  try {
    const { keyword, geo = 'US' } = req.query;

    if (!keyword) {
      return res.status(400).json({ error: 'keyword parameter required' });
    }

    const result = await googleTrendsService.getRelatedTopics(keyword, geo);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching Google Trends:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/google/trends/interest-over-time
 * Get interest over time from Google Trends
 *
 * Query params:
 * - keyword (required): The keyword to search for
 * - startDate (required): Start date (YYYY-MM-DD)
 * - endDate (required): End date (YYYY-MM-DD)
 * - geo (optional): Geographic region (default: 'US')
 */
router.get('/trends/interest-over-time', async (req, res) => {
  try {
    const { keyword, startDate, endDate, geo = 'US' } = req.query;

    if (!keyword || !startDate || !endDate) {
      return res.status(400).json({ error: 'keyword, startDate, and endDate parameters required' });
    }

    const result = await googleTrendsService.getInterestOverTime(keyword, startDate, endDate, geo);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching Google Trends:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/google/search-console/top-queries
 * Get top performing queries from Google Search Console
 *
 * Query params:
 * - siteUrl (required): The site URL
 * - startDate (required): Start date (YYYY-MM-DD)
 * - endDate (required): End date (YYYY-MM-DD)
 * - limit (optional): Number of queries to return (default: 100)
 *
 * NOTE: Requires user authentication and OAuth tokens
 */
router.get('/search-console/top-queries', async (req, res) => {
  try {
    const { siteUrl, startDate, endDate, limit = 100 } = req.query;

    if (!siteUrl || !startDate || !endDate) {
      return res.status(400).json({ error: 'siteUrl, startDate, and endDate parameters required' });
    }

    // TODO: Get user's OAuth tokens from session/database
    // const userTokens = req.user.googleTokens;
    // await googleSearchConsoleService.initializeAuth(userTokens);

    const result = await googleSearchConsoleService.getTopQueries(
      siteUrl,
      startDate,
      endDate,
      parseInt(limit)
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching Google Search Console:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/google/search-console/page-performance
 * Get performance for a specific page from Google Search Console
 *
 * Query params:
 * - siteUrl (required): The site URL
 * - pageUrl (required): The specific page URL
 * - startDate (required): Start date (YYYY-MM-DD)
 * - endDate (required): End date (YYYY-MM-DD)
 */
router.get('/search-console/page-performance', async (req, res) => {
  try {
    const { siteUrl, pageUrl, startDate, endDate } = req.query;

    if (!siteUrl || !pageUrl || !startDate || !endDate) {
      return res.status(400).json({ error: 'siteUrl, pageUrl, startDate, and endDate parameters required' });
    }

    // TODO: Get user's OAuth tokens from session/database
    const result = await googleSearchConsoleService.getPagePerformance(
      siteUrl,
      pageUrl,
      startDate,
      endDate
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching Google Search Console:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/google/analytics/page-performance
 * Get page performance from Google Analytics
 *
 * Query params:
 * - pageUrl (required): The page URL path
 * - startDate (required): Start date (YYYY-MM-DD)
 * - endDate (required): End date (YYYY-MM-DD)
 */
router.get('/analytics/page-performance', async (req, res) => {
  try {
    const { pageUrl, startDate, endDate } = req.query;

    if (!pageUrl || !startDate || !endDate) {
      return res.status(400).json({ error: 'pageUrl, startDate, and endDate parameters required' });
    }

    const result = await googleAnalyticsService.getPagePerformance(
      pageUrl,
      startDate,
      endDate
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching Google Analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/google/analytics/traffic-sources
 * Get traffic sources breakdown from Google Analytics
 *
 * Query params:
 * - startDate (required): Start date (YYYY-MM-DD)
 * - endDate (required): End date (YYYY-MM-DD)
 */
router.get('/analytics/traffic-sources', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate parameters required' });
    }

    const result = await googleAnalyticsService.getTrafficSources(
      startDate,
      endDate
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching Google Analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/google/analytics/compare-trend-performance
 * Compare performance of trend-informed vs standard content
 *
 * Body:
 * - trendInformedUrls (required): Array of trend-informed post URLs
 * - standardUrls (required): Array of standard post URLs
 * - startDate (required): Start date (YYYY-MM-DD)
 * - endDate (required): End date (YYYY-MM-DD)
 */
router.post('/analytics/compare-trend-performance', async (req, res) => {
  try {
    const { trendInformedUrls, standardUrls, startDate, endDate } = req.body;

    if (!trendInformedUrls || !standardUrls || !startDate || !endDate) {
      return res.status(400).json({
        error: 'trendInformedUrls, standardUrls, startDate, and endDate are required'
      });
    }

    if (!Array.isArray(trendInformedUrls) || !Array.isArray(standardUrls)) {
      return res.status(400).json({
        error: 'trendInformedUrls and standardUrls must be arrays'
      });
    }

    const result = await googleAnalyticsService.compareTrendPerformance(
      trendInformedUrls,
      standardUrls,
      startDate,
      endDate
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error comparing trend performance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
