import express from 'express';
import { google } from 'googleapis';
import db from '../services/database.js';
import googleTrendsService from '../services/google-trends.js';
import googleSearchConsoleService from '../services/google-search-console.js';
import googleAnalyticsService from '../services/google-analytics.js';
import oauthManager from '../services/oauth-manager.js';
import integrationPitchGenerator from '../services/integration-pitch-generator.js';
import DatabaseAuthService from '../services/auth-database.js';
import { fetchTrendsForContentCalendar } from '../services/content-calendar-service.js';
import googleContentOptimizer from '../services/google-content-optimizer.js';

const router = express.Router();
const authService = new DatabaseAuthService();

const GOOGLE_SCOPES = {
  trends: [], // No OAuth needed, uses API key
  search_console: ['https://www.googleapis.com/auth/webmasters.readonly'],
  analytics: ['https://www.googleapis.com/auth/analytics.readonly']
};

/** Base OAuth callback URL (trimmed). Must match exactly what is in Google Cloud Console. No query string. */
function getGoogleRedirectUri() {
  const uri = (process.env.GOOGLE_REDIRECT_URI || '').trim();
  if (!uri) return '';
  return uri.replace(/\?.*$/, ''); // strip any existing query
}

/** Map URL service to DB service_name for app credentials */
const SERVICE_TO_DB_NAME = {
  search_console: 'google_search_console',
  analytics: 'google_analytics'
};

/**
 * Resolve client_id and client_secret: per-user encrypted store, then platform encrypted store, then env.
 */
async function getGoogleOAuthClientConfig(userId, service) {
  const dbName = SERVICE_TO_DB_NAME[service];
  if (!dbName) return null;
  const appCreds = await oauthManager.getAppCredentials(userId, dbName);
  if (appCreds?.client_id && appCreds?.client_secret) {
    return { clientId: appCreds.client_id, clientSecret: appCreds.client_secret };
  }
  const platformCreds = await oauthManager.getPlatformAppCredentials(dbName);
  if (platformCreds?.client_id && platformCreds?.client_secret) {
    return { clientId: platformCreds.client_id, clientSecret: platformCreds.client_secret };
  }
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET
    };
  }
  return null;
}

// ========================================
// OAUTH ENDPOINTS
// ========================================

/**
 * GET /api/v1/google/oauth/config
 * Public: whether the backend has Google OAuth client configured (encrypted store or env).
 * Frontend can use this to show/hide "Connect Google" or display a setup message.
 */
router.get('/oauth/config', async (_req, res) => {
  let clientConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  if (!clientConfigured) {
    const sc = await oauthManager.getPlatformAppCredentials('google_search_console');
    const ga = await oauthManager.getPlatformAppCredentials('google_analytics');
    clientConfigured = !!(sc?.client_id && sc?.client_secret) || !!(ga?.client_id && ga?.client_secret);
  }
  res.json({ success: true, clientConfigured });
});

/**
 * POST /api/v1/google/oauth/credentials
 * Store OAuth client credentials in encrypted store (per-user or platform).
 * Body: { service, client_id, client_secret } and optionally { platform: true }.
 * - Per-user (default): any authenticated user stores their own credentials.
 * - Platform: { platform: true } stores one set for the whole app; super_admin only.
 * JWT required. Do not log or expose client_secret.
 */
router.post('/oauth/credentials', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { service, client_id: clientId, client_secret: clientSecret, platform } = req.body || {};

    if (!service || !clientId || !clientSecret) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: service, client_id, client_secret'
      });
    }

    if (service !== 'search_console' && service !== 'analytics') {
      return res.status(400).json({
        success: false,
        error: 'service must be "search_console" or "analytics"'
      });
    }

    const dbName = SERVICE_TO_DB_NAME[service];

    if (platform === true) {
      if (req.user?.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          error: 'Platform credentials can only be set by super_admin'
        });
      }
      await oauthManager.storePlatformAppCredentials(dbName, clientId.trim(), clientSecret.trim());
    } else {
      await oauthManager.storeAppCredentials(userId, dbName, clientId.trim(), clientSecret.trim());
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('OAuth credentials store error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/google/oauth/authorize/:service
 * Initiate OAuth flow for a Google service. Uses per-user app credentials when stored (self-serve), else env.
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
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.json({
        success: true,
        noOAuthRequired: true,
        message: 'Google Trends connected successfully',
        redirectUrl: `${frontendUrl}/settings/google-integrations?connected=trends`
      });
    }

    const config = await getGoogleOAuthClientConfig(userId, service);
    if (!config) {
      return res.status(400).json({
        success: false,
        error: 'Google OAuth not configured. Store credentials via POST /api/v1/google/oauth/credentials (per-user or platform with platform: true for super_admin).'
      });
    }

    const redirectUri = getGoogleRedirectUri();
    if (!redirectUri) {
      return res.status(500).json({
        success: false,
        error: 'GOOGLE_REDIRECT_URI is not set. Set it in Vercel (e.g. https://<api>/api/v1/google/oauth/callback) for this environment.'
      });
    }
    const oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      redirectUri
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_SCOPES[service],
      state: Buffer.from(JSON.stringify({ userId, service })).toString('base64'),
      prompt: 'consent' // Force consent to get refresh token
    });

    res.json({ success: true, authUrl });
  } catch (error) {
    console.error('OAuth authorization error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/google/oauth/callback
 * OAuth callback handler. Uses credentials from encrypted store (per-user or platform) or env.
 */
router.get('/oauth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      throw new Error('Missing code or state parameter');
    }

    const statePayload = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
    const { userId, service } = statePayload;
    if (!userId || !service) {
      throw new Error('Invalid state: missing userId or service');
    }

    const config = await getGoogleOAuthClientConfig(userId, service);
    if (!config) {
      throw new Error('Google OAuth client not configured for this user');
    }

    const redirectUri = getGoogleRedirectUri();
    if (!redirectUri) {
      throw new Error('GOOGLE_REDIRECT_URI is not set');
    }
    const oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      redirectUri
    );

    const { tokens } = await oauth2Client.getToken(code);

    await oauthManager.storeCredentials(
      userId,
      `google_${service}`,
      tokens,
      GOOGLE_SCOPES[service]
    );

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/settings/google-integrations?connected=${service}`);
  } catch (error) {
    console.error('OAuth callback error:', error.message);
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

    // Google Trends: no OAuth; match response shape of other services (expires_at, scopes) for frontend
    if (service === 'trends') {
      return res.json({
        success: true,
        connected: true,
        expires_at: null,
        scopes: [],
        message: 'Google Trends uses public API - no authentication required'
      });
    }

    const credentials = await oauthManager.getCredentials(userId, `google_${service}`);

    res.json({
      success: true,
      connected: !!credentials,
      expires_at: credentials?.expires_at ?? null,
      scopes: credentials?.scopes ?? []
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
 * SSE endpoint. Events: chunk, complete, error.
 * Auth: cookie (preferred for EventSource withCredentials) or ?token= for legacy.
 * SECURITY: Do not log or expose the token query parameter.
 */
router.get('/trends/preview', authService.authMiddlewareFlexible.bind(authService), async (req, res) => {
  const userId = req.user.userId;

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
        a.target_segment,
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
         OR a.organization_intelligence_id IN (
           SELECT oi.id
           FROM organization_intelligence oi
           JOIN organizations o ON oi.organization_id = o.id
           WHERE o.owner_user_id = $1
         )
      ORDER BY a.created_at DESC
      LIMIT 2
    `;

    const audiencesResult = await db.query(audiencesQuery, [userId]);

    if (audiencesResult.rows.length === 0) {
      res.write(`data: ${JSON.stringify({
        type: 'chunk',
        content: 'No strategies found yet. Complete your website analysis first to see personalized trending topics!'
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
      // Use seo_keywords if available, otherwise fall back to target_segment / customer_problem
      let keywords = audience.top_keywords.slice(0, 2);
      if (keywords.length === 0) {
        const fallback = audience.target_segment || audience.customer_problem || '';
        const fallbackKeyword = fallback.split(/[,.\n]/)[0].trim(); // First phrase
        if (fallbackKeyword) keywords = [fallbackKeyword];
      }

      for (const keyword of keywords) {
        try {
          // Try cache first (refresh/cron use '7d') so we show cached data when available
          let queries = await googleTrendsService.getRisingQueries(keyword, 'US', '7d', userId);
          // If no cached data, try live fetch with 1-month window
          if (!queries || queries.length === 0) {
            queries = await googleTrendsService.getRisingQueries(keyword, 'US', 'today 1-m', userId);
          }

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

    const prompt = `You are analyzing Google Trends data for a user's content strategy. Generate a data-driven summary explaining the trending opportunities.

CRITICAL: You MUST include specific numbers and percentages. Reference the actual growth rates shown below.

Structure your response as follows:

**📈 TRENDING TOPICS FOUND:**
List each trending query with its exact growth metric:
- "[Query Name]" (↑ [exact % or metric from data])
- Explain what this growth means in plain terms

**🎯 HOW TO TARGET:**
- Search volume insight: What the numbers tell us about opportunity size
- Content strategy: Which specific topics to prioritize based on growth rates
- Keywords to use in your content based on these trends

**💡 IMPACT ON YOUR CONTENT:**
- Expected visibility boost from targeting these trends
- Timing advantage: Why creating content NOW matters
- Competitive edge: How early adoption helps

DATA FOUND:
${trendingData.map(td => `
Audience: ${td.audience}
Base Keyword: "${td.keyword}"
Rising Queries with Growth:
${td.trends.map(t => `  • "${t.query}" - Growth: ${t.formattedValue || (t.value + '%')} ${t.value > 1000 ? '(BREAKING OUT - Massive spike)' : t.value > 500 ? '(SURGING - Major growth)' : '(RISING - Significant interest)'}`).join('\n')}
`).join('\n')}

REQUIREMENTS:
- Use bullet points and clear sections
- Include ALL growth percentages from the data
- Explain what each metric means for their strategy
- Be specific about how to use this data
- Keep it actionable and data-focused`;

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0.7,
      max_tokens: 500
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
    // Do not log token or req.query
    console.error('Error generating trends preview:', error.message || error);
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
 * GET /api/v1/google/trends/topics
 * Return cached emerging/trending topics for the current user (from google_trends_cache).
 * Use this to display "Find Emerging Topics" in the UI.
 * If cache is empty and the user has strategies with SEO keywords, triggers a one-time
 * refresh so the response includes data (first load may take a few seconds).
 * Query: limit (optional, default 20).
 */
router.get('/trends/topics', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication is required'
      });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    let data = await googleContentOptimizer.getTrendingTopicsForUser(String(userId), limit);

    // If empty, refresh: try default keywords first (fast, ~5s), then strategy-based if still empty
    if (data.length === 0) {
      await fetchTrendsForContentCalendar(userId, []);
      data = await googleContentOptimizer.getTrendingTopicsForUser(String(userId), limit);
    }
    if (data.length === 0) {
      let strategyResult = await db.query(
        `SELECT DISTINCT a.id
         FROM audiences a
         WHERE a.user_id = $1
           AND EXISTS (SELECT 1 FROM seo_keywords WHERE audience_id = a.id)`,
        [userId]
      );
      let strategyIds = strategyResult.rows.map((r) => r.id);
      if (strategyIds.length === 0) {
        strategyResult = await db.query(
          `SELECT id FROM audiences
           WHERE user_id = $1
             AND (customer_problem IS NOT NULL AND customer_problem != '' OR target_segment IS NOT NULL)`,
          [userId]
        );
        strategyIds = strategyResult.rows.map((r) => r.id);
      }
      await fetchTrendsForContentCalendar(userId, strategyIds);
      data = await googleContentOptimizer.getTrendingTopicsForUser(String(userId), limit);
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('Google Trends topics error:', error);
    const message = error?.message ?? 'Failed to get trending topics';
    res.status(500).json({
      success: false,
      error: 'Failed to get trending topics',
      message
    });
  }
});

/**
 * POST /api/v1/google/trends/refresh
 * Force a refresh of Google Trends (Find Emerging Topics) for the current user.
 * Fetches rising queries for the user's strategy keywords and populates the cache
 * so trending preview and content calendar use fresh data. Otherwise runs on schedule (daily).
 * Requires JWT.
 */
router.post('/trends/refresh', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication is required to refresh trending topics'
      });
    }

    let strategyResult = await db.query(
      `SELECT DISTINCT a.id
       FROM audiences a
       WHERE a.user_id = $1
         AND EXISTS (SELECT 1 FROM seo_keywords WHERE audience_id = a.id)`,
      [userId]
    );
    let strategyIds = strategyResult.rows.map((r) => r.id);

    // If no strategies have SEO keywords, try audiences with target_segment/customer_problem (fallback for trends)
    if (strategyIds.length === 0) {
      strategyResult = await db.query(
        `SELECT id FROM audiences
         WHERE user_id = $1
           AND (customer_problem IS NOT NULL AND customer_problem != '' OR target_segment IS NOT NULL)`,
        [userId]
      );
      strategyIds = strategyResult.rows.map((r) => r.id);
    }

    // When no strategies: service uses generic keywords so user still gets topics
    const result = await fetchTrendsForContentCalendar(userId, strategyIds);

    res.json({
      success: true,
      fetched: result.fetched,
      keywordCount: result.keywordCount,
      errorCount: result.errorCount,
      message: result.keywordCount === 0
        ? 'No keywords to fetch. Add SEO keywords to your strategies.'
        : `Refreshed emerging topics for ${result.keywordCount} keyword(s). ${result.fetched} cached, ${result.errorCount} errors.`
    });
  } catch (error) {
    console.error('Google Trends refresh error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh trending topics',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/google/trends/rising-queries
 * Get rising search queries from Google Trends.
 * Dashboard: strategy cards use keyword + timeframe=30d.
 * Response: { success, data: [{ query, value }] } (extra fields allowed).
 */
router.get('/trends/rising-queries', async (req, res) => {
  try {
    const { keyword, geo = 'US', timeframe = '30d' } = req.query;

    if (!keyword) {
      return res.status(400).json({ error: 'keyword parameter required' });
    }

    const result = await googleTrendsService.getRisingQueries(keyword, geo, timeframe);
    // Shape for dashboard: at least { query, value } per item
    const data = Array.isArray(result)
      ? result.map((item) => ({ query: item.query, value: item.value }))
      : [];
    res.json({ success: true, data });
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
 * Get interest over time from Google Trends.
 * Dashboard: performance card chart. Response shape for frontend normalization:
 * { success, data: { timelineData } } with points having formattedTime, date, value, interest.
 */
router.get('/trends/interest-over-time', async (req, res) => {
  try {
    const { keyword, startDate, endDate, geo = 'US' } = req.query;

    if (!keyword || !startDate || !endDate) {
      return res.status(400).json({ error: 'keyword, startDate, and endDate parameters required' });
    }

    const raw = await googleTrendsService.getInterestOverTime(keyword, startDate, endDate, geo);
    const timelineData = Array.isArray(raw)
      ? raw.map((p) => ({
          formattedTime: p.date,
          date: p.date,
          value: p.value,
          interest: p.value
        }))
      : [];
    res.json({ success: true, data: { timelineData } });
  } catch (error) {
    console.error('Error fetching Google Trends:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/google/funnel
 * Per-post funnel metrics: Search Impressions → Search Clicks → Time on Site → Internal Links Clicked → CTA Clicks.
 * Requires pageUrl, siteUrl (for GSC), propertyId (for GA), and date range. Returns partial funnel when only GSC or only GA is connected.
 *
 * Query params:
 * - pageUrl (required): The post's URL (full URL for GSC; path for GA pagePath—use same value if your site uses one format for both)
 * - siteUrl (required): Site URL in GSC (e.g. https://example.com or sc-domain:example.com)
 * - propertyId (required): GA4 Property ID
 * - startDate (required): YYYY-MM-DD
 * - endDate (required): YYYY-MM-DD
 */
router.get('/funnel', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { pageUrl, siteUrl, propertyId, startDate, endDate } = req.query;

    if (!pageUrl || !siteUrl || !propertyId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'pageUrl, siteUrl, propertyId, startDate, and endDate are required'
      });
    }

    const userId = req.user.userId;
    const funnel = {
      search_impressions: null,
      search_clicks: null,
      time_on_site_seconds: null,
      internal_links_clicked: null,
      cta_clicks: null
    };
    const meta = { start_date: startDate, end_date: endDate, gsc_connected: false, ga_connected: false };

    // GSC: Search Impressions + Search Clicks
    const gscCredentials = await oauthManager.getCredentials(userId, 'google_search_console');
    if (gscCredentials) {
      meta.gsc_connected = true;
      await googleSearchConsoleService.initializeAuth(gscCredentials);
      const gscResult = await googleSearchConsoleService.getPagePerformance(
        siteUrl,
        pageUrl,
        startDate,
        endDate
      );
      if (gscResult?.data) {
        funnel.search_impressions = gscResult.data.impressions ?? 0;
        funnel.search_clicks = gscResult.data.clicks ?? 0;
      } else {
        funnel.search_impressions = 0;
        funnel.search_clicks = 0;
      }
    }

    // GA: Time on Site, Internal Links Clicked, CTA Clicks
    const gaCredentials = await oauthManager.getCredentials(userId, 'google_analytics');
    if (gaCredentials) {
      meta.ga_connected = true;
      await googleAnalyticsService.initializeAuth(gaCredentials);
      const gaPerf = await googleAnalyticsService.getPagePerformance(
        propertyId,
        pageUrl,
        startDate,
        endDate
      );
      if (gaPerf?.avgSessionDuration != null) {
        funnel.time_on_site_seconds = Math.round(gaPerf.avgSessionDuration);
      } else {
        funnel.time_on_site_seconds = 0;
      }
      const internalLinks = await googleAnalyticsService.getPageEventCount(
        propertyId,
        pageUrl,
        startDate,
        endDate,
        'internal_link_click'
      );
      const ctaClicks = await googleAnalyticsService.getPageEventCount(
        propertyId,
        pageUrl,
        startDate,
        endDate,
        'cta_click'
      );
      funnel.internal_links_clicked = internalLinks;
      funnel.cta_clicks = ctaClicks;
    }

    res.json({ success: true, funnel, meta });
  } catch (error) {
    console.error('Google funnel error:', error);

    if (error.code === 401 || error.message?.includes('invalid_grant') || error.message?.includes('invalid credentials')) {
      return res.status(401).json({
        success: false,
        error: 'OAuth token expired or invalid. Please reconnect Google Search Console or Analytics.',
        needsReconnect: true
      });
    }

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
router.get('/search-console/top-queries', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { siteUrl, startDate, endDate, limit = 100 } = req.query;

    if (!siteUrl || !startDate || !endDate) {
      return res.status(400).json({ error: 'siteUrl, startDate, and endDate parameters required' });
    }

    // Get user's OAuth credentials
    const userId = req.user.userId;
    const credentials = await oauthManager.getCredentials(userId, 'google_search_console');

    if (!credentials) {
      return res.status(401).json({
        success: false,
        error: 'Google Search Console not connected. Please connect your account first.',
        needsReconnect: true
      });
    }

    // Initialize GSC service with user's OAuth tokens
    await googleSearchConsoleService.initializeAuth(credentials);

    const result = await googleSearchConsoleService.getTopQueries(
      siteUrl,
      startDate,
      endDate,
      parseInt(limit)
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching Google Search Console:', error);

    // Handle token expiration errors
    if (error.code === 401 || error.message?.includes('invalid_grant') || error.message?.includes('invalid credentials')) {
      return res.status(401).json({
        success: false,
        error: 'OAuth token expired or invalid. Please reconnect your account.',
        needsReconnect: true
      });
    }

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
router.get('/search-console/page-performance', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { siteUrl, pageUrl, startDate, endDate } = req.query;

    if (!siteUrl || !pageUrl || !startDate || !endDate) {
      return res.status(400).json({ error: 'siteUrl, pageUrl, startDate, and endDate parameters required' });
    }

    // Get user's OAuth credentials
    const userId = req.user.userId;
    const credentials = await oauthManager.getCredentials(userId, 'google_search_console');

    if (!credentials) {
      return res.status(401).json({
        success: false,
        error: 'Google Search Console not connected. Please connect your account first.',
        needsReconnect: true
      });
    }

    // Initialize GSC service with user's OAuth tokens
    await googleSearchConsoleService.initializeAuth(credentials);

    const result = await googleSearchConsoleService.getPagePerformance(
      siteUrl,
      pageUrl,
      startDate,
      endDate
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching Google Search Console:', error);

    // Handle token expiration errors
    if (error.code === 401 || error.message?.includes('invalid_grant') || error.message?.includes('invalid credentials')) {
      return res.status(401).json({
        success: false,
        error: 'OAuth token expired or invalid. Please reconnect your account.',
        needsReconnect: true
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/google/analytics/page-performance
 * Get page performance from Google Analytics
 *
 * Query params:
 * - propertyId (required): GA4 Property ID
 * - pageUrl (required): The page URL path
 * - startDate (required): Start date (YYYY-MM-DD)
 * - endDate (required): End date (YYYY-MM-DD)
 */
router.get('/analytics/page-performance', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { propertyId, pageUrl, startDate, endDate } = req.query;

    if (!propertyId || !pageUrl || !startDate || !endDate) {
      return res.status(400).json({ error: 'propertyId, pageUrl, startDate, and endDate parameters required' });
    }

    // Get user's OAuth credentials
    const userId = req.user.userId;
    const credentials = await oauthManager.getCredentials(userId, 'google_analytics');

    if (!credentials) {
      return res.status(401).json({
        success: false,
        error: 'Google Analytics not connected. Please connect your account first.',
        needsReconnect: true
      });
    }

    // Initialize GA service with user's OAuth tokens
    await googleAnalyticsService.initializeAuth(credentials);

    const result = await googleAnalyticsService.getPagePerformance(
      propertyId,
      pageUrl,
      startDate,
      endDate
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching Google Analytics:', error);

    // Handle token expiration errors
    if (error.code === 401 || error.message?.includes('invalid_grant') || error.message?.includes('invalid credentials')) {
      return res.status(401).json({
        success: false,
        error: 'OAuth token expired or invalid. Please reconnect your account.',
        needsReconnect: true
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/google/analytics/traffic-sources
 * Get traffic sources breakdown from Google Analytics
 *
 * Query params:
 * - propertyId (required): GA4 Property ID
 * - startDate (required): Start date (YYYY-MM-DD)
 * - endDate (required): End date (YYYY-MM-DD)
 */
router.get('/analytics/traffic-sources', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { propertyId, startDate, endDate } = req.query;

    if (!propertyId || !startDate || !endDate) {
      return res.status(400).json({ error: 'propertyId, startDate, and endDate parameters required' });
    }

    // Get user's OAuth credentials
    const userId = req.user.userId;
    const credentials = await oauthManager.getCredentials(userId, 'google_analytics');

    if (!credentials) {
      return res.status(401).json({
        success: false,
        error: 'Google Analytics not connected. Please connect your account first.',
        needsReconnect: true
      });
    }

    // Initialize GA service with user's OAuth tokens
    await googleAnalyticsService.initializeAuth(credentials);

    const result = await googleAnalyticsService.getTrafficSources(
      propertyId,
      startDate,
      endDate
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching Google Analytics:', error);

    // Handle token expiration errors
    if (error.code === 401 || error.message?.includes('invalid_grant') || error.message?.includes('invalid credentials')) {
      return res.status(401).json({
        success: false,
        error: 'OAuth token expired or invalid. Please reconnect your account.',
        needsReconnect: true
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/google/analytics/compare-trend-performance
 * Compare performance of trend-informed vs standard content
 *
 * Body:
 * - propertyId (required): GA4 Property ID
 * - trendInformedUrls (required): Array of trend-informed post URLs
 * - standardUrls (required): Array of standard post URLs
 * - startDate (required): Start date (YYYY-MM-DD)
 * - endDate (required): End date (YYYY-MM-DD)
 */
router.post('/analytics/compare-trend-performance', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { propertyId, trendInformedUrls, standardUrls, startDate, endDate } = req.body;

    if (!propertyId || !trendInformedUrls || !standardUrls || !startDate || !endDate) {
      return res.status(400).json({
        error: 'propertyId, trendInformedUrls, standardUrls, startDate, and endDate are required'
      });
    }

    if (!Array.isArray(trendInformedUrls) || !Array.isArray(standardUrls)) {
      return res.status(400).json({
        error: 'trendInformedUrls and standardUrls must be arrays'
      });
    }

    // Get user's OAuth credentials
    const userId = req.user.userId;
    const credentials = await oauthManager.getCredentials(userId, 'google_analytics');

    if (!credentials) {
      return res.status(401).json({
        success: false,
        error: 'Google Analytics not connected. Please connect your account first.',
        needsReconnect: true
      });
    }

    // Initialize GA service with user's OAuth tokens
    await googleAnalyticsService.initializeAuth(credentials);

    const result = await googleAnalyticsService.compareTrendPerformance(
      propertyId,
      trendInformedUrls,
      standardUrls,
      startDate,
      endDate
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error comparing trend performance:', error);

    // Handle token expiration errors
    if (error.code === 401 || error.message?.includes('invalid_grant') || error.message?.includes('invalid credentials')) {
      return res.status(401).json({
        success: false,
        error: 'OAuth token expired or invalid. Please reconnect your account.',
        needsReconnect: true
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
