import express from 'express';
import googleTrendsService from '../services/google-trends.js';
import googleSearchConsoleService from '../services/google-search-console.js';
import googleAnalyticsService from '../services/google-analytics.js';

const router = express.Router();

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
