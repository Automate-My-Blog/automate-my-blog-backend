import axios from 'axios';

/**
 * News Article Search Service
 * Uses NewsAPI.org v2 to find relevant news articles for blog content
 * Requires NEWS_API_KEY (https://newsapi.org - free developer tier available)
 */
export class NewsArticleSearchService {
  constructor() {
    this.apiKey = process.env.NEWS_API_KEY?.trim().replace(/^["']|["']$/g, '');
    this.baseUrl = 'https://newsapi.org/v2';

    if (!this.apiKey) {
      console.warn('⚠️ NEWS_API_KEY not configured - News article search disabled');
    }
  }

  /**
   * Search for relevant news articles by topic
   * @param {Object} params - Search parameters
   * @param {string} params.topic - Search topic (e.g., "remote work productivity")
   * @param {string} params.businessType - Business context
   * @param {string} params.targetAudience - Target audience
   * @param {number} params.maxArticles - Max articles to find (default: 5)
   * @returns {Array<Object>} Array of article objects
   */
  async searchRelevantArticles({
    topic,
    businessType,
    targetAudience,
    maxArticles = 5
  }) {
    if (!this.apiKey) {
      console.log('⚠️ News article search skipped - no API key');
      return [];
    }

    try {
      console.log(`🔍 [NEWS] Searching for articles about: ${topic}`);

      const response = await axios.get(`${this.baseUrl}/everything`, {
        params: {
          q: topic,
          sortBy: 'relevancy',
          pageSize: Math.min(maxArticles, 100),
          language: 'en',
          apiKey: this.apiKey
        },
        headers: { Accept: 'application/json' },
        timeout: 10000
      });

      if (response.data?.status !== 'ok') {
        console.warn('⚠️ [NEWS] API returned non-ok status:', response.data?.message);
        return [];
      }

      const articles = (response.data?.articles || []).map((item) => ({
        url: item.url || '',
        title: item.title || '',
        description: (item.description || '').substring(0, 300),
        sourceName: item.source?.name || '',
        sourceId: item.source?.id || '',
        author: item.author || '',
        publishedAt: item.publishedAt || '',
        urlToImage: item.urlToImage || '',
        content: (item.content || '').substring(0, 200)
      }));

      // Filter out articles without URLs (some sources omit them)
      const validArticles = articles.filter((a) => a.url);

      console.log(`✅ [NEWS] Found ${validArticles.length} articles`);
      return validArticles;
    } catch (error) {
      if (error.response?.status === 401) {
        console.warn('⚠️ [NEWS] Invalid API key');
      } else if (error.response?.status === 426) {
        console.warn('⚠️ [NEWS] Free tier limit reached - upgrade at newsapi.org');
      } else {
        console.error('❌ [NEWS] Article search failed:', error.message);
        if (error.response) {
          console.error('Response:', error.response.status, error.response.data?.message);
        }
      }
      return [];
    }
  }
}

const service = new NewsArticleSearchService();
export default service;
