/**
 * Strategy routes for pitch generation and strategy management
 * Complements strategy-subscriptions.js (subscription/payment endpoints)
 */

import express from 'express';
import db from '../services/database.js';
import openaiService from '../services/openai.js';
import DatabaseAuthService from '../services/auth-database.js';

const router = express.Router();
const authService = new DatabaseAuthService();

// In-memory cache for sample content ideas
// Key format: sample-ideas-${strategyId}
// Value: { ideas: string[], timestamp: number }
// TTL: 1 week (604800000ms)
const sampleIdeasCache = new Map();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
const CONTENT_CALENDAR_DAYS = parseInt(process.env.CONTENT_CALENDAR_DAYS, 10) || 7;

// In-memory cache for strategy overview
// Key format: overview-${orgId}-${integrationsHash}
// Value: { overview: object, integrationStatus: object, timestamp: number }
// TTL: 24 hours (86400000ms)
const overviewCache = new Map();
const OVERVIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * GET /api/v1/strategies/:id/pitch
 * Generate LLM-powered pitch and pricing rationale for a strategy
 * Streams content via SSE (Server-Sent Events)
 * Authentication: Bearer header or ?token= query param (EventSource can't send headers)
 * Note: Uses GET instead of POST because EventSource only supports GET
 */
router.get('/:id/pitch', async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.userId;

  if (!userId) {
    res.status(401).set('Content-Type', 'text/plain').end('Unauthorized');
    return;
  }

  console.log(`🎯 Strategy pitch request: strategyId=${id}, userId=${userId}`);

  // Set up SSE headers with CORS
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.flushHeaders?.();

  try {
    // Fetch strategy data from audiences table
    const strategyQuery = 'SELECT * FROM audiences WHERE id = $1';
    const strategyResult = await db.query(strategyQuery, [id]);

    if (!strategyResult.rows || strategyResult.rows.length === 0) {
      console.warn(`⚠️ Strategy not found: ${id}`);
      res.write(`data: ${JSON.stringify({ type: 'error', content: 'Strategy not found' })}\n\n`);
      return res.end();
    }

    const strategyData = strategyResult.rows[0];
    console.log(`✅ Found strategy: ${strategyData.id}`);

    // Stream pitch generation
    console.log('🎯 Starting pitch generation...');
    const pitchStream = openaiService.generateStrategyPitch(strategyData);

    for await (const chunk of pitchStream) {
      res.write(`data: ${JSON.stringify({ type: 'pitch-chunk', content: chunk })}\n\n`);
    }

    console.log('✅ Pitch streaming complete, starting pricing rationale...');

    // Stream pricing rationale generation
    const pricingStream = openaiService.generatePricingRationale(strategyData);

    for await (const chunk of pricingStream) {
      res.write(`data: ${JSON.stringify({ type: 'pricing-chunk', content: chunk })}\n\n`);
    }

    console.log('✅ Pricing rationale streaming complete');

    // Send completion event
    res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
    res.end();

  } catch (error) {
    console.error('❌ Strategy pitch generation error:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      content: error.message || 'Failed to generate strategy pitch'
    })}\n\n`);
    res.end();
  }
});

/**
 * GET /api/v1/strategies/overview
 * Generate personalized "Understanding Audience Strategies" content
 * Returns LLM-generated explanations adapted to the user's business context
 * Authentication: Token required via Authorization header
 * Caching: Results cached for 24 hours per organization
 */
router.get('/overview', authService.authMiddleware.bind(authService), async (req, res) => {
  const userId = req.user.userId;

  try {
    console.log(`📖 Strategy overview request: userId=${userId}`);

    // Get user's organization via organization_members table
    const userQuery = `
      SELECT om.organization_id
      FROM organization_members om
      WHERE om.user_id = $1 AND om.status = 'active'
      LIMIT 1
    `;
    const userResult = await db.query(userQuery, [userId]);

    if (!userResult.rows || userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found or not member of any organization' });
    }

    const organizationId = userResult.rows[0].organization_id;

    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'User has no organization' });
    }

    // Get organization context
    const orgQuery = `
      SELECT
        business_type,
        industry_category,
        business_model,
        target_audience
      FROM organizations
      WHERE id = $1
    `;
    const orgResult = await db.query(orgQuery, [organizationId]);

    if (!orgResult.rows || orgResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }

    const orgContext = orgResult.rows[0];

    // Check Google integration status
    const integrationsQuery = `
      SELECT service_name, status, last_used_at
      FROM user_oauth_credentials
      WHERE user_id = $1 AND status = 'active'
    `;
    const integrationsResult = await db.query(integrationsQuery, [userId]);

    const integrationStatus = {
      trends: integrationsResult.rows.some(row => row.service_name === 'google_trends'),
      searchConsole: integrationsResult.rows.some(row => row.service_name === 'google_search_console'),
      analytics: integrationsResult.rows.some(row => row.service_name === 'google_analytics')
    };

    // Create cache key based on org and integrations
    const integrationsHash = `${integrationStatus.trends}-${integrationStatus.searchConsole}-${integrationStatus.analytics}`;
    const cacheKey = `overview-${organizationId}-${integrationsHash}`;

    // Check cache first
    const cachedData = overviewCache.get(cacheKey);
    if (cachedData && (Date.now() - cachedData.timestamp < OVERVIEW_CACHE_TTL_MS)) {
      console.log(`✅ Cache hit for strategy overview: ${cacheKey}`);
      return res.json({
        success: true,
        overview: cachedData.overview,
        integrationStatus: cachedData.integrationStatus,
        cached: true
      });
    }

    // Generate personalized overview using LLM
    console.log('🤖 Generating personalized overview with OpenAI...');
    const overview = await openaiService.generateStrategyOverview(orgContext, integrationStatus);

    // Cache the result
    overviewCache.set(cacheKey, {
      overview,
      integrationStatus,
      timestamp: Date.now()
    });

    console.log(`✅ Strategy overview generated and cached: ${cacheKey}`);

    res.json({
      success: true,
      overview: {
        sections: {
          whatIsStrategy: overview.whatIsStrategy,
          howWeUse: overview.howWeUse,
          pricing: overview.pricing,
          googleIntegrations: overview.integrations
        }
      },
      integrationStatus: {
        googleTrends: {
          connected: integrationStatus.trends,
          connectedAt: integrationsResult.rows.find(r => r.service_name === 'google_trends')?.last_used_at
        },
        searchConsole: {
          connected: integrationStatus.searchConsole,
          connectedAt: integrationsResult.rows.find(r => r.service_name === 'google_search_console')?.last_used_at
        },
        analytics: {
          connected: integrationStatus.analytics,
          connectedAt: integrationsResult.rows.find(r => r.service_name === 'google_analytics')?.last_used_at
        }
      },
      cached: false
    });

  } catch (error) {
    console.error('❌ Strategy overview error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate strategy overview'
    });
  }
});

/**
 * POST /api/v1/strategies/:id/sample-content-ideas
 * Generate 3 sample content ideas as a teaser for strategies with empty content calendars
 * Authentication: Token required via Authorization header
 * Caching: Results cached for 1 week to reduce API costs
 */
router.post('/:id/sample-content-ideas', async (req, res) => {
  const { id } = req.params;

  // Validate auth token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.substring(7);
  let userId = null;

  try {
    const decoded = authService.verifyToken(token);
    userId = decoded?.userId;
  } catch (error) {
    console.warn('⚠️ Invalid auth token for sample ideas:', error.message);
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token' });
  }

  if (!userId) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid user' });
  }

  console.log(`💡 Sample content ideas request: strategyId=${id}, userId=${userId}`);

  try {
    // Check cache first
    const cacheKey = `sample-ideas-${id}`;
    const cached = sampleIdeasCache.get(cacheKey);

    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < CACHE_TTL_MS) {
        console.log(`✅ Returning cached sample ideas (age: ${Math.round(age / 3600000)}h)`);
        return res.json({
          success: true,
          sampleIdeas: cached.ideas,
          isTeaser: true,
          totalIdeasAvailable: CONTENT_CALENDAR_DAYS,
          cached: true
        });
      } else {
        // Cache expired, remove it
        sampleIdeasCache.delete(cacheKey);
        console.log('🗑️ Cache expired, regenerating sample ideas');
      }
    }

    // Fetch strategy data from audiences table
    const strategyQuery = 'SELECT * FROM audiences WHERE id = $1';
    const strategyResult = await db.query(strategyQuery, [id]);

    if (!strategyResult.rows || strategyResult.rows.length === 0) {
      console.warn(`⚠️ Strategy not found: ${id}`);
      return res.status(404).json({ success: false, error: 'Strategy not found' });
    }

    const strategyData = strategyResult.rows[0];
    console.log(`✅ Found strategy: ${strategyData.id}`);

    // Generate sample ideas using OpenAI
    console.log('💡 Generating sample content ideas via OpenAI...');
    const sampleIdeas = await openaiService.generateSampleContentIdeas(strategyData);

    if (!sampleIdeas || !Array.isArray(sampleIdeas) || sampleIdeas.length !== 3) {
      console.error('❌ Invalid sample ideas returned from OpenAI service');
      return res.status(500).json({
        success: false,
        error: 'Failed to generate sample ideas'
      });
    }

    // Cache the result
    sampleIdeasCache.set(cacheKey, {
      ideas: sampleIdeas,
      timestamp: Date.now()
    });

    console.log('✅ Sample ideas generated and cached successfully');

    // Return response
    res.json({
      success: true,
      sampleIdeas: sampleIdeas,
      isTeaser: true,
      totalIdeasAvailable: CONTENT_CALENDAR_DAYS
    });

  } catch (error) {
    console.error('❌ Sample content ideas generation error:', error);

    // Return generic fallback ideas on error
    const fallbackIdeas = [
      'Content idea tailored to your target audience',
      'Strategic blog post based on your keywords',
      'SEO-optimized article for your niche'
    ];

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate sample ideas',
      sampleIdeas: fallbackIdeas,
      fallback: true
    });
  }
});

/**
 * GET /api/v1/strategies/content-calendar
 * Get unified content calendar for all subscribed strategies
 * Returns all strategies the user is subscribed to with their content ideas
 * Requires authentication
 */
router.get('/content-calendar', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    console.log(`📅 Content calendar request for user: ${userId}`);

    // Get all subscribed strategies for this user
    const query = `
      SELECT DISTINCT a.*
      FROM audiences a
      INNER JOIN strategy_purchases sp ON a.id = sp.strategy_id
      WHERE sp.user_id = $1
        AND sp.status = 'active'
      ORDER BY a.created_at DESC
    `;

    const result = await db.query(query, [userId]);

    if (!result.rows || result.rows.length === 0) {
      console.log(`ℹ️ No subscribed strategies found for user: ${userId}`);
      return res.json({
        success: true,
        strategies: [],
        message: 'No subscribed strategies found'
      });
    }

    // Transform strategies to include all relevant fields
    const strategies = result.rows.map(strategy => ({
      id: strategy.id,
      pitch: strategy.pitch,
      customer_problem: strategy.customer_problem,
      content_ideas: strategy.content_ideas || [],
      content_calendar_generated_at: strategy.content_calendar_generated_at,
      target_segment: strategy.target_segment,
      pricing_monthly: strategy.pricing_monthly,
      profit_low: strategy.profit_low,
      profit_high: strategy.profit_high,
      created_at: strategy.created_at
    }));

    console.log(`✅ Found ${strategies.length} subscribed strategies with calendars`);

    res.json({
      success: true,
      strategies: strategies
    });

  } catch (error) {
    console.error('❌ Error fetching content calendar:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch content calendar'
    });
  }
});

/**
 * Note: Generic GET routes for strategies are handled by audiences.js and strategy-subscriptions.js
 * This file focuses on LLM-powered strategy pitch generation and content calendar views
 */

export default router;
