import axios from 'axios';

/**
 * Grok Tweet Search Service
 * Uses xAI's Agent Tools API with grok-4-1-fast for X/Twitter searches.
 *
 * Updated Jan 2026: Migrated from deprecated Live Search API to Agent Tools.
 *
 * WHY IT CAN BE SLOW (10–30+ seconds):
 * The API is agentic: there is no "raw search with this query" endpoint. Each request runs:
 * 1. Model turn 1: Read our prompt → decide to call x_search → formulate search query → invoke tool.
 * 2. Server-side: x_search runs (xAI → X/Twitter backend); we don't control this latency.
 * 3. Model turn 2: Receive tool results → format final JSON.
 * So we pay for two full model round-trips plus one external search. max_turns: 1 limits to one
 * tool use, but we still need both the "call tool" and "format answer" phases. Shorter prompts
 * and lower max_tokens help a little; the rest is xAI/X backend. Set GROK_DEBUG=1 to log timings.
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

    const debug = process.env.GROK_DEBUG === '1' || process.env.GROK_DEBUG === 'true';
    const startMs = Date.now();

    try {
      console.log(`🔍 Searching for real tweets about: ${topic}`);

      // Calculate date 6 months ago for recent tweets filter
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const fromDate = sixMonthsAgo.toISOString().split('T')[0]; // YYYY-MM-DD format

      // Short prompt to reduce first model turn; model still decides search query and formats JSON
      const prompt = `Find ${maxTweets} popular tweets about: ${topic}. Prefer experts/verified. Return ONLY this JSON, no other text:
{"tweets":[{"url":"https://x.com/handle/status/123","author":"Full Name","handle":"handle","text":"tweet text","likes":0,"retweets":0,"verified":true}]}`;

      const response = await axios.post(
        this.endpoint,
        {
          model: 'grok-4-1-fast',  // Optimized for fast agentic search
          input: [
            {
              role: 'system',
              content: 'You are an X/Twitter search assistant. Use x_search to find real, popular tweets. Return only JSON.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.2,  // Lower for more focused results
          max_tokens: 800,   // Reduced - we just need JSON
          // Agent Tools API with date filter for recent tweets
          tools: [
            {
              type: 'x_search',
              from_date: fromDate  // Last 6 months only
            }
          ],
          max_turns: 1  // Single search iteration for speed
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: Number(process.env.GROK_TWEET_SEARCH_TIMEOUT_MS) || 60000  // 60s default; tune via env once you have average response times
        }
      );

      const elapsedMs = Date.now() - startMs;
      if (debug) {
        console.log('🔍 [GROK DEBUG] Response structure:', {
          hasOutput: !!response.data.output,
          outputLength: response.data.output?.length,
          hasText: !!response.data.text,
          textKeys: response.data.text ? Object.keys(response.data.text) : [],
          outputTypes: response.data.output?.map(o => o.type),
          status: response.data.status,
          allKeys: Object.keys(response.data)
        });
      }
      console.log(`🔍 [GROK] Tweet search completed in ${elapsedMs}ms, status: ${response.data.status ?? 'n/a'}`);

      // Log if status indicates incomplete/error
      if (response.data.status && response.data.status !== 'completed') {
        console.warn('⚠️ [GROK] Non-completed status:', response.data.status);
      }

      // Extract content from Agent Tools API response
      // Structure: output[] contains a 'message' type with content[].text
      let content = null;

      if (response.data.output && Array.isArray(response.data.output)) {
        // Find the message item in the output array
        const messageItem = response.data.output.find(item => item.type === 'message');

        if (messageItem && messageItem.content && Array.isArray(messageItem.content)) {
          // Find the output_text item in the content array
          const outputText = messageItem.content.find(c => c.type === 'output_text');
          if (outputText && outputText.text) {
            content = outputText.text;
            console.log('✅ [GROK] Extracted text from message.content[].text');
          }
        }
      }

      // Fallback: try text field directly (older format)
      if (!content && response.data.text) {
        content = response.data.text.content || response.data.text;
        console.log('✅ [GROK] Extracted text from response.data.text (fallback)');
      }

      const toolCalls = response.data.output?.filter(o => o.type === 'custom_tool_call') || [];
      const citations = response.data.citations || [];

      console.log(`🔧 Grok used ${toolCalls.length} tool calls, status: ${response.data.status}`);

      // Check if content is valid
      if (!content || typeof content !== 'string') {
        console.error('❌ No valid text content in Grok response');
        console.error('📄 Output array detailed:', response.data.output?.map((o, i) => ({
          index: i,
          type: o.type,
          name: o.name,
          allKeys: Object.keys(o),
          hasText: !!o.text,
          hasContent: !!o.content,
          sample: JSON.stringify(o).substring(0, 200)
        })));
        console.error('📄 Text field structure:', {
          textType: typeof response.data.text,
          textKeys: response.data.text ? Object.keys(response.data.text) : [],
          textSample: JSON.stringify(response.data.text).substring(0, 300)
        });
        console.error('💡 Trying to extract from output results...');

        // LAST RESORT: Maybe the results are in the tool call outputs
        const toolResults = response.data.output
          ?.filter(o => o.type === 'custom_tool_call' && o.status === 'completed')
          ?.map(o => o.output || o.result);

        if (toolResults && toolResults.length > 0) {
          console.log('🔍 Found tool results, attempting to use those:', toolResults.length);
          // For now, return empty - we'll see what's in the tool outputs
        }

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
        const timeoutMs = Number(process.env.GROK_TWEET_SEARCH_TIMEOUT_MS) || 60000;
        console.warn(`⏱️ Grok tweet search timed out (${timeoutMs}ms) - continuing without tweets`);
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
   * Get recent tweets from a specific X/Twitter user by handle (for social voice corpus).
   * Uses same Agent Tools + x_search; prompt asks for tweets FROM the user (from:handle).
   * @param {string} handle - Twitter handle with or without @ (e.g. "acme" or "@acme")
   * @param {number} maxTweets - Max tweets to return (default 20)
   * @returns {Promise<Array<{ url: string, author: string, handle: string, text: string, likes?: number, retweets?: number }>>}
   */
  async getRecentTweetsByHandle(handle, maxTweets = 20) {
    if (!this.apiKey) {
      console.log('⚠️ Grok tweet search skipped - no API key');
      return [];
    }
    const cleanHandle = (handle || '').trim().replace(/^@+/, '');
    if (!cleanHandle) return [];

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const fromDate = sixMonthsAgo.toISOString().split('T')[0];

    const prompt = `Use x_search to find the ${Math.min(maxTweets, 25)} most recent tweets FROM the X/Twitter user @${cleanHandle} (query: from:${cleanHandle}). Return ONLY this JSON, no other text:
{"tweets":[{"url":"https://x.com/handle/status/123","author":"Full Name","handle":"handle","text":"tweet text","likes":0,"retweets":0}]}`;

    try {
      const response = await axios.post(
        this.endpoint,
        {
          model: 'grok-4-1-fast',
          input: [
            {
              role: 'system',
              content: 'You are an X/Twitter search assistant. Use x_search with a from:username query to get tweets from that user. Return only JSON.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 4000,
          tools: [{ type: 'x_search', from_date: fromDate }],
          max_turns: 1
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: Number(process.env.GROK_TWEET_SEARCH_TIMEOUT_MS) || 60000
        }
      );

      let content = null;
      if (response.data.output?.length) {
        const messageItem = response.data.output.find((o) => o.type === 'message');
        const outputText = messageItem?.content?.find((c) => c.type === 'output_text');
        if (outputText?.text) content = outputText.text;
      }
      if (!content && response.data.text) {
        content = typeof response.data.text === 'string' ? response.data.text : response.data.text?.content;
      }
      if (!content || typeof content !== 'string') return [];

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];
      const result = JSON.parse(jsonMatch[0]);
      const tweets = result.tweets || [];
      console.log(`✅ [GROK] Fetched ${tweets.length} tweets from @${cleanHandle}`);
      return tweets;
    } catch (error) {
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        console.warn('⏱️ Grok getRecentTweetsByHandle timed out');
      } else {
        console.error('❌ Grok getRecentTweetsByHandle failed:', error.message);
      }
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
