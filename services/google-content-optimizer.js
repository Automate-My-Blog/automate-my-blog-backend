import db from './database.js';

/**
 * Google Content Optimizer Service
 * Uses cached Google data to inform content strategy and topic selection
 */
export class GoogleContentOptimizer {
  /**
   * Get trending topics for a user's niche
   * @param {string} userId - User ID
   * @param {number} limit - Maximum number of topics to return
   * @returns {Promise<Array>} Trending topics with recommendation reasons
   */
  async getTrendingTopicsForUser(userId, limit = 10) {
    try {
      const query = `
        SELECT DISTINCT ON (gtc.keyword)
          gtc.keyword,
          gtc.rising_queries,
          gtc.related_topics,
          gtc.fetched_at,
          gtc.geo
        FROM google_trends_cache gtc
        WHERE (gtc.user_id = $1 OR gtc.user_id IS NULL)
          AND gtc.expires_at > NOW()
          AND gtc.rising_queries IS NOT NULL
        ORDER BY gtc.keyword, gtc.fetched_at DESC
        LIMIT $2
      `;

      const result = await db.query(query, [userId, limit * 2]); // Fetch more to filter

      // Extract and rank rising queries
      const allQueries = [];
      for (const row of result.rows) {
        const risingQueries = row.rising_queries || [];
        for (const q of risingQueries) {
          allQueries.push({
            query: q.query,
            value: q.value,
            keyword: row.keyword,
            fetchedAt: row.fetched_at,
            geo: row.geo,
            recommendationReason: {
              type: 'trending',
              description: `"${q.query}" is trending with ${q.formattedValue || q.value + '%'} growth`,
              impact: q.value > 1000 ? 'high' : q.value > 500 ? 'medium' : 'low',
              action: 'Create content targeting this keyword before competitors capture the traffic',
              result: 'Capture early search traffic and establish topical authority while interest is rising'
            }
          });
        }
      }

      // Sort by value (trend strength) and return top N
      const topTrending = allQueries
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);

      console.log(`📈 Found ${topTrending.length} trending topics for user ${userId}`);
      return topTrending;
    } catch (error) {
      console.error('❌ Error getting trending topics:', error.message);
      return [];
    }
  }

  /**
   * Get content opportunities from Search Console data
   * Queries with high impressions but low CTR = opportunity to improve
   * @param {string} userId - User ID
   * @param {number} limit - Maximum number of opportunities
   * @returns {Promise<Array>} Content opportunities with recommendation reasons
   */
  async getContentOpportunities(userId, limit = 10) {
    try {
      const query = `
        SELECT
          gsc.top_queries,
          gsc.site_url,
          gsc.fetched_at
        FROM google_search_console_cache gsc
        WHERE gsc.user_id = $1
          AND gsc.expires_at > NOW()
        ORDER BY gsc.fetched_at DESC
        LIMIT 1
      `;

      const result = await db.query(query, [userId]);
      if (!result.rows.length) {
        console.log(`⚠️ No Search Console data found for user ${userId}`);
        return [];
      }

      const queries = result.rows[0].top_queries || [];

      // Find high-impression, low-CTR queries (big opportunity)
      const opportunities = queries
        .filter(q => q.impressions > 100 && q.ctr < 0.05) // >100 impressions, <5% CTR
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, limit)
        .map(q => {
          const potentialClicks = Math.round(q.impressions * 0.05); // 5% CTR target
          const currentClicks = q.clicks;
          const additionalClicks = potentialClicks - currentClicks;

          return {
            query: q.query,
            impressions: q.impressions,
            clicks: q.clicks,
            ctr: q.ctr,
            position: q.position,
            opportunity_score: q.impressions * (0.1 - q.ctr), // Higher = bigger opportunity
            recommendationReason: {
              type: 'search_opportunity',
              description: `"${q.query}" gets ${q.impressions.toLocaleString()} impressions but only ${(q.ctr * 100).toFixed(1)}% CTR at position ${q.position.toFixed(1)}`,
              impact: q.impressions > 1000 ? 'high' : q.impressions > 500 ? 'medium' : 'low',
              action: 'Improve content quality, meta description, and title tag to increase CTR',
              result: `Could gain ~${additionalClicks} additional monthly clicks by improving CTR to 5%`
            }
          };
        });

      console.log(`🔍 Found ${opportunities.length} content opportunities for user ${userId}`);
      return opportunities;
    } catch (error) {
      console.error('❌ Error getting content opportunities:', error.message);
      return [];
    }
  }

  /**
   * Get high-performing content patterns
   * Content that drives conversions and has good rankings
   * @param {string} userId - User ID
   * @param {number} limit - Maximum number of patterns
   * @returns {Promise<Array>} High-performing content with recommendation reasons
   */
  async getHighPerformingPatterns(userId, limit = 5) {
    try {
      const query = `
        SELECT
          bp.id,
          bp.title,
          bp.topic_data,
          cp.ga_conversions,
          cp.ga_pageviews,
          cp.gsc_avg_position,
          cp.gsc_clicks,
          cp.gsc_impressions,
          cp.gsc_ctr,
          cp.performance_score
        FROM content_performance cp
        INNER JOIN blog_posts bp ON cp.blog_post_id = bp.id
        WHERE cp.user_id = $1
          AND cp.performance_score > 60
        ORDER BY cp.performance_score DESC
        LIMIT $2
      `;

      const result = await db.query(query, [userId, limit]);

      const patterns = result.rows.map(row => {
        // Extract keywords from topic_data if available
        const topicData = row.topic_data || {};
        const keywords = topicData.keywords || topicData.seoKeywords || [];

        return {
          ...row,
          keywords,
          search_intent: topicData.searchIntent || topicData.search_intent,
          recommendationReason: {
            type: 'high_converting',
            description: `Similar content drives ${row.ga_conversions} conversions/month with ${row.gsc_clicks} clicks at position ${row.gsc_avg_position?.toFixed(1)}`,
            impact: row.performance_score > 80 ? 'high' : row.performance_score > 60 ? 'medium' : 'low',
            action: 'Create more content following this successful pattern and topic approach',
            result: `Replicate high-converting content strategy (score: ${row.performance_score}/100)`
          }
        };
      });

      console.log(`🔥 Found ${patterns.length} high-performing patterns for user ${userId}`);
      return patterns;
    } catch (error) {
      console.error('❌ Error getting high-performing patterns:', error.message);
      return [];
    }
  }

  /**
   * Enrich content ideas with Google data
   * Adds trending signals and opportunity scores to content calendar items
   * @param {string} userId - User ID
   * @param {Array} contentIdeas - Array of content ideas to enrich
   * @returns {Promise<Array>} Enriched content ideas
   */
  async enrichContentIdeas(userId, contentIdeas) {
    try {
      // Fetch all Google data in parallel
      const [trendingTopics, opportunities, performingPatterns] = await Promise.all([
        this.getTrendingTopicsForUser(userId, 20),
        this.getContentOpportunities(userId, 20),
        this.getHighPerformingPatterns(userId, 10)
      ]);

      // Create lookup maps
      const trendingKeywords = new Map(
        trendingTopics.map(t => [t.query.toLowerCase(), t])
      );
      const opportunityKeywords = new Map(
        opportunities.map(o => [o.query.toLowerCase(), o])
      );

      // Enrich each content idea
      const enrichedIdeas = contentIdeas.map(idea => {
        const keywords = idea.keywords || idea.seo_keywords || [];
        let trendBoost = 0;
        let opportunityBoost = 0;
        let matchedTrend = null;
        let matchedOpportunity = null;

        // Check if any keywords match trending topics or opportunities
        for (const keyword of keywords) {
          const kw = keyword.toLowerCase();

          if (trendingKeywords.has(kw)) {
            const trend = trendingKeywords.get(kw);
            trendBoost += trend.value / 100; // Normalize to 0-10 range
            if (!matchedTrend) matchedTrend = trend;
          }

          if (opportunityKeywords.has(kw)) {
            const opp = opportunityKeywords.get(kw);
            opportunityBoost += opp.opportunity_score;
            if (!matchedOpportunity) matchedOpportunity = opp;
          }
        }

        // Calculate priority score
        const baseScore = idea.search_intent === 'commercial' ? 20 : 10;
        const priorityScore = baseScore + trendBoost + opportunityBoost;

        // Add recommendation reason if we have a match
        let recommendationReason = null;
        if (matchedTrend && matchedTrend.value > matchedOpportunity?.opportunity_score || 0) {
          recommendationReason = matchedTrend.recommendationReason;
        } else if (matchedOpportunity) {
          recommendationReason = matchedOpportunity.recommendationReason;
        }

        return {
          ...idea,
          trendBoost,
          opportunityBoost,
          priorityScore,
          recommendationReason,
          googleEnriched: true
        };
      });

      // Sort by priority score
      const sorted = enrichedIdeas.sort((a, b) => b.priorityScore - a.priorityScore);

      console.log(`✨ Enriched ${contentIdeas.length} content ideas with Google data`);
      return sorted;
    } catch (error) {
      console.error('❌ Error enriching content ideas:', error.message);
      // Return original ideas if enrichment fails
      return contentIdeas;
    }
  }

  /**
   * Get comprehensive Google insights for a user
   * Returns all trending topics, opportunities, and patterns in one call
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Comprehensive insights
   */
  async getComprehensiveInsights(userId) {
    try {
      const [trending, opportunities, patterns] = await Promise.all([
        this.getTrendingTopicsForUser(userId, 10),
        this.getContentOpportunities(userId, 10),
        this.getHighPerformingPatterns(userId, 5)
      ]);

      return {
        trending: {
          count: trending.length,
          items: trending,
          summary: trending.length > 0
            ? `${trending.length} trending topics detected in your niche`
            : 'No trending topics available yet'
        },
        opportunities: {
          count: opportunities.length,
          items: opportunities,
          summary: opportunities.length > 0
            ? `${opportunities.length} search opportunities with high potential`
            : 'No search opportunities available yet'
        },
        patterns: {
          count: patterns.length,
          items: patterns,
          summary: patterns.length > 0
            ? `${patterns.length} high-performing content patterns identified`
            : 'No performance data available yet'
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Error getting comprehensive insights:', error.message);
      return {
        trending: { count: 0, items: [], summary: 'Error fetching trending topics' },
        opportunities: { count: 0, items: [], summary: 'Error fetching opportunities' },
        patterns: { count: 0, items: [], summary: 'Error fetching patterns' },
        error: error.message
      };
    }
  }
}

const googleContentOptimizer = new GoogleContentOptimizer();
export default googleContentOptimizer;
