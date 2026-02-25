import googleTrends from 'google-trends-api';
import db from './database.js';

/**
 * Google Trends Service
 * Provides predictive search intelligence by identifying rising search queries
 * Uses google-trends-api npm package (no API key required)
 */
export class GoogleTrendsService {
  constructor() {
    console.log('📈 Google Trends Service initialized');
  }

  /**
   * Get rising search queries for a keyword (with caching)
   * @param {string} keyword - The keyword to search for
   * @param {string} geo - Geographic region (default: 'US')
   * @param {string} timeframe - Time range (default: '7d' for last 7 days)
   * @param {string} userId - Optional user ID for caching
   * @returns {Promise<Array>} Rising queries data
   */
  async getRisingQueries(keyword, geo = 'US', timeframe = '7d', userId = null) {
    // Check cache first (expires after 6 hours)
    const cached = await this.getCachedData(keyword, geo, timeframe, userId);
    if (cached && cached.rising_queries) {
      console.log(`📦 Cache hit for trending queries: "${keyword}"`);
      return cached.rising_queries;
    }

    try {
      console.log(`📈 Fetching Google Trends for keyword: "${keyword}", geo: ${geo}, timeframe: ${timeframe}`);

      // Fetch from Google Trends API
      const result = await googleTrends.relatedQueries({
        keyword,
        geo,
        category: 0,
        hl: 'en-US'
      });

      const data = JSON.parse(result);

      // Extract rising queries (if available)
      let risingQueries = [];
      if (data.default?.rankedList) {
        const risingList = data.default.rankedList.find(list => list.rankedKeyword?.length > 0);
        if (risingList) {
          risingQueries = risingList.rankedKeyword
            .filter(item => item.query && item.value)
            .map(item => ({
              query: item.query,
              value: item.value,
              formattedValue: item.formattedValue || `${item.value}%`,
              hasData: item.hasData !== false
            }));
        }
      }

      console.log(`✅ Found ${risingQueries.length} rising queries for "${keyword}"`);

      // Cache the result
      await this.cacheData(userId, keyword, geo, timeframe, { rising_queries: risingQueries });

      return risingQueries;
    } catch (error) {
      console.error('❌ Error fetching rising queries:', error.message);
      return [];
    }
  }

  /**
   * Get related topics for a keyword
   * @param {string} keyword - The keyword to search for
   * @param {string} geo - Geographic region (default: 'US')
   * @param {string} userId - Optional user ID for caching
   * @returns {Promise<Array>} Related topics data
   */
  async getRelatedTopics(keyword, geo = 'US', userId = null) {
    const cached = await this.getCachedData(keyword, geo, '30d', userId);
    if (cached && cached.related_topics) {
      console.log(`📦 Cache hit for related topics: "${keyword}"`);
      return cached.related_topics;
    }

    try {
      console.log(`📊 Fetching related topics for: "${keyword}"`);

      const result = await googleTrends.relatedTopics({
        keyword,
        geo,
        category: 0,
        hl: 'en-US'
      });

      const data = JSON.parse(result);

      // Extract related topics
      let relatedTopics = [];
      if (data.default?.rankedList) {
        for (const list of data.default.rankedList) {
          if (list.rankedKeyword?.length > 0) {
            const topics = list.rankedKeyword
              .filter(item => item.topic?.title)
              .map(item => ({
                topic: item.topic.title,
                type: item.topic.type || 'topic',
                value: item.value,
                formattedValue: item.formattedValue || `${item.value}%`
              }));
            relatedTopics.push(...topics);
          }
        }
      }

      console.log(`✅ Found ${relatedTopics.length} related topics for "${keyword}"`);

      await this.cacheData(userId, keyword, geo, '30d', { related_topics: relatedTopics });

      return relatedTopics;
    } catch (error) {
      console.error('❌ Error fetching related topics:', error.message);
      return [];
    }
  }

  /**
   * Get interest over time (trend trajectory)
   * @param {string} keyword - The keyword to search for
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @param {string} geo - Geographic region (default: 'US')
   * @returns {Promise<Array>} Interest over time data
   */
  async getInterestOverTime(keyword, startDate, endDate, geo = 'US') {
    try {
      console.log(`📉 Fetching interest over time for: "${keyword}" from ${startDate} to ${endDate}`);

      const result = await googleTrends.interestOverTime({
        keyword,
        startTime: new Date(startDate),
        endTime: new Date(endDate),
        geo
      });

      const data = JSON.parse(result);

      if (!data.default?.timelineData) {
        console.log(`⚠️ No timeline data for "${keyword}"`);
        return [];
      }

      const timelineData = data.default.timelineData.map(point => ({
        date: point.formattedTime,
        value: point.value?.[0] || 0,
        formattedAxisTime: point.formattedAxisTime
      }));

      console.log(`✅ Got ${timelineData.length} data points for "${keyword}"`);

      return timelineData;
    } catch (error) {
      console.error('❌ Error fetching interest over time:', error.message);
      return [];
    }
  }

  /**
   * Check cache for existing data
   * @param {string} keyword - The keyword
   * @param {string} geo - Geographic region
   * @param {string} timeframe - Time range
   * @param {string} userId - User ID (optional)
   * @returns {Promise<Object|null>} Cached data or null
   */
  async getCachedData(keyword, geo, timeframe, userId = null) {
    try {
      const query = `
        SELECT * FROM google_trends_cache
        WHERE keyword = $1 AND geo = $2 AND timeframe = $3
          AND expires_at > NOW()
          ${userId ? 'AND user_id = $4' : ''}
        ORDER BY fetched_at DESC
        LIMIT 1
      `;

      const params = userId ? [keyword, geo, timeframe, userId] : [keyword, geo, timeframe];
      const result = await db.query(query, params);

      return result.rows[0] || null;
    } catch (error) {
      console.error('❌ Error checking cache:', error.message);
      return null;
    }
  }

  /**
   * Cache fetched data (expires in 6 hours)
   * @param {string} userId - User ID (can be null for system-wide cache)
   * @param {string} keyword - The keyword
   * @param {string} geo - Geographic region
   * @param {string} timeframe - Time range
   * @param {Object} data - Data to cache (rising_queries, related_topics, etc.)
   */
  async cacheData(userId, keyword, geo, timeframe, data) {
    try {
      const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6 hours

      const query = `
        INSERT INTO google_trends_cache
          (user_id, keyword, geo, timeframe, rising_queries, related_topics, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `;

      await db.query(query, [
        userId,
        keyword,
        geo,
        timeframe,
        data.rising_queries ? JSON.stringify(data.rising_queries) : null,
        data.related_topics ? JSON.stringify(data.related_topics) : null,
        expiresAt
      ]);

      console.log(`💾 Cached trends data for "${keyword}"`);
    } catch (error) {
      console.error('❌ Error caching data:', error.message);
      // Don't throw - caching failure shouldn't break the request
    }
  }

  /**
   * Clean up expired cache entries (run periodically)
   */
  async cleanExpiredCache() {
    try {
      const result = await db.query(`
        DELETE FROM google_trends_cache
        WHERE expires_at < NOW()
      `);

      console.log(`🧹 Cleaned up ${result.rowCount} expired cache entries`);
      return result.rowCount;
    } catch (error) {
      console.error('❌ Error cleaning cache:', error.message);
      return 0;
    }
  }
}

const googleTrendsService = new GoogleTrendsService();
export default googleTrendsService;
