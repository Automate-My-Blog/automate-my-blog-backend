import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { google } from 'googleapis';

/**
 * Google Analytics Service
 * Provides traffic, engagement, and conversion tracking for content ROI
 */
export class GoogleAnalyticsService {
  constructor() {
    // Will use OAuth2 for user-specific data
    this.oauth2Client = null;
    this.analyticsDataClient = null;
  }

  /**
   * Initialize OAuth2 client for user
   * @param {Object} userTokens - User's OAuth tokens
   */
  async initializeAuth(userTokens) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    this.oauth2Client.setCredentials(userTokens);

    // Initialize GA client with OAuth2
    this.analyticsDataClient = new BetaAnalyticsDataClient({
      auth: this.oauth2Client
    });
  }

  /**
   * Get page performance (pageviews, engagement, conversions)
   * @param {string} propertyId - GA4 Property ID
   * @param {string} pageUrl - The page URL path (e.g., '/blog/my-post')
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Object>} Page performance metrics
   */
  async getPagePerformance(propertyId, pageUrl, startDate, endDate) {
    if (!this.analyticsDataClient) {
      return { data: null, error: 'Not authenticated' };
    }

    try {
      const [response] = await this.analyticsDataClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
          { name: 'conversions' }
        ],
        dimensionFilter: {
          filter: {
            fieldName: 'pagePath',
            stringFilter: { value: pageUrl }
          }
        }
      });

      const row = response.rows?.[0];
      if (!row) {
        return {
          data: null,
          message: 'No data available for this page',
          source: 'google-analytics'
        };
      }

      return {
        pageviews: parseInt(row.metricValues[0]?.value || '0'),
        avgSessionDuration: parseFloat(row.metricValues[1]?.value || '0'),
        bounceRate: parseFloat(row.metricValues[2]?.value || '0'),
        conversions: parseInt(row.metricValues[3]?.value || '0'),
        source: 'google-analytics',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Google Analytics API error:', error.message);
      return { data: null, error: error.message };
    }
  }

  /**
   * Get traffic sources breakdown
   * @param {string} propertyId - GA4 Property ID
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Object>} Traffic sources data
   */
  async getTrafficSources(propertyId, startDate, endDate) {
    if (!this.analyticsDataClient) {
      return { sources: [], error: 'Not authenticated' };
    }

    try {
      const [response] = await this.analyticsDataClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate, endDate }],
        dimensions: [
          { name: 'sessionDefaultChannelGroup' },
          { name: 'sessionSource' }
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'conversions' }
        ]
      });

      return {
        sources: response.rows?.map(row => ({
          channelGroup: row.dimensionValues[0]?.value,
          source: row.dimensionValues[1]?.value,
          sessions: parseInt(row.metricValues[0]?.value || '0'),
          pageviews: parseInt(row.metricValues[1]?.value || '0'),
          conversions: parseInt(row.metricValues[2]?.value || '0')
        })) || [],
        source: 'google-analytics',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Google Analytics API error:', error.message);
      return { sources: [], error: error.message };
    }
  }

  /**
   * Compare trend-informed vs standard content performance
   * @param {string} propertyId - GA4 Property ID
   * @param {string[]} trendInformedUrls - Array of trend-informed post URLs
   * @param {string[]} standardUrls - Array of standard post URLs
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Object>} Performance comparison data
   */
  async compareTrendPerformance(propertyId, trendInformedUrls, standardUrls, startDate, endDate) {
    if (!this.analyticsDataClient) {
      return { comparison: null, error: 'Not authenticated' };
    }

    try {
      // Fetch performance for trend-informed posts
      const trendInformedPromises = trendInformedUrls.map(url =>
        this.getPagePerformance(propertyId, url, startDate, endDate)
      );
      const trendInformedResults = await Promise.all(trendInformedPromises);

      // Fetch performance for standard posts
      const standardPromises = standardUrls.map(url =>
        this.getPagePerformance(propertyId, url, startDate, endDate)
      );
      const standardResults = await Promise.all(standardPromises);

      // Calculate averages
      const avgTrendInformed = this._calculateAverages(trendInformedResults);
      const avgStandard = this._calculateAverages(standardResults);

      // Calculate lift percentages
      const pageviewsLift = ((avgTrendInformed.pageviews - avgStandard.pageviews) / avgStandard.pageviews * 100).toFixed(1);
      const conversionsLift = ((avgTrendInformed.conversions - avgStandard.conversions) / avgStandard.conversions * 100).toFixed(1);

      return {
        comparison: {
          trendInformed: avgTrendInformed,
          standard: avgStandard,
          lift: {
            pageviews: `${pageviewsLift}%`,
            conversions: `${conversionsLift}%`
          }
        },
        source: 'google-analytics',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Google Analytics comparison error:', error.message);
      return { comparison: null, error: error.message };
    }
  }

  /**
   * Helper: Calculate averages from performance results
   * @private
   */
  _calculateAverages(results) {
    const validResults = results.filter(r => r.data !== null);
    if (validResults.length === 0) {
      return { pageviews: 0, avgSessionDuration: 0, bounceRate: 0, conversions: 0 };
    }

    const sum = validResults.reduce((acc, r) => ({
      pageviews: acc.pageviews + r.pageviews,
      avgSessionDuration: acc.avgSessionDuration + r.avgSessionDuration,
      bounceRate: acc.bounceRate + r.bounceRate,
      conversions: acc.conversions + r.conversions
    }), { pageviews: 0, avgSessionDuration: 0, bounceRate: 0, conversions: 0 });

    return {
      pageviews: Math.round(sum.pageviews / validResults.length),
      avgSessionDuration: Math.round(sum.avgSessionDuration / validResults.length),
      bounceRate: (sum.bounceRate / validResults.length).toFixed(2),
      conversions: Math.round(sum.conversions / validResults.length)
    };
  }
}

const googleAnalyticsService = new GoogleAnalyticsService();
export default googleAnalyticsService;
