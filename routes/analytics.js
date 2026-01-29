import express from 'express';
import analyticsService from '../services/analytics.js';
import openaiService from '../services/openai.js';
import db from '../services/database.js';
import DatabaseAuthService from '../services/auth-database.js';

const router = express.Router();
const authService = new DatabaseAuthService();

/**
 * Helper middleware to require superadmin role
 */
function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      error: 'Superadmin access required'
    });
  }
  next();
}

/**
 * Event Tracking Routes (authenticated users only)
 */

/**
 * Track a single event
 * POST /api/v1/analytics/track
 */
router.post('/track', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { eventType, eventData, pageUrl, metadata } = req.body;
    const userId = req.user?.userId || null;
    const { sessionId, referrer, conversionFunnelStep, revenueAttributed } = metadata || {};

    if (!eventType) {
      return res.status(400).json({
        success: false,
        error: 'eventType is required'
      });
    }

    const event = await analyticsService.trackEvent(
      userId,
      sessionId,
      eventType,
      eventData || {},
      {
        pageUrl,
        referrer,
        conversionFunnelStep,
        revenueAttributed
      }
    );

    res.json({
      success: true,
      eventId: event?.id || null
    });
  } catch (error) {
    console.error('Error tracking event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track event',
      message: error.message
    });
  }
});

/**
 * Track batch events
 * POST /api/v1/analytics/track-batch
 */
router.post('/track-batch', authService.authMiddleware.bind(authService), async (req, res) => {
  try {
    const { events } = req.body;

    if (!events || !Array.isArray(events)) {
      return res.status(400).json({
        success: false,
        error: 'events array is required'
      });
    }

    const eventsTracked = await analyticsService.bulkTrackEvents(events);

    res.json({
      success: true,
      eventsTracked
    });
  } catch (error) {
    console.error('Error tracking batch events:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track batch events',
      message: error.message
    });
  }
});

/**
 * Analytics Data Routes (superadmin only)
 */

/**
 * Get funnel data
 * GET /api/v1/analytics/funnel
 */
router.get('/funnel',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'startDate and endDate are required'
        });
      }

      const funnelData = await analyticsService.getFunnelData(startDate, endDate);

      res.json({
        success: true,
        ...funnelData
      });
    } catch (error) {
      console.error('Error getting funnel data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get funnel data',
        message: error.message
      });
    }
  }
);

/**
 * Get users at a specific funnel stage
 * GET /api/v1/analytics/funnel/stage/:funnelStep/users
 */
router.get('/funnel/stage/:funnelStep/users',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { funnelStep } = req.params;
      const { startDate, endDate, excludeAdvanced } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'startDate and endDate are required'
        });
      }

      const users = await analyticsService.getUsersAtFunnelStage(
        funnelStep,
        startDate,
        endDate,
        excludeAdvanced === 'true'
      );

      res.json({
        success: true,
        funnelStep,
        users,
        count: users.length
      });
    } catch (error) {
      console.error('Error getting users at funnel stage:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get users at funnel stage',
        message: error.message
      });
    }
  }
);

/**
 * Get lead funnel data (anonymous visitor journey)
 * GET /api/v1/analytics/lead-funnel
 */
router.get('/lead-funnel',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'startDate and endDate are required'
        });
      }

      const leadFunnelData = await analyticsService.getLeadFunnelData(startDate, endDate);

      res.json({
        success: true,
        ...leadFunnelData
      });
    } catch (error) {
      console.error('Error getting lead funnel data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get lead funnel data',
        message: error.message
      });
    }
  }
);

/**
 * Get user journey
 * GET /api/v1/analytics/users/:userId/journey
 */
router.get('/users/:userId/journey',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const limit = parseInt(req.query.limit) || 100;

      const journey = await analyticsService.getUserJourney(userId, limit);

      // Get revenue attribution
      const revenue = await analyticsService.getRevenueAttribution(userId);

      res.json({
        success: true,
        ...journey, // Spreads: userId, totalEvents, events, categorizedEvents
        revenue
      });
    } catch (error) {
      console.error('Error getting user journey:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get user journey',
        message: error.message
      });
    }
  }
);

/**
 * Get cohort analysis
 * GET /api/v1/analytics/cohorts
 */
router.get('/cohorts',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { startDate, endDate, groupBy } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'startDate and endDate are required'
        });
      }

      // For now, use startDate as cohort date
      // In the future, this could be enhanced to analyze multiple cohorts
      const periods = 12; // 12 weeks of retention data

      const cohorts = await analyticsService.getCohortRetention(startDate, periods);

      res.json({
        success: true,
        cohorts: [{
          date: startDate,
          users: cohorts.length > 0 ? cohorts[0].active_users : 0,
          retention: cohorts
        }]
      });
    } catch (error) {
      console.error('Error getting cohort analysis:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get cohort analysis',
        message: error.message
      });
    }
  }
);

/**
 * Get user segments
 * GET /api/v1/analytics/segments
 */
router.get('/segments',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { segment, startDate, endDate } = req.query;

      const users = await analyticsService.segmentUsers({
        segment,
        startDate,
        endDate
      });

      res.json({
        success: true,
        users,
        metrics: {
          totalUsers: users.length,
          segment
        }
      });
    } catch (error) {
      console.error('Error getting user segments:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get user segments',
        message: error.message
      });
    }
  }
);

/**
 * Get session metrics
 * GET /api/v1/analytics/sessions
 */
router.get('/sessions',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { startDate, endDate, userId } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'startDate and endDate are required'
        });
      }

      // Get average session duration
      const averageDuration = await analyticsService.getAverageSessionDuration({
        startDate,
        endDate
      });

      res.json({
        success: true,
        sessions: [], // TODO: Implement session list
        averageDuration,
        bounceRate: 0 // TODO: Calculate bounce rate
      });
    } catch (error) {
      console.error('Error getting session metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get session metrics',
        message: error.message
      });
    }
  }
);

/**
 * Get platform metrics
 * GET /api/v1/analytics/platform
 */
router.get('/platform',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const period = req.query.period || '30d';

      const metrics = await analyticsService.getPlatformMetrics(period);

      res.json({
        success: true,
        totalUsers: parseInt(metrics.total_users || 0),
        payingUsers: parseInt(metrics.paying_users || 0),
        revenue: parseFloat(metrics.revenue || 0),
        growthRate: parseFloat(metrics.growth_rate || 0)
      });
    } catch (error) {
      console.error('Error getting platform metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get platform metrics',
        message: error.message
      });
    }
  }
);

/**
 * Get LLM-powered insights - Three specialized sections
 * GET /api/v1/analytics/insights
 */
router.get('/insights',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { period = '30d' } = req.query;

      console.log(`🔍 Analytics: Generating three-section insights for period ${period}`);

      // Calculate dates based on period
      const days = parseInt(period.replace('d', ''));
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];

      // Gather all data
      const [metrics, funnel, userOpportunities] = await Promise.all([
        analyticsService.getComprehensiveMetrics(period),
        analyticsService.getFunnelData(startDate, endDate),
        analyticsService.getUserOpportunities()
      ]);

      console.log(`📊 Data gathered: ${metrics?.total_users || 0} users, ${userOpportunities?.length || 0} opportunities`);

      // Generate three separate insight sections in parallel
      const [revenueInsights, funnelInsights, productInsights] = await Promise.all([
        openaiService.generateRevenueInsights(metrics, userOpportunities),
        openaiService.generateFunnelInsights(metrics, funnel, userOpportunities),
        openaiService.generateProductInsights(metrics, funnel)
      ]);

      console.log(`✅ Generated insights: Revenue=${revenueInsights.insights.length}, Funnel=${funnelInsights.insights.length}, Product=${productInsights.insights.length}`);

      // Return structured response with three sections
      res.json({
        success: true,
        sections: {
          revenue: revenueInsights,
          funnel: funnelInsights,
          product: productInsights
        },
        userOpportunities, // Keep for reference
        timestamp: new Date()
      });

    } catch (error) {
      console.error('❌ Failed to generate insights:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        sections: {
          revenue: { insights: [], title: "Revenue Opportunities", error: error.message },
          funnel: { insights: [], title: "Sales Funnel & Retention", error: error.message },
          product: { insights: [], title: "Product Opportunities", error: error.message }
        }
      });
    }
  }
);

/**
 * Get comprehensive metrics (referrals, subscriptions, revenue, growth)
 * GET /api/v1/analytics/comprehensive-metrics
 */
router.get('/comprehensive-metrics',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { period = '30d' } = req.query;

      const metrics = await analyticsService.getComprehensiveMetrics(period);

      res.json({
        success: true,
        ...metrics
      });
    } catch (error) {
      console.error('Error getting comprehensive metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get comprehensive metrics',
        message: error.message
      });
    }
  }
);

/**
 * Get active users for user journey analysis
 * GET /api/v1/analytics/active-users
 */
router.get('/active-users',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const result = await db.query(`
        SELECT DISTINCT u.id, u.email, u.first_name, u.last_name
        FROM users u
        INNER JOIN user_activity_events uae ON u.id = uae.user_id
        WHERE uae.timestamp >= NOW() - INTERVAL '30 days'
        ORDER BY u.email
        LIMIT 100
      `);

      res.json({
        success: true,
        users: result.rows
      });
    } catch (error) {
      console.error('Error getting active users:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get active users',
        message: error.message
      });
    }
  }
);

/**
 * Get user opportunities for actionable insights
 * GET /api/v1/analytics/user-opportunities
 */
router.get('/user-opportunities',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const opportunities = await analyticsService.getUserOpportunities();

      res.json({
        success: true,
        opportunities
      });
    } catch (error) {
      console.error('Error getting user opportunities:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get user opportunities',
        message: error.message
      });
    }
  }
);

/**
 * Get clicks over time for usage metrics
 * GET /api/v1/analytics/usage-metrics/clicks-over-time
 */
router.get('/usage-metrics/clicks-over-time',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { startDate, endDate, interval = 'day' } = req.query;

      const start = startDate || new Date(Date.now() - 30*24*60*60*1000).toISOString();
      const end = endDate || new Date().toISOString();

      const data = await analyticsService.getClicksOverTime(start, end, interval);
      res.json({ success: true, data });
    } catch (error) {
      console.error('Failed to get clicks over time:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * Get actions over time for usage metrics
 * GET /api/v1/analytics/usage-metrics/actions-over-time
 */
router.get('/usage-metrics/actions-over-time',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { startDate, endDate, interval = 'hour' } = req.query;

      const start = startDate || new Date(Date.now() - 7*24*60*60*1000).toISOString();
      const end = endDate || new Date().toISOString();

      const data = await analyticsService.getActionsOverTime(start, end, interval);
      res.json({ success: true, data });
    } catch (error) {
      console.error('Failed to get actions over time:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * Get active users over time for usage metrics
 * GET /api/v1/analytics/usage-metrics/active-users-over-time
 */
router.get('/usage-metrics/active-users-over-time',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { startDate, endDate, interval = 'day' } = req.query;

      const start = startDate || new Date(Date.now() - 30*24*60*60*1000).toISOString();
      const end = endDate || new Date().toISOString();

      const data = await analyticsService.getActiveUsersOverTime(start, end, interval);
      res.json({ success: true, data });
    } catch (error) {
      console.error('Failed to get active users over time:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * Get clicks by page for usage metrics
 * GET /api/v1/analytics/usage-metrics/clicks-by-page
 */
router.get('/usage-metrics/clicks-by-page',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      const start = startDate || new Date(Date.now() - 30*24*60*60*1000).toISOString();
      const end = endDate || new Date().toISOString();

      const data = await analyticsService.getClicksByPage(start, end);
      res.json({ success: true, data });
    } catch (error) {
      console.error('Failed to get clicks by page:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * Get revenue over time for revenue section visualization
 * GET /api/v1/analytics/revenue-over-time
 */
router.get('/revenue-over-time',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { startDate, endDate, interval = 'day' } = req.query;

      const start = startDate || new Date(Date.now() - 30*24*60*60*1000).toISOString();
      const end = endDate || new Date().toISOString();

      const data = await analyticsService.getRevenueOverTime(start, end, interval);
      res.json({ success: true, data });
    } catch (error) {
      console.error('Failed to get revenue over time:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * Get engagement metrics (page views, tab switches, topic selection, exports, sessions)
 * GET /api/v1/analytics/engagement-metrics
 */
router.get('/engagement-metrics',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { timeRange = '30d' } = req.query;

      const metrics = await analyticsService.getEngagementMetrics(timeRange);

      res.json({
        success: true,
        metrics
      });
    } catch (error) {
      console.error('Failed to get engagement metrics:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

export default router;
