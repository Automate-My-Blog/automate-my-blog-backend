import axios from 'axios';

/**
 * Grok Tweet Search Service
 * Uses xAI's Grok API to search X/Twitter for real, relevant tweets
 */
export class GrokTweetSearchService {
  constructor() {
    // Trim and remove surrounding quotes if present
    this.apiKey = process.env.XAI_API_KEY?.trim().replace(/^["']|["']$/g, '');
    this.endpoint = 'https://api.x.ai/v1/chat/completions';

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
          model: 'grok-4',  // Updated from 'grok-beta' to current model
          messages: [
            {
              role: 'system',
              content: 'You are a research assistant with real-time access to X/Twitter. You can search for and verify tweets. Only return real tweets that actually exist.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3, // Lower temperature for factual searches
          max_tokens: 1000,
          // Enable Live Search with X/Twitter access
          search_parameters: {
            mode: 'on',  // Force search
            sources: [
              {
                type: 'x'  // Search only X/Twitter
              }
            ],
            max_search_results: 10,
            return_citations: true
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 45000  // Increased from 30s to accommodate multiple searches
        }
      );

      const content = response.data.choices[0].message.content;

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('⚠️ Could not parse Grok response as JSON');
        return [];
      }

      const result = JSON.parse(jsonMatch[0]);
      const tweets = result.tweets || [];

      console.log(`✅ Found ${tweets.length} real tweets from Grok with full data`);

      // Return full tweet objects with all data
      return tweets;

    } catch (error) {
      console.error('❌ Grok tweet search failed:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      // Don't throw - gracefully degrade to no tweets
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
