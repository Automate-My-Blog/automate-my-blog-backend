import axios from 'axios';

/**
 * Grok Tweet Search Service
 * Uses xAI's Agent Tools API with grok-4-1-fast for FAST X/Twitter searches
 *
 * Updated Jan 2026: Migrated from deprecated Live Search API to Agent Tools
 * Benefits: Server-side orchestration, parallel execution, FREE (no cost), faster
 */
export class GrokTweetSearchService {
  constructor() {
    // Trim and remove surrounding quotes if present
    this.apiKey = process.env.XAI_API_KEY?.trim().replace(/^["']|["']$/g, '');
    // NEW: Agent Tools API endpoint (faster, free, server-side orchestration)
    this.endpoint = 'https://api.x.ai/v1/responses';

    if (!this.apiKey) {
      console.warn('⚠️ XAI_API_KEY not configured - Grok tweet search disabled');
    }
  }

  /**
   * Search for real, relevant tweets using Grok's X/Twitter access
   * @param {Object} params - Search parameters
   * @param {string} params.topic - Blog topic (e.g., "postpartum depression treatment")
   * @param {string} params.businessType - Business context
   * @param {string} params.targetAudience - Target audience
   * @param {number} params.maxTweets - Max tweets to find (default: 3-5)
   * @returns {Array<string>} Array of real tweet URLs
   */
  async searchRelevantTweets({ topic, businessType, targetAudience, maxTweets = 5 }) {
    if (!this.apiKey) {
      console.log('⚠️ Grok tweet search skipped - no API key');
      return [];
    }

    try {
      console.log(`🔍 Searching for real tweets about: ${topic}`);

      const prompt = `You are helping create a blog post about "${topic}" for ${businessType} targeting ${targetAudience}.

Search X/Twitter and find ${maxTweets} REAL tweets that would provide authentic social proof for this blog post. Look for:
- Verified experts, doctors, researchers, or professors in this field
- Real patient testimonials from known advocates
- Industry authorities with significant followings
- Recent tweets (within last 6 months if possible)

For each tweet you find, provide:
1. The full X.com URL (e.g., https://x.com/username/status/1234567890)
2. Author's name, username/handle, and credentials
3. The FULL TWEET TEXT (exact content)
4. Engagement stats (likes, retweets) if available
5. Why this tweet is relevant

CRITICAL: Only return tweets that ACTUALLY EXIST on X/Twitter. Do not invent or hallucinate tweets. If you cannot find enough real, relevant tweets, return fewer tweets rather than making them up.

Return your response in this JSON format:
{
  "tweets": [
    {
      "url": "https://x.com/username/status/1234567890",
      "author": "Dr. Jane Smith",
      "handle": "DrJaneSmith",
      "credentials": "Reproductive Psychiatrist at Johns Hopkins",
      "text": "Full exact text of the tweet here...",
      "likes": 1234,
      "retweets": 567,
      "verified": true,
      "relevance": "Discusses early intervention for postpartum mental health"
    }
  ]
}`;

      const response = await axios.post(
        this.endpoint,
        {
          model: 'grok-4-1-fast',  // Optimized for fast agentic search
          input: [
            {
              role: 'system',
              content: 'You are a research assistant with real-time access to X/Twitter. Search for and return ONLY real tweets that actually exist. Use the x_search tool to find relevant tweets.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 1500,
          // NEW: Agent Tools API (server-side orchestration, parallel execution)
          tools: [
            {
              type: 'x_search'  // Let Grok autonomously search X/Twitter
            }
          ],
          max_turns: 2  // Limit reasoning iterations for speed
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000  // 60s max - allow thorough search even if slow
        }
      );

      // NEW: Agent Tools API response format - debug full response
      console.log('🔍 [GROK DEBUG] Full response structure:', {
        hasData: !!response.data,
        dataKeys: response.data ? Object.keys(response.data) : [],
        dataPreview: JSON.stringify(response.data).substring(0, 500)
      });

      // Try multiple possible response formats
      const content = response.data.content
                   || response.data.choices?.[0]?.message?.content
                   || response.data.message?.content
                   || response.data;

      const toolCalls = response.data.tool_calls || [];
      const citations = response.data.citations || [];

      console.log(`🔧 Grok used ${toolCalls.length} tool calls, found ${citations.length} citations`);

      // Check if content is valid
      if (!content || typeof content !== 'string') {
        console.error('❌ No valid content in Grok response:', {
          contentType: typeof content,
          contentValue: content,
          responseKeys: Object.keys(response.data)
        });
        return [];
      }

      // Parse JSON response from content
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('⚠️ Could not parse Grok response as JSON');
        console.warn('📄 Content received:', content.substring(0, 500));
        return [];
      }

      const result = JSON.parse(jsonMatch[0]);
      const tweets = result.tweets || [];

      console.log(`✅ Found ${tweets.length} real tweets from Grok Agent Tools (fast mode)`);

      // Return full tweet objects with all data
      return tweets;

    } catch (error) {
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        console.warn('⏱️ Grok tweet search timed out (60s) - continuing without tweets');
      } else {
        console.error('❌ Grok tweet search failed:', error.message);
        if (error.response) {
          console.error('Response status:', error.response.status);
          console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        }
      }
      // Don't throw - gracefully degrade to no tweets (tweets are optional)
      return [];
    }
  }

  /**
   * Validate that a tweet URL exists before using it
   */
  async validateTweetExists(tweetUrl) {
    try {
      const tweetIdMatch = tweetUrl.match(/status\/(\d+)/);
      if (!tweetIdMatch) return false;

      // Quick check using Twitter Syndication API
      const syndicationUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetIdMatch[1]}`;
      const response = await axios.get(syndicationUrl, { timeout: 5000 });

      return response.status === 200;
    } catch {
      return false;
    }
  }
}

export default new GrokTweetSearchService();
