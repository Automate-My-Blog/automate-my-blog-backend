import { google } from 'googleapis';

/**
 * Google Search Console Service
 * Provides SEO attribution and ranking tracking for content performance
 */
export class GoogleSearchConsoleService {
  constructor() {
    // Will use OAuth2 for user-specific data
    this.oauth2Client = null;

    // Service account for app-level queries (if needed)
    this.credentials = process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS
      ? JSON.parse(process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS)
      : null;

    if (!this.credentials) {
      console.warn('⚠️ GOOGLE_SEARCH_CONSOLE_CREDENTIALS not configured - GSC disabled');
    }
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
  }

  /**
   * Get top performing queries for a site
   * @param {string} siteUrl - The site URL (e.g., 'https://example.com')
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {number} limit - Maximum number of queries to return (default: 100)
   * @returns {Promise<Object>} Top queries data
   */
  async getTopQueries(siteUrl, startDate, endDate, limit = 100) {
    if (!this.oauth2Client) {
      return { queries: [], error: 'Not authenticated' };
    }

    try {
      const searchconsole = google.searchconsole({ version: 'v1', auth: this.oauth2Client });

      const response = await searchconsole.searchanalytics.query({
        siteUrl: siteUrl,
        requestBody: {
          startDate: startDate,
          endDate: endDate,
          dimensions: ['query'],
          rowLimit: limit
        }
      });

      return {
        queries: response.data.rows?.map(row => ({
          query: row.keys[0],
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position
        })) || [],
        source: 'google-search-console',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Google Search Console API error:', error.message);
      return { queries: [], error: error.message };
    }
  }

  /**
   * Get performance for specific blog post URL
   * @param {string} siteUrl - The site URL
   * @param {string} pageUrl - The specific page URL to analyze
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Object>} Page performance data
   */
  async getPagePerformance(siteUrl, pageUrl, startDate, endDate) {
    if (!this.oauth2Client) {
      return { data: null, error: 'Not authenticated' };
    }

    try {
      const searchconsole = google.searchconsole({ version: 'v1', auth: this.oauth2Client });

      const response = await searchconsole.searchanalytics.query({
        siteUrl: siteUrl,
        requestBody: {
          startDate: startDate,
          endDate: endDate,
          dimensions: ['page'],
          dimensionFilterGroups: [{
            filters: [{
              dimension: 'page',
              expression: pageUrl
            }]
          }]
        }
      });

      const row = response.data.rows?.[0];
      if (!row) {
        return {
          data: null,
          message: 'No data available for this page',
          source: 'google-search-console'
        };
      }

      return {
        data: {
          pageUrl: row.keys[0],
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position
        },
        source: 'google-search-console',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Google Search Console API error:', error.message);
      return { data: null, error: error.message };
    }
  }

  /**
   * Get queries that led to clicks for a specific page
   * @param {string} siteUrl - The site URL
   * @param {string} pageUrl - The specific page URL
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {number} limit - Maximum number of queries (default: 50)
   * @returns {Promise<Object>} Queries for page
   */
  async getPageQueries(siteUrl, pageUrl, startDate, endDate, limit = 50) {
    if (!this.oauth2Client) {
      return { queries: [], error: 'Not authenticated' };
    }

    try {
      const searchconsole = google.searchconsole({ version: 'v1', auth: this.oauth2Client });

      const response = await searchconsole.searchanalytics.query({
        siteUrl: siteUrl,
        requestBody: {
          startDate: startDate,
          endDate: endDate,
          dimensions: ['query'],
          dimensionFilterGroups: [{
            filters: [{
              dimension: 'page',
              expression: pageUrl
            }]
          }],
          rowLimit: limit
        }
      });

      return {
        queries: response.data.rows?.map(row => ({
          query: row.keys[0],
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position
        })) || [],
        source: 'google-search-console',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Google Search Console API error:', error.message);
      return { queries: [], error: error.message };
    }
  }
}

const googleSearchConsoleService = new GoogleSearchConsoleService();
export default googleSearchConsoleService;
