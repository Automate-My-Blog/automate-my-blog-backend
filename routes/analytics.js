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
        events: journey,
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
 * Get LLM-powered insights
 * GET /api/v1/analytics/insights
 */
router.get('/insights',
  authService.authMiddleware.bind(authService),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { context = 'comprehensive', period = '30d' } = req.query;

      console.log(`📊 Generating insights for period: ${period}`);

      // Calculate dates based on period
      const days = parseInt(period.replace('d', ''));
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];

      // Get comprehensive data including user opportunities
      const [metrics, funnel, userOpportunities] = await Promise.all([
        analyticsService.getComprehensiveMetrics(period),
        analyticsService.getFunnelData(startDate, endDate),
        analyticsService.getUserOpportunities()
      ]);

      console.log(`📊 Retrieved ${userOpportunities.length} user opportunities`);

      // Generate insights with user context
      const insights = await openaiService.generateAnalyticsInsights({
        metrics,
        funnel,
        cohorts: [],
        sessions: {},
        revenue: {
          total: metrics.total_revenue,
          paying_users: metrics.total_paying_users
        }
      }, userOpportunities);

      res.json({
        success: true,
        insights: insights.insights || [],
        userOpportunities,  // Include for frontend display
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error generating insights:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate insights',
        message: error.message,
        insights: [],
        timestamp: new Date()
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

export default router;
