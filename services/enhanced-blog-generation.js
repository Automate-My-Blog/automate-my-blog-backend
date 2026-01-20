import OpenAI from 'openai';
import db from './database.js';
import visualContentService from './visual-content-generation.js';
import { OpenAIService } from './openai.js';
import grokTweetSearch from './grok-tweet-search.js';

/**
 * Enhanced Blog Generation Service
 * Integrates website analysis data, manual inputs, and visual content generation
 * Targets 95+ SEO scores using comprehensive analysis insights
 */
export class EnhancedBlogGenerationService extends OpenAIService {
  constructor() {
    super();
    this.visualContentService = visualContentService;
    
    // Initialize OpenAI client with proper API key
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Get organization data availability and analysis
   */
  async getOrganizationContext(organizationId) {
    try {
      console.log(`📊 Loading organization context for: ${organizationId}`);
      console.log('📊 [CTA DEBUG] Content Gen: Loading organization context:', { organizationId });

      // Get data availability
      const availabilityResult = await db.query(
        'SELECT data_availability, blog_generation_settings FROM organizations WHERE id = $1',
        [organizationId]
      );

      if (availabilityResult.rows.length === 0) {
        throw new Error('Organization not found');
      }

      const availability = availabilityResult.rows[0].data_availability || {
        has_blog_content: false,
        has_cta_data: false,
        has_internal_links: false,
        completeness_score: 0
      };
      const settings = availabilityResult.rows[0].blog_generation_settings || {};

      console.log('📊 [CTA DEBUG] Content Gen: Data availability check:', {
        organizationId,
        availability: {
          has_blog_content: availability.has_blog_content,
          has_cta_data: availability.has_cta_data,
          has_internal_links: availability.has_internal_links,
          completeness_score: availability.completeness_score
        }
      });

      // Get manual inputs
      const manualInputs = await db.query(
        'SELECT input_type, input_data FROM user_manual_inputs WHERE organization_id = $1 AND validated = TRUE',
        [organizationId]
      );

      const manualData = {};
      manualInputs.rows.forEach(row => {
        manualData[row.input_type] = JSON.parse(row.input_data);
      });

      // Get website analysis data if available
      const websiteData = {};
      
      if (availability.has_blog_content) {
        const contentResult = await db.query(
          'SELECT tone_analysis, style_patterns, brand_voice_keywords FROM content_analysis_results WHERE organization_id = $1 AND is_current = TRUE ORDER BY created_at DESC LIMIT 1',
          [organizationId]
        );
        if (contentResult.rows.length > 0) {
          websiteData.tone_analysis = JSON.parse(contentResult.rows[0].tone_analysis || '{}');
          websiteData.style_patterns = JSON.parse(contentResult.rows[0].style_patterns || '{}');
          websiteData.brand_voice_keywords = JSON.parse(contentResult.rows[0].brand_voice_keywords || '[]');
        }
      }

      console.log('🎯 [CTA DEBUG] Content Gen: Checking if has_cta_data flag is true:', {
        organizationId,
        has_cta_data: availability.has_cta_data
      });

      if (availability.has_cta_data) {
        const ctaResult = await db.query(
          'SELECT cta_text, cta_type, placement, href, context, data_source FROM cta_analysis WHERE organization_id = $1 ORDER BY conversion_potential DESC LIMIT 10',
          [organizationId]
        );
        websiteData.ctas = ctaResult.rows;

        console.log('📊 [CTA DEBUG] Content Gen: CTA query result:', {
          organizationId,
          ctaCount: ctaResult.rows.length,
          ctas: ctaResult.rows.map(cta => ({
            cta_text: cta.cta_text,
            cta_type: cta.cta_type,
            href: cta.href,
            placement: cta.placement,
            data_source: cta.data_source
          }))
        });
      } else {
        console.warn('⚠️ [CTA DEBUG] Content Gen: has_cta_data is FALSE - skipping CTA query:', {
          organizationId,
          availability
        });
      }

      if (availability.has_internal_links) {
        const linkResult = await db.query(
          'SELECT target_url, anchor_text, link_type FROM internal_linking_analysis WHERE organization_id = $1 ORDER BY seo_value DESC LIMIT 15',
          [organizationId]
        );
        websiteData.internal_links = linkResult.rows;
      }

      console.log('✅ [CTA DEBUG] Content Gen: Organization context loaded:', {
        organizationId,
        hasWebsiteData: Object.keys(websiteData).length > 0,
        websiteDataCTACount: websiteData?.ctas?.length || 0,
        websiteDataCTAs: websiteData?.ctas || [],
        completenessScore: availability.completeness_score || 0
      });

      return {
        availability,
        settings,
        manualData,
        websiteData,
        hasManualFallbacks: Object.keys(manualData).length > 0,
        hasWebsiteData: Object.keys(websiteData).length > 0,
        completenessScore: availability.completeness_score || 0
      };

    } catch (error) {
      console.error('Error loading organization context:', error);
      throw error;
    }
  }

  /**
   * Get highlight box types used in previous post to avoid repetition
   */
  async getPreviousPostHighlightBoxTypes(organizationId) {
    try {
      console.log(`📊 Retrieving previous post highlight box types for organization: ${organizationId}`);

      // Query database for most recent blog post by this organization
      // blog_posts doesn't have organization_id, so we JOIN with projects
      const query = `
        SELECT bp.content
        FROM blog_posts bp
        INNER JOIN projects p ON bp.project_id = p.id
        WHERE p.organization_id = $1
        ORDER BY bp.created_at DESC
        LIMIT 1
      `;

      const result = await db.query(query, [organizationId]);

      if (!result.rows || result.rows.length === 0) {
        console.log('📊 No previous posts found - this is the first post');
        return []; // No previous posts
      }

      const previousContent = result.rows[0].content;

      // Extract all highlight box types from content using regex
      const highlightBoxRegex = /data-highlight-type="(\w+)"/g;
      const boxTypes = new Set();
      let match;

      while ((match = highlightBoxRegex.exec(previousContent)) !== null) {
        boxTypes.add(match[1]);
      }

      const typesArray = Array.from(boxTypes);
      console.log(`✅ Found ${typesArray.length} highlight box types in previous post:`, typesArray);

      return typesArray;
    } catch (error) {
      console.error('Error retrieving previous highlight box types:', error);
      return []; // Fail gracefully
    }
  }

  /**
   * Build QuickChart configuration from structured chart data
   */
  buildChartConfig(chartData) {
    const { type, title, labels, values } = chartData;

    // Color palettes for different chart types
    const colors = ['#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2'];

    switch (type.toLowerCase()) {
      case 'bar':
        return {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [{
              data: values,
              backgroundColor: colors[0]
            }]
          },
          options: {
            title: { display: true, text: title },
            legend: { display: false }
          }
        };

      case 'pie':
        return {
          type: 'pie',
          data: {
            labels: labels,
            datasets: [{
              data: values,
              backgroundColor: colors.slice(0, labels.length)
            }]
          },
          options: {
            title: { display: true, text: title },
            plugins: {
              datalabels: {
                formatter: (val) => val + '%'
              }
            }
          }
        };

      case 'line':
        return {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              data: values,
              borderColor: colors[0],
              fill: false,
              tension: 0.1
            }]
          },
          options: {
            title: { display: true, text: title },
            legend: { display: false }
          }
        };

      default:
        // Fallback to bar chart
        return {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [{ data: values, backgroundColor: colors[0] }]
          },
          options: {
            title: { display: true, text: title }
          }
        };
    }
  }

  /**
   * Process image placeholders and replace with generated images
   * Supports two formats:
   * 1. ![IMAGE:type:description] - for photos/illustrations
   * 2. ![CHART:type|title|labels|values] - for structured chart data
   */
  async processImagePlaceholders(content, topic, organizationId) {
    try {
      console.log('🎨 Processing image placeholders in content...');

      const placeholders = [];

      // Extract IMAGE placeholders: ![IMAGE:type:description]
      const imageRegex = /!\[IMAGE:(\w+):(.*?)\]/g;
      let match;
      while ((match = imageRegex.exec(content)) !== null) {
        placeholders.push({
          fullMatch: match[0],
          format: 'IMAGE',
          type: match[1],
          description: match[2],
          chartData: null
        });
      }

      // Extract CHART placeholders: ![CHART:type|title|labels|values]
      const chartRegex = /!\[CHART:(\w+)\|(.*?)\|(.*?)\|(.*?)\]/g;
      while ((match = chartRegex.exec(content)) !== null) {
        const chartType = match[1];
        const title = match[2];
        const labels = match[3].split(',').map(l => l.trim());
        const values = match[4].split(',').map(v => parseFloat(v.trim()));

        placeholders.push({
          fullMatch: match[0],
          format: 'CHART',
          type: 'chart',
          description: `${chartType} chart: ${title}`,
          chartData: {
            type: chartType,
            title: title,
            labels: labels,
            values: values
          }
        });
      }

      if (placeholders.length === 0) {
        console.log('📊 No image placeholders found in content');
        return content;
      }

      console.log(`📊 Found ${placeholders.length} placeholders to process:`, {
        imageCount: placeholders.filter(p => p.format === 'IMAGE').length,
        chartCount: placeholders.filter(p => p.format === 'CHART').length
      });

      // For async generation, prioritize critical images to avoid timeout
      // Only generate hero_image and charts, skip other images
      const criticalTypes = ['hero_image', 'chart'];
      const filteredPlaceholders = placeholders.filter(p =>
        p.format === 'CHART' || criticalTypes.includes(p.type)
      );

      if (filteredPlaceholders.length < placeholders.length) {
        console.log(`⚡ Optimizing for async: generating ${filteredPlaceholders.length}/${placeholders.length} critical images (hero + charts only)`);
      }

      // Get brand guidelines if available
      const brandResult = await db.query(
        'SELECT input_data FROM user_manual_inputs WHERE organization_id = $1 AND input_type = $2 AND validated = TRUE',
        [organizationId, 'brand_colors']
      );

      let brandGuidelines = {};
      if (brandResult.rows.length > 0) {
        brandGuidelines = JSON.parse(brandResult.rows[0].input_data);
      }

      // Generate images for critical placeholders only (to avoid timeout)
      const imagePromises = filteredPlaceholders.map(async (placeholder, index) => {
        try {
          console.log(`🎨 Generating ${placeholder.format} ${index + 1}/${placeholders.length}: ${placeholder.type}`);

          // Build options object with chartData if it's a CHART placeholder
          const options = {
            organizationId: organizationId,
            prompt: placeholder.description,
            contentType: placeholder.type,
            brandGuidelines: brandGuidelines
          };

          // For CHART format, pass structured chart configuration
          if (placeholder.format === 'CHART' && placeholder.chartData) {
            console.log(`📊 Generating chart with data:`, placeholder.chartData);
            options.chartConfig = this.buildChartConfig(placeholder.chartData);
            options.servicePreference = 'quickchart'; // Force QuickChart for charts
          }

          // Add timeout to prevent hanging - 30 seconds per image max
          const imageResult = await Promise.race([
            this.visualContentService.generateVisualContent(options),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Image generation timeout (30s)')), 30000)
            )
          ]);

          // Check if generation succeeded
          if (imageResult.success && imageResult.data?.imageUrl) {
            return {
              placeholder: placeholder.fullMatch,
              imageUrl: imageResult.data.imageUrl,
              altText: placeholder.chartData
                ? `${placeholder.chartData.title} chart`
                : placeholder.description.substring(0, 100)
            };
          } else {
            return null;
          }
        } catch (error) {
          console.error(`❌ Failed to generate ${placeholder.format} for placeholder:`, error.message);
          return null;
        }
      });

      const generatedImages = await Promise.all(imagePromises);

      // Replace placeholders with markdown image syntax, or remove if failed
      let processedContent = content;
      let replacedCount = 0;
      let removedCount = 0;

      generatedImages.forEach((image, index) => {
        const placeholder = filteredPlaceholders[index];
        const placeholderType = placeholder.type;

        if (image && image.imageUrl) {
          const markdownImage = `![${image.altText}](${image.imageUrl})`;
          processedContent = processedContent.replace(image.placeholder, markdownImage);
          replacedCount++;
          console.log(`✅ Inserted ${placeholderType} image: ${image.imageUrl.substring(0, 60)}...`);
        } else {
          // For hero_image: use topic preview image as fallback
          if (placeholderType === 'hero_image' && topic.image) {
            const fallbackImage = `![${topic.title || 'Hero image'}](${topic.image})`;
            processedContent = processedContent.replace(placeholder.fullMatch, fallbackImage);
            replacedCount++;
            console.log(`♻️ Used topic preview image as hero_image fallback`);
          } else {
            // For other types: remove failed placeholder to avoid showing raw markdown
            processedContent = processedContent.replace(placeholder.fullMatch, '');
            removedCount++;
            console.log(`⚠️ Removed failed ${placeholderType} placeholder (generation failed)`);
          }
        }
      });

      console.log(`✅ Image processing complete: ${replacedCount}/${placeholders.length} images generated, ${removedCount} placeholders removed`);
      return processedContent;

    } catch (error) {
      console.error('❌ Error processing image placeholders:', error);
      // Return original content if image processing fails
      return content;
    }
  }

  /**
   * Fetch tweet data from Twitter API
   * Uses Syndication API (no auth) with fallback to oEmbed
   */
  async fetchTweetData(tweetUrl) {
    try {
      // Extract tweet ID from URL
      const tweetIdMatch = tweetUrl.match(/status\/(\d+)/);
      if (!tweetIdMatch) {
        console.warn('⚠️ Could not extract tweet ID from URL:', tweetUrl);
        return null;
      }
      const tweetId = tweetIdMatch[1];

      console.log(`🔍 Fetching tweet data for ID: ${tweetId}`);

      // Try Syndication API first (no auth required, free)
      const syndicationUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}`;
      const response = await fetch(syndicationUrl);

      if (!response.ok) {
        console.warn(`⚠️ Syndication API failed (${response.status}), trying oEmbed fallback...`);

        // Fallback to oEmbed API
        const oEmbedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}`;
        const oEmbedResponse = await fetch(oEmbedUrl);

        if (!oEmbedResponse.ok) {
          console.error(`❌ oEmbed API also failed (${oEmbedResponse.status})`);
          return null;
        }

        const oEmbedData = await oEmbedResponse.json();

        // Parse oEmbed HTML to extract basic data
        return {
          id: tweetId,
          text: oEmbedData.html.replace(/<[^>]*>/g, '').substring(0, 280), // Strip HTML, truncate
          author_name: oEmbedData.author_name,
          author_handle: oEmbedData.author_url?.split('/').pop() || 'unknown',
          author_avatar: `https://unavatar.io/twitter/${oEmbedData.author_url?.split('/').pop()}`,
          author_verified: false, // Can't determine from oEmbed
          created_at: new Date().toISOString(),
          likes: 0,
          retweets: 0,
          url: tweetUrl
        };
      }

      const data = await response.json();

      // Transform syndication data to our schema
      return {
        id: tweetId,
        text: data.text,
        author_name: data.user.name,
        author_handle: data.user.screen_name,
        author_avatar: data.user.profile_image_url_https,
        author_verified: data.user.verified || false,
        created_at: data.created_at,
        likes: data.favorite_count || 0,
        retweets: data.retweet_count || 0,
        url: tweetUrl
      };

    } catch (error) {
      console.error('❌ Error fetching tweet data:', error.message);
      return null;
    }
  }

  /**
   * Generate HTML for rich tweet card
   */
  generateTweetCardHTML(tweet) {
    // Prepare tweet data for TipTap custom node
    const tweetId = tweet.id || '0';
    const authorName = tweet.author_name || 'Unknown';
    // Remove @ prefix from handle if present to avoid @@
    const rawHandle = (tweet.author_handle || 'unknown').replace(/^@+/, '');
    const authorHandle = rawHandle;
    const authorAvatar = tweet.author_avatar || `https://unavatar.io/twitter/${rawHandle}`;
    const tweetUrl = tweet.url || '#';
    const tweetText = tweet.text || '';
    const createdAt = this.formatDate(tweet.created_at);
    const likes = this.formatNumber(tweet.likes || 0);
    const retweets = this.formatNumber(tweet.retweets || 0);
    const verified = tweet.author_verified ? 'true' : 'false';

    // Generate simple div with data attributes for TipTap to parse
    // The TweetCard extension will render the actual styled component
    return `<div class="tweet-card" data-author-name="${this.escapeHtml(authorName)}" data-author-handle="${this.escapeHtml(authorHandle)}" data-author-avatar="${this.escapeHtml(authorAvatar)}" data-tweet-text="${this.escapeHtml(tweetText)}" data-tweet-url="${this.escapeHtml(tweetUrl)}" data-created-at="${this.escapeHtml(createdAt)}" data-likes="${this.escapeHtml(likes)}" data-retweets="${this.escapeHtml(retweets)}" data-verified="${verified}"></div>`;
  }

  /**
   * Format tweet text for display (just escape, no linkification)
   * The tweet card itself provides the Twitter-like styling
   */
  linkifyTweetText(text) {
    // Just escape HTML entities - keep text simple and readable
    return this.escapeHtml(text);
  }

  /**
   * Decode HTML entities to prevent double-escaping
   */
  decodeHtmlEntities(text) {
    if (!text) return text;

    const entities = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#039;': "'",
      '&#x27;': "'",
      '&apos;': "'"
    };

    return text.replace(/&(?:amp|lt|gt|quot|#039|#x27|apos);/g, m => entities[m] || m);
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    if (!text) return text;

    // First decode any existing HTML entities to prevent double-escaping
    const decoded = this.decodeHtmlEntities(text);

    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return decoded.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Format large numbers (1234 -> 1.2K)
   */
  formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  /**
   * Format date to readable string
   */
  formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  /**
   * Search for real tweets using Grok before content generation
   * @param {Object} topic - Blog topic object
   * @param {Object} businessInfo - Business information
   * @returns {Array<string>} Array of real tweet URLs
   */
  async searchForRealTweets(topic, businessInfo) {
    try {
      console.log('🔍 [TWEET SEARCH] Calling Grok to find real tweets...');

      const tweetUrls = await grokTweetSearch.searchRelevantTweets({
        topic: topic.title || topic.headline,
        businessType: businessInfo.businessType || 'Business',
        targetAudience: businessInfo.targetAudience || 'General audience',
        maxTweets: 5 // Find 5, OpenAI will choose 1-2 best ones
      });

      if (tweetUrls.length === 0) {
        console.log('⚠️ [TWEET SEARCH] No real tweets found - posts will be generated without tweets');
        return [];
      }

      // Optional: Validate tweets exist before passing to OpenAI
      const validatedTweets = [];
      for (const url of tweetUrls) {
        const exists = await grokTweetSearch.validateTweetExists(url);
        if (exists) {
          validatedTweets.push(url);
        } else {
          console.warn(`⚠️ Tweet validation failed: ${url}`);
        }
      }

      console.log(`✅ [TWEET SEARCH] Validated ${validatedTweets.length}/${tweetUrls.length} tweets`);
      return validatedTweets;

    } catch (error) {
      console.error('❌ [TWEET SEARCH] Error:', error.message);
      return []; // Gracefully degrade
    }
  }

  /**
   * Analyze generated blog post and extract 3-5 search queries
   * that would find tweets supporting the narrative
   * @param {string} content - Generated blog post content
   * @param {Object} topic - Blog topic information
   * @param {Object} businessInfo - Business information
   * @returns {Array<string>} Array of search queries
   */
  async extractTweetSearchQueries(content, topic, businessInfo) {
    console.log('🔍 [TWEET SEARCH] Analyzing post to extract search queries...');

    const prompt = `You are analyzing a blog post to find tweets that would support its narrative.

BLOG POST CONTENT:
${content.substring(0, 3000)}

BLOG TOPIC: ${topic.title}
BUSINESS: ${businessInfo.businessType}
TARGET AUDIENCE: ${businessInfo.targetAudience}

Extract THE SINGLE MOST SEARCHABLE query (2-4 words MAX) to find authoritative tweets.

CRITICAL RULES:
1. MAXIMUM 4 words, preferably 2-3 words
2. Use ONLY concrete, specific terms
3. NO abstract concepts (avoid: impact, hidden, paradox, transformation, revolution, etc.)
4. Focus on the core topic + action/solution

Return ONLY a JSON array with 1 query:
["query"]

GOOD examples (across industries):
- "remote work productivity"
- "cloud security best practices"
- "customer retention strategies"
- "sustainable manufacturing"

BAD examples (TOO LONG/ABSTRACT):
- "hidden impact of remote work transformation" ❌
- "revolutionary approach to security" ❌
- "paradox of customer engagement" ❌

Keep it simple, specific, and searchable.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini', // Use faster/cheaper model for analysis
        messages: [
          {
            role: 'system',
            content: 'You extract search queries from blog posts. Return only valid JSON arrays.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 200
      });

      const queriesText = response.choices[0].message.content;
      const jsonMatch = queriesText.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        console.warn('⚠️ Could not parse search queries, using fallback');
        return [topic.title]; // Fallback to title
      }

      const queries = JSON.parse(jsonMatch[0]);
      console.log(`✅ [TWEET SEARCH] Extracted ${queries.length} search queries:`, queries);

      return queries;
    } catch (error) {
      console.error('❌ [TWEET SEARCH] Query extraction failed:', error.message);
      return [topic.title]; // Fallback to title
    }
  }

  /**
   * Search Grok with multiple queries and combine results
   * @param {Array<string>} searchQueries - Array of search queries
   * @returns {Array<Object>} Array of unique tweet objects with full data
   */
  async searchForTweetsWithMultipleQueries(searchQueries) {
    // CRITICAL: Limit to 1 query max to avoid Vercel timeout (60s limit)
    const limitedQueries = searchQueries.slice(0, 1);

    if (searchQueries.length > 1) {
      console.warn(`⚠️ [TWEET SEARCH] Limiting from ${searchQueries.length} to 1 query to avoid timeout`);
    }

    console.log(`🔍 [TWEET SEARCH] Searching with ${limitedQueries.length} query...`);

    const allTweets = [];
    const seenUrls = new Set();

    for (const query of limitedQueries) {
      try {
        console.log(`🔍 [TWEET SEARCH] Searching: "${query}"`);

        const tweets = await grokTweetSearch.searchRelevantTweets({
          topic: query,
          businessType: 'Healthcare', // Generic since we have specific query
          targetAudience: 'General',
          maxTweets: 3 // Get 3 tweets from the single query
        });

        // Dedupe tweets by URL
        for (const tweet of tweets) {
          if (!seenUrls.has(tweet.url)) {
            seenUrls.add(tweet.url);
            allTweets.push(tweet);
          }
        }

        console.log(`✅ Found ${tweets.length} tweets (${allTweets.length} total unique)`);

      } catch (error) {
        console.warn(`⚠️ Search failed for "${query}":`, error.message);
        // Continue with other queries
      }
    }

    console.log(`🐦 [TWEET SEARCH] Total unique tweets found: ${allTweets.length}`);
    return allTweets;
  }

  /**
   * Use OpenAI to select which tweets best support the blog narrative
   * @param {string} content - Generated blog post content
   * @param {Array<Object>} tweets - Array of available tweet objects with full data
   * @param {Object} businessInfo - Business information
   * @returns {Array<Object>} Array of selected tweet objects
   */
  async selectNarrativeSupportingTweets(content, tweets, businessInfo) {
    if (tweets.length === 0) {
      console.log('⚠️ [TWEET SEARCH] No tweets to select from');
      return [];
    }

    console.log(`🎯 [TWEET SEARCH] Selecting best tweets from ${tweets.length} candidates...`);

    const prompt = `You are selecting tweets to support a blog post's narrative.

BLOG POST EXCERPT (key points):
${content.substring(0, 2000)}

AVAILABLE TWEETS:
${tweets.map((t, i) => `${i + 1}. ${t.url}
   Author: ${t.author} (@${t.handle}) - ${t.credentials || 'No credentials listed'}
   Text: "${t.text || 'No text available'}"
   Engagement: ${t.likes || 0} likes, ${t.retweets || 0} retweets`).join('\n\n')}

BUSINESS CONTEXT:
- Type: ${businessInfo.businessType}
- Target Audience: ${businessInfo.targetAudience}
- Brand Voice: ${businessInfo.brandVoice || 'Professional and authoritative'}

Select 2-4 tweets that:
1. Are authoritative (from experts, researchers, healthcare professionals)
2. Directly support specific claims or points made in the blog post
3. Add credibility to the narrative
4. Match the brand's voice and target audience

Return ONLY a JSON array of the selected tweet URLs:
["https://x.com/...", "https://x.com/..."]

If none of the tweets are suitable, return an empty array: []`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You select authoritative tweets that support blog narratives. Return only valid JSON arrays of URLs.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 300
      });

      const selectedText = response.choices[0].message.content;
      const jsonMatch = selectedText.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        console.warn('⚠️ Could not parse selected tweets');
        return [];
      }

      const selectedUrls = JSON.parse(jsonMatch[0]);

      // Map URLs back to full tweet objects
      const selectedTweets = selectedUrls
        .map(url => tweets.find(t => t.url === url))
        .filter(t => t); // Remove any nulls

      console.log(`✅ [TWEET SEARCH] Selected ${selectedTweets.length} tweets to include`);

      return selectedTweets;
    } catch (error) {
      console.error('❌ [TWEET SEARCH] Tweet selection failed:', error.message);
      return [];
    }
  }

  /**
   * Insert selected tweets into the content at appropriate positions
   * Uses OpenAI to determine WHERE to place each tweet
   * @param {string} content - Generated blog post content
   * @param {Array<Object>} selectedTweets - Array of selected tweet objects with full data
   * @returns {string} Enriched content with tweet placeholders (with embedded data)
   */
  async enrichContentWithTweets(content, selectedTweets) {
    if (selectedTweets.length === 0) {
      console.log('ℹ️ [TWEET SEARCH] No tweets to insert');
      return content;
    }

    console.log(`📝 [TWEET ENRICHMENT] Inserting ${selectedTweets.length} tweets into content...`);

    // Create placeholders with embedded tweet data (base64 encoded)
    const tweetPlaceholders = selectedTweets.map(tweet => {
      const encodedData = Buffer.from(JSON.stringify(tweet)).toString('base64');
      return `![TWEET:${tweet.url}::DATA::${encodedData}]`;
    });

    const prompt = `You are enriching a blog post by inserting tweets with explanatory context.

BLOG POST:
${content}

TWEETS TO INSERT:
${selectedTweets.map((tweet, i) => `${i + 1}. From ${tweet.author} (@${tweet.handle}) - ${tweet.credentials || 'Healthcare professional'}
   Tweet: "${tweet.text}"
   Placeholder: ${tweetPlaceholders[i]}`).join('\n\n')}

INSTRUCTIONS:
For EACH tweet, you must:
1. Write 2-3 sentences BEFORE the placeholder explaining:
   - Why this expert's perspective matters
   - How it supports the preceding claim or statistic
   - Their credentials and authority

2. Insert the exact placeholder: ${tweetPlaceholders[0]} (use the provided placeholder exactly)

3. Optionally add 1 sentence AFTER connecting to the next section

EXAMPLE:
"This approach is supported by leading experts in the field. Dr. Jane Smith, a reproductive psychiatrist at Johns Hopkins, has extensively researched early intervention strategies and their impact on maternal mental health outcomes.

![TWEET:https://x.com/DrJane/status/123::DATA::abc123...]

Her research aligns with the clinical guidelines we'll explore next..."

Return the FULL blog post with explanatory text and tweet placeholders inserted. Keep ALL original content.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o', // Use main model for content editing
        messages: [
          {
            role: 'system',
            content: 'You insert tweets with explanatory context into blog posts. Preserve all original content and use exact placeholders provided.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3
      });

      const enrichedContent = response.choices[0].message.content;
      console.log(`✅ [TWEET ENRICHMENT] Content enriched with ${selectedTweets.length} tweets and explanatory context`);

      return enrichedContent;
    } catch (error) {
      console.error('❌ [TWEET ENRICHMENT] Enrichment failed:', error.message);
      return content; // Return original content if enrichment fails
    }
  }

  /**
   * Process tweet placeholders and replace with styled embed HTML
   * Format: ![TWEET:url] or ![TWEET:url::DATA::base64data]
   */
  async processTweetPlaceholders(content) {
    try {
      console.log('🐦 Processing tweet placeholders in content...');

      // Match both old format (just URL) and new format (URL::DATA::base64)
      const tweetRegex = /!\[TWEET:(https?:\/\/[^\]]+?)(?:::DATA::([^\]]+))?\]/g;
      const matches = [...content.matchAll(tweetRegex)];

      if (matches.length === 0) {
        console.log('📊 No tweet placeholders found in content');
        return content;
      }

      console.log(`🐦 Found ${matches.length} tweet placeholders to process`);

      let processedContent = content;
      let replacedCount = 0;
      let failedCount = 0;
      let embeddedCount = 0;

      // Process tweets sequentially with delay to avoid rate limiting
      for (const match of matches) {
        const placeholder = match[0];
        const tweetUrl = match[1];
        const base64Data = match[2]; // May be undefined for old format

        let tweetData = null;

        // Try to extract embedded data first
        if (base64Data) {
          try {
            tweetData = JSON.parse(Buffer.from(base64Data, 'base64').toString());
            console.log(`✅ Using embedded tweet data: ${tweetUrl}`);
            embeddedCount++;

            // Transform Grok data format to match expected format
            if (!tweetData.author_name) {
              tweetData = {
                id: tweetUrl.match(/status\/(\d+)/)?.[1] || '0',
                text: tweetData.text || '',
                author_name: tweetData.author || 'Unknown',
                author_handle: tweetData.handle || 'unknown',
                author_avatar: `https://unavatar.io/twitter/${tweetData.handle}`,
                author_verified: tweetData.verified || false,
                created_at: new Date().toISOString(),
                likes: tweetData.likes || 0,
                retweets: tweetData.retweets || 0,
                url: tweetUrl
              };
            }
          } catch (e) {
            console.warn(`⚠️ Failed to decode embedded data, fetching from API...`);
            tweetData = null;
          }
        }

        // Fallback to fetching if no embedded data or decode failed
        if (!tweetData) {
          tweetData = await this.fetchTweetData(tweetUrl);
        }

        if (tweetData) {
          // Generate rich tweet card with fetched data
          const tweetCard = this.generateTweetCardHTML(tweetData);
          processedContent = processedContent.replace(placeholder, tweetCard);
          replacedCount++;
          console.log(`✅ Generated rich tweet card: ${tweetUrl}`);
        } else {
          // Fallback to simple styled link if API fails
          const fallbackEmbed = `<blockquote class="tweet-embed tweet-fallback" style="border-left: 4px solid #1DA1F2; padding: 16px 20px; margin: 24px 0; background: #f8f9fa; border-radius: 8px;">
  <p style="margin: 0 0 12px 0; font-style: italic; color: #14171a;">View this expert perspective on X (formerly Twitter)</p>
  <a href="${tweetUrl}" target="_blank" rel="noopener noreferrer" style="color: #1DA1F2; text-decoration: none; font-weight: 600;">→ Read the full tweet</a>
</blockquote>`;
          processedContent = processedContent.replace(placeholder, fallbackEmbed);
          failedCount++;
          console.log(`⚠️ Using fallback embed for: ${tweetUrl}`);
        }

        // Rate limit protection: 1 second delay between requests (only if fetching)
        if (!base64Data && matches.indexOf(match) < matches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log(`✅ Tweet processing complete: ${replacedCount} rich cards (${embeddedCount} from embedded data), ${failedCount} fallbacks (${replacedCount + failedCount}/${matches.length} total)`);
      return processedContent;

    } catch (error) {
      console.error('❌ Error processing tweet placeholders:', error);
      // Return original content if tweet processing fails
      return content;
    }
  }

  /**
   * Clean up formatting issues in generated content
   */
  cleanupFormatting(content) {
    if (!content || typeof content !== 'string') {
      return content;
    }

    return content
      // Remove excessive line breaks (3+ consecutive newlines → 2)
      .replace(/\n{3,}/g, '\n\n')

      // Remove standalone bullet points with no content
      .replace(/^\s*[-*]\s*$/gm, '')

      // Remove trailing whitespace from lines
      .replace(/[ \t]+$/gm, '')

      // Normalize list formatting (ensure single space after bullets)
      .replace(/^(\s*[-*])\s+/gm, '$1 ')

      // Remove excessive spaces between words
      .replace(/  +/g, ' ')

      .trim();
  }

  /**
   * Build enhanced generation prompt with all available data
   */
  buildEnhancedPrompt(topic, businessInfo, organizationContext, additionalInstructions = '', previousBoxTypes = [], realTweetUrls = []) {
    const { availability, settings, manualData, websiteData, completenessScore } = organizationContext;

    // Build context sections based on available data
    let contextSections = [];

    // Brand voice and tone
    let brandContext = '';
    if (websiteData.tone_analysis) {
      brandContext = `BRAND VOICE (from website analysis): ${JSON.stringify(websiteData.tone_analysis)}`;
    } else if (manualData.brand_voice) {
      brandContext = `BRAND VOICE (manual input): ${JSON.stringify(manualData.brand_voice)}`;
    } else {
      brandContext = `BRAND VOICE: Professional ${businessInfo.businessType} voice, ${businessInfo.brandVoice}`;
    }
    contextSections.push(brandContext);

    // Internal linking context with real pages
    if (websiteData.internal_links && websiteData.internal_links.length > 0) {
      const linkContext = `INTERNAL LINKS (real pages from your website):

${websiteData.internal_links.map((link, i) =>
  `${i + 1}. ${link.anchor_text} → ${link.target_url}
   Content type: ${link.link_type}`
).join('\n')}

INTERNAL LINKING INSTRUCTIONS:
- Use these links when referencing your own services, content, or company information
- ONLY link to pages from the list above - do not create placeholder internal links
- Link naturally within the content flow - don't force links
- Use descriptive anchor text that matches the context
- Aim for 3-5 internal links if they fit naturally`;
      contextSections.push(linkContext);
    } else if (manualData.internal_linking) {
      const linkContext = `INTERNAL LINKING STRATEGY: ${JSON.stringify(manualData.internal_linking)}`;
      contextSections.push(linkContext);
    }

    // External references instructions with STRICT citation link requirements
    const externalRefInstructions = `CITATION BEST PRACTICES:

When including specific statistics, research findings, or expert quotes, provide source links when available.

**PREFERRED CITATION FORMATS:**

✅ BEST: "A 2023 study published in the Journal of Clinical Psychology found that 73% of patients showed improvement [View study](https://www.journalofclinicalpsych.org/2023/postpartum-study)"

✅ GOOD: "According to [CDC guidelines on postpartum care](https://www.cdc.gov/reproductivehealth/maternalinfanthealth/postpartum-care.html), early intervention is crucial"

💡 ACCEPTABLE: "Many healthcare professionals recommend early intervention for postpartum mental health" (General statement without specific citation)

**GUIDELINES:**
1. Include source links for specific research studies and novel findings
2. General industry statistics and common medical knowledge don't require citations
3. When you have the actual URL to a source, use it
4. Homepage links are acceptable when specific article URLs aren't available
5. Focus on providing helpful, accurate content with appropriate sourcing

**CONTENT ACCEPTABLE WITHOUT CITATIONS:**
- General medical/health guidance: "Regular exercise supports mental health"
- Industry best practices: "Healthcare providers typically recommend..."
- Clinical approaches: "Treatment often includes a combination of therapy and medication"
- Patient experience descriptions: "Many new mothers report feeling overwhelmed"

**VISUAL CONTENT & DATA:**
- Charts, infographics, and highlight boxes can contain statistics and data visualizations
- These visual elements enhance comprehension and don't all require individual citations
- Include 2-4 highlight boxes, 1-2 charts/images throughout the post for engagement

**FORMAT:** [descriptive text](https://full-url.com)`;
    contextSections.push(externalRefInstructions);

    // CTA context with real URLs
    console.log('🎯 [CTA DEBUG] Prompt Building: Checking CTA availability:', {
      hasWebsiteDataCTAs: websiteData?.ctas && websiteData.ctas.length > 0,
      ctaCount: websiteData?.ctas?.length || 0,
      hasManualCTAPreferences: !!manualData?.cta_preferences
    });

    if (websiteData.ctas && websiteData.ctas.length > 0) {
      console.log('✅ [CTA DEBUG] Prompt Building: Adding REAL CTAs to prompt:', {
        ctaCount: websiteData.ctas.length,
        ctas: websiteData.ctas.map(cta => ({
          text: cta.cta_text,
          href: cta.href,
          type: cta.cta_type,
          placement: cta.placement
        }))
      });

      const ctaContext = `AVAILABLE CTAS (use these EXACT URLs - do not modify):

${websiteData.ctas.map((cta, i) =>
  `${i + 1}. "${cta.cta_text}" → ${cta.href}
   Type: ${cta.cta_type} | Best placement: ${cta.placement}
   Context: ${cta.context || 'General use'}`
).join('\n\n')}

CRITICAL CTA INSTRUCTIONS:
- ONLY use CTAs from the list above
- Use the EXACT href URLs provided - do not modify them
- Integrate CTAs naturally where they fit the content flow
- If a CTA doesn't fit naturally, skip it (don't force it)
- NEVER create placeholder URLs like "https://www.yourwebsite.com/..."
- If no CTAs fit, it's okay to have none

CTA SPACING RULES (CRITICAL - NEVER VIOLATE):
- MINIMUM 200-300 words between ANY two CTAs (NEVER back-to-back or in consecutive paragraphs)
- First CTA: After 300-400 words of content (NOT in introduction)
- Middle CTA(s): Space out every 400-500 words throughout the body
- Final CTA: Place 100-200 words BEFORE the conclusion section
- NEVER place CTAs in the first 200 words (introduction zone)
- Distribute strategically throughout the post - avoid clustering 3+ CTAs in one section
- If you cannot maintain proper spacing, use fewer CTAs (2 well-spaced CTAs > 3 clustered CTAs)`;
      contextSections.push(ctaContext);
    } else if (manualData.cta_preferences) {
      console.log('⚠️ [CTA DEBUG] Prompt Building: Using manual CTA preferences (no real CTAs):', {
        cta_preferences: manualData.cta_preferences
      });
      const ctaContext = `CTA PREFERENCES: ${JSON.stringify(manualData.cta_preferences)}`;
      contextSections.push(ctaContext);
    } else {
      console.warn('🚨 [CTA DEBUG] Prompt Building: NO CTAs AVAILABLE - instructing OpenAI to skip CTAs:', {
        hasWebsiteDataCTAs: false,
        hasManualCTAPreferences: false
      });
      // No CTAs available - inform OpenAI
      const noCTAContext = `NO CTAS AVAILABLE: This organization has not configured CTAs yet. Do not include any calls-to-action or generate placeholder URLs. Create informational content only.`;
      contextSections.push(noCTAContext);
    }

    // Target audience context
    if (manualData.target_audience) {
      const audienceContext = `TARGET AUDIENCE DETAILS: ${JSON.stringify(manualData.target_audience)}`;
      contextSections.push(audienceContext);
    }

    // SEO optimization instructions (conditional based on available data)
    const seoTarget = settings.target_seo_score || 95;
    const hasInternalLinks = websiteData.internal_links && websiteData.internal_links.length > 0;
    const hasCTAs = websiteData.ctas && websiteData.ctas.length > 0;

    console.log('🎯 [CTA DEBUG] Prompt Building: CTA flag for SEO instructions:', {
      hasCTAs,
      willIncludeCTAInstruction: hasCTAs ? 'Yes - use provided CTAs' : 'No - skip CTAs'
    });

    const seoInstructions = `
SEO OPTIMIZATION TARGET: ${seoTarget}+ score
CRITICAL SEO REQUIREMENTS:
- Title: 50-60 characters, compelling and keyword-rich
- Meta description: 150-160 characters, action-oriented
- Headings: Use H1, H2, H3 hierarchy with target keywords
- Content: 1200-1800 words for comprehensive coverage
${hasInternalLinks ? '- Include 3-5 internal links naturally within content (ONLY from the provided INTERNAL LINKS list)' : '- Do NOT include internal links to other pages (no internal links available)'}
${hasCTAs ? '- Add 2-3 relevant CTAs based on content flow (ONLY from the provided AVAILABLE CTAS list)' : '- Do NOT include CTAs (no CTAs configured)'}
- Use semantic keywords and related terms throughout
- Ensure mobile-friendly structure with scannable paragraphs
- Include actionable takeaways and clear value propositions`;

    // Data completeness indicator
    const dataContext = `DATA COMPLETENESS: ${completenessScore}% (${availability.has_blog_content ? '✓' : '✗'} Brand voice, ${availability.has_cta_data ? '✓' : '✗'} CTAs, ${availability.has_internal_links ? '✓' : '✗'} Internal links)`;

    // Build highlight box instructions with exclusions
    const allBoxTypes = ['statistic', 'pullquote', 'takeaway', 'warning', 'tip', 'definition', 'process', 'comparison'];
    const availableBoxTypes = allBoxTypes.filter(type => !previousBoxTypes.includes(type));

    let highlightBoxInstructions = `
## HIGHLIGHT BOX INSTRUCTIONS

You MUST automatically wrap qualifying content in highlight boxes using this HTML format:

<blockquote data-highlight-box="" data-highlight-type="TYPE" data-width="WIDTH" data-font-size="SIZE" data-layout="LAYOUT" data-align="ALIGN" data-custom-bg="BG_COLOR" data-custom-border="BORDER_COLOR">CONTENT</blockquote>

**8 Highlight Box Types:**

1. **statistic** - For numbers, percentages, data points
   - Example: <blockquote data-highlight-box="" data-highlight-type="statistic" data-width="90%" data-font-size="xxlarge" data-layout="block" data-align="center" data-custom-bg="#e6f7ff" data-custom-border="#1890ff">73% increase in engagement</blockquote>

2. **pullquote** - For expert quotes, testimonials, insights
   - Example: <blockquote data-highlight-box="" data-highlight-type="pullquote" data-width="90%" data-font-size="large" data-layout="block" data-align="center" data-custom-bg="#f6ffed" data-custom-border="#52c41a">"Content marketing generates 3x more leads"</blockquote>

3. **takeaway** - For main points, conclusions
   - Example: <blockquote data-highlight-box="" data-highlight-type="takeaway" data-width="90%" data-font-size="medium" data-layout="block" data-align="center" data-custom-bg="#fff7e6" data-custom-border="#fa8c16">The bottom line: Email marketing remains the highest ROI channel</blockquote>

4. **warning** - For critical info, alerts
   - Example: <blockquote data-highlight-box="" data-highlight-type="warning" data-width="90%" data-font-size="medium" data-layout="block" data-align="center" data-custom-bg="#fff1f0" data-custom-border="#ff4d4f">Critical: Never buy email lists!</blockquote>

5. **tip** - For pro tips, best practices
   - Example: <blockquote data-highlight-box="" data-highlight-type="tip" data-width="90%" data-font-size="small" data-layout="block" data-align="center" data-custom-bg="#e6f7ff" data-custom-border="#1890ff">Pro tip: Test subject lines with A/B testing</blockquote>

6. **definition** - For glossary terms, acronyms
   - Example: <blockquote data-highlight-box="" data-highlight-type="definition" data-width="90%" data-font-size="small" data-layout="block" data-align="center" data-custom-bg="#f0f5ff" data-custom-border="#2f54eb"><strong>SEO:</strong> Increasing website visibility in search results</blockquote>

7. **process** - For step-by-step instructions
   - Example: <blockquote data-highlight-box="" data-highlight-type="process" data-width="90%" data-font-size="medium" data-layout="block" data-align="center" data-custom-bg="#f9f0ff" data-custom-border="#722ed1"><strong>Step 3:</strong> Set up automated sequences</blockquote>

8. **comparison** - For versus, plan differences
   - Example: <blockquote data-highlight-box="" data-highlight-type="comparison" data-width="90%" data-font-size="medium" data-layout="block" data-align="center" data-custom-bg="#e6fffb" data-custom-border="#13c2c2"><strong>Free vs Pro:</strong> Free includes 1,000 contacts</blockquote>

**Highlight Box Rules:**
- Use MAXIMUM 3 highlight boxes per post (regardless of length)
- NEVER place highlight boxes in the conclusion section or after the last CTA
- All highlight boxes must appear BEFORE the final call-to-action

**CRITICAL ANTI-REDUNDANCY RULES:**
- Highlight boxes MUST NOT duplicate text from surrounding paragraphs
- DO NOT copy-paste sentences word-for-word into highlight boxes
- DO NOT restate the exact same information in slightly different words
- Each highlight box must add NEW information, insight, or perspective not already stated in adjacent text

**WRONG EXAMPLES (Redundant - NEVER DO THIS):**
❌ Paragraph: "Reproductive psychiatry focuses on mental health during pregnancy."
   Box: "Reproductive Psychiatry: Focuses on mental health during pregnancy."
   → REDUNDANT - verbatim copy!

❌ Paragraph: "Studies show 73% effectiveness for combined therapy."
   Box: "73% effectiveness when combining therapy"
   → REDUNDANT - just rephrasing!

**CORRECT EXAMPLES (Adds Value):**
✅ Paragraph discusses therapy benefits in general
   Box: "Industry data: 40% faster recovery with weekly sessions"
   → ADDS NEW specific data

✅ Paragraph explains treatment approach
   Box: "Pro tip: Schedule during second trimester for best results"
   → ADDS NEW actionable advice

✅ Paragraph about medication options
   Box: "According to [NIH research](https://www.nih.gov/), SSRIs are first-line treatment"
   → ADDS NEW cited authority

**RULE:** If highlight box doesn't add NEW information beyond what's in text → DON'T include it. Better to have 0 boxes than redundant ones.

**CITATIONS IN HIGHLIGHT BOXES:**
- Include citations for novel research findings when you have the source
- General industry knowledge and common statistics can be used without citations
- Example WITH citation:
  <blockquote data-highlight-box="" data-highlight-type="statistic" data-width="90%" data-align="center" data-layout="block" data-custom-bg="#e6f7ff" data-custom-border="#1890ff">
  80% of new mothers experience baby blues ([Source](https://www.postpartum.net/))
  </blockquote>
- Example WITHOUT citation (perfectly acceptable):
  <blockquote data-highlight-box="" data-highlight-type="tip" data-width="90%" data-align="center" data-layout="block" data-custom-bg="#e6f7ff" data-custom-border="#1890ff">
  Pro tip: Schedule therapy sessions during the second trimester for best results
  </blockquote>

**HIGHLIGHT BOX STYLING:**
- Use consistent styling: data-width="90%" data-align="center" data-layout="block"
- This creates a professional, centered appearance
`;

    if (previousBoxTypes.length > 0) {
      highlightBoxInstructions += `- DO NOT use these box types (used in previous post): ${previousBoxTypes.join(', ')}\n`;
      highlightBoxInstructions += `- Choose from remaining types: ${availableBoxTypes.join(', ')}\n`;
    }

    highlightBoxInstructions += `- Place boxes strategically to break up content and add value`;

    const imageInstructions = `
## IMAGE PLACEMENT INSTRUCTIONS

You MUST insert image placeholders throughout the blog post. Use these formats:

// CHARTS TEMPORARILY DISABLED - Uncomment for next iteration
/*
**For charts/graphs (when presenting data):**

CRITICAL CHART REQUIREMENTS:
- **ONLY create charts for data you ACTUALLY MENTION in the post text**
- **NEVER make up statistics or create placeholder/generic charts**
- **NO GENERIC LABELS**: Do NOT use "Phase 1/2/3", "Step 1/2/3", "Category A/B/C", or other meaningless placeholders
- **NO VAGUE TITLES**: Chart titles MUST be specific and descriptive - NEVER use "chart", "Chart", "data", or "Data" as the title
- The chart data must match exactly what you write in the surrounding paragraphs
- ALWAYS add explanatory text (2-3 sentences) BEFORE the chart introducing it
- ALWAYS add a credible source citation AFTER the chart
- **If you don't have specific, real data to visualize, skip charts entirely**

Format: ![CHART:chartType|Specific Descriptive Title|Label1,Label2,Label3|Value1,Value2,Value3]

Chart types: bar, pie, line
- Titles must describe the data (e.g., "Treatment Effectiveness Comparison" NOT "chart")
- Labels must be specific categories from your text (e.g., "CBT Therapy", "Medication", NOT "Phase 1", "Category A")
- Use 3-5 data points for clarity
- Values MUST represent real data/statistics you discuss in the text

**Complete Example with Context:**

Research shows that combined therapeutic approaches yield the best outcomes for postpartum anxiety. Studies indicate that therapy alone achieves 75% effectiveness, medication alone reaches 65%, while combined approaches demonstrate 92% effectiveness.

![CHART:bar|Treatment Effectiveness Rates|Therapy,Medication,Combined Approach|75,65,92]

*Source: American Journal of Psychiatry, 2023 meta-analysis of postpartum treatment outcomes*

**Another Example:**

The distribution of postpartum anxiety symptoms varies significantly. Our clinical data shows that 45% of patients report primarily anxiety-related symptoms, 30% experience sleep disturbances, and 25% report mood changes.

![CHART:pie|Symptom Distribution|Anxiety,Sleep Issues,Mood Changes|45,30,25]

*Source: Clinical observations from reproductive psychiatry practice, 2024*
*/

**For hero image:**
![IMAGE:hero_image:description]

Description = detailed image generation prompt (50-100 words) describing a professional, realistic photograph

**Example:**
![IMAGE:hero_image:Professional photograph showing a supportive counseling session with a mother and therapist, warm lighting, modern office setting, conveying comfort and hope]

**CRITICAL IMAGE RULES:**
- Include exactly ONE hero_image placeholder after the introduction
- ONLY use type "hero_image" (do NOT use chart, illustration, infographic, or diagram types)
- Hero image must appear BEFORE the final call-to-action
- NEVER place images in the conclusion section or after the last CTA
- Proper sequence: [Introduction + Hero Image] → [Content] → [Final CTA] → [Conclusion - NO IMAGES]

**For tweet embeds (social proof, expert perspectives, real stories):**

${realTweetUrls.length > 0
  ? `REAL TWEET PLACEHOLDERS AVAILABLE FOR THIS TOPIC:
${realTweetUrls.map((placeholder, i) => `${i + 1}. ${placeholder}`).join('\n')}

TWEET EMBED RULES (CRITICAL - REQUIRED):
- **MANDATORY**: You MUST include at least 1 (preferably 2) of the provided tweet placeholders in your blog post
- **USE THE EXACT PLACEHOLDERS PROVIDED ABOVE** - Do not modify them, copy them exactly as shown
- Choose the tweet(s) that best fit your content flow and add genuine social proof
- **REQUIRED**: Add 2-3 sentences of context BEFORE each tweet placeholder explaining:
  * Why this expert's perspective matters
  * How it connects to your current section
  * Their expertise or authority
- Position strategically:
  * Mid-post (after 2-3 sections) for expert validation
  * Near conclusion for testimonials or real-world perspectives
- NEVER place tweets in the conclusion section or after the last CTA
- All tweets must appear BEFORE the final call-to-action
- Copy the EXACT placeholder format provided above (including all the data encoding)

**Example Format:**
Leading experts in reproductive psychiatry emphasize the importance of evidence-based interventions. Dr. Smith's research focuses on personalized treatment approaches that combine therapeutic and pharmacological strategies.

${realTweetUrls[0]}

This evidence-based approach aligns with current best practices in maternal mental health care.`
  : `TWEET EMBED RULES:
- **NO REAL TWEETS AVAILABLE** - Do NOT include any tweet embeds in this post
- Do NOT create fake tweet placeholders or URLs
- Skip tweets entirely for this post
- Use other forms of social proof (statistics, studies, quotes from publications)`}`;

    console.log('✅ [CTA DEBUG] Prompt Building: Complete prompt built:', {
      promptLength: contextSections.length,
      hasCTASection: contextSections.some(section => section.includes('AVAILABLE CTAS') || section.includes('NO CTAS AVAILABLE')),
      ctaSectionPreview: contextSections.find(s => s.includes('CTA')) || 'No CTA section found',
      previousBoxTypes: previousBoxTypes.join(', ') || 'none',
      availableBoxTypes: availableBoxTypes.join(', ')
    });

    return `Write a high-quality blog post optimized for ${seoTarget}+ SEO score:

TOPIC: ${topic.title}
SUBTITLE: ${topic.subheader}
BUSINESS TYPE: ${businessInfo.businessType}
TARGET AUDIENCE: ${businessInfo.targetAudience}

${contextSections.join('\n\n')}

${dataContext}

${seoInstructions}

${imageInstructions}

${highlightBoxInstructions}

CONTENT REQUIREMENTS:
1. STRATEGIC VALUE: Provide actionable insights that demonstrate expertise
2. SEO OPTIMIZATION: Target ${seoTarget}+ score on comprehensive SEO analysis
3. BRAND ALIGNMENT: Match the voice and tone patterns identified
4. INTERNAL LINKING: Include 3-5 natural internal links to relevant content
5. CTA INTEGRATION: Include 2-3 contextual calls-to-action that feel natural
6. MOBILE OPTIMIZATION: Use scannable formatting with clear headings
7. VALUE-FOCUSED: Every paragraph should provide genuine value to readers

ABSOLUTE PROHIBITIONS - NEVER DO THESE:
❌ DO NOT create fake expert names (e.g., "Dr. Sarah Johnson", "Dr. Emily Chen", "Dr. Michael Roberts")
❌ DO NOT fabricate case studies with specific named people or companies
❌ DO NOT invent patient stories or testimonials with character names
❌ DO NOT make up "recent studies" with specific years, institutions, or researchers
❌ DO NOT create fictitious scenarios with named individuals (e.g., "Consider the journey of Dr. Emily...")
❌ DO NOT write phrases like "Sarah, a 35-year-old patient..." or "John, a business owner..."

ACCEPTABLE ALTERNATIVES FOR STORYTELLING:
✅ General statements: "Healthcare professionals often observe..." or "Patients typically report..."
✅ Hypothetical examples: "For example, a business owner might..." or "Consider a scenario where..."
✅ Industry patterns: "Many practitioners find that..." or "Research consistently shows..."
✅ TWEET EMBEDS for real stories: Use ![TWEET:username/status_id] to share authentic expert perspectives, patient testimonials, or case studies from verified sources
✅ Statistical evidence with links: "According to [CDC data](https://www.cdc.gov/), X% of patients..."

RULE: If you want to include an anecdote, expert story, or testimonial → Use a tweet embed instead of creating a fake one.

ADDITIONAL INSTRUCTIONS: ${additionalInstructions}

Return JSON format:
{
  "title": "SEO-optimized title (50-60 chars)",
  "subtitle": "Compelling subtitle", 
  "metaDescription": "Action-oriented meta description (150-160 chars)",
  "content": "Full blog post content in markdown with proper headings",
  "tags": ["relevant", "tags"],
  "estimatedReadTime": "X min read",
  "seoKeywords": ["primary", "secondary", "semantic", "keywords"],
  "internalLinks": [
    {
      "anchorText": "natural anchor text",
      "suggestedUrl": "/suggested/url",
      "context": "why this link adds value"
    }
  ],
  "ctaSuggestions": [
    {
      "text": "CTA text",
      "placement": "end-of-post",
      "type": "primary",
      "context": "why this CTA fits here"
    }
  ],
  "seoOptimizationScore": "predicted score based on SEO best practices"
}`;
  }

  /**
   * Generate enhanced blog post with website analysis integration
   */
  async generateEnhancedBlogPost(topic, businessInfo, organizationId, additionalInstructions = '') {
    const startTime = Date.now();
    const model = process.env.OPENAI_MODEL || 'gpt-4o';

    try {
      console.log(`🚀 Starting enhanced blog generation for organization: ${organizationId}`);

      console.log('🚩 [CHECKPOINT 3] Content Generation Starting:', {
        organizationId,
        topicTitle: topic.title,
        willLoadCTAs: 'Checking availability flags...',
        nextStep: 'Load organization context with CTAs'
      });

      // Load organization context
      const organizationContext = await this.getOrganizationContext(organizationId);
      console.log(`📊 Organization context loaded: ${organizationContext.completenessScore}% complete`);

      console.log('📊 [CTA DEBUG] Generation: Organization context retrieved:', {
        organizationId,
        completenessScore: organizationContext.completenessScore,
        hasWebsiteDataCTAs: organizationContext.websiteData?.ctas?.length > 0,
        ctaCount: organizationContext.websiteData?.ctas?.length || 0
      });

      console.log('🚩 [CHECKPOINT 4] Organization Context Loaded:', {
        organizationId,
        has_cta_data_flag: organizationContext.availability?.has_cta_data,
        ctaCount: organizationContext.websiteData?.ctas?.length || 0,
        hasCTAs: organizationContext.websiteData?.ctas?.length > 0,
        nextStep: organizationContext.websiteData?.ctas?.length > 0 ? 'Build prompt with CTAs' : 'ERROR: No CTAs found'
      });

      // Get previous post's highlight box types to avoid repetition
      const previousBoxTypes = await this.getPreviousPostHighlightBoxTypes(organizationId);
      console.log(`📊 Previous post used ${previousBoxTypes.length} highlight box types:`, previousBoxTypes);

      // Get preloaded tweets and create placeholders with embedded data
      const tweetPlaceholders = (topic.preloadedTweets || []).map(tweet => {
        const encodedData = Buffer.from(JSON.stringify(tweet)).toString('base64');
        return `![TWEET:${tweet.url}::DATA::${encodedData}]`;
      });
      console.log(`🐦 [TWEET] Building prompt with ${tweetPlaceholders.length} pre-loaded tweets (with embedded data)`);

      // Build enhanced prompt WITH tweet placeholders (OpenAI will insert them during generation)
      const enhancedPrompt = this.buildEnhancedPrompt(topic, businessInfo, organizationContext, additionalInstructions, previousBoxTypes, tweetPlaceholders);

      console.log('🧠 Calling OpenAI with enhanced prompt...');
      console.log('🧠 [CTA DEBUG] Generation: Sending prompt to OpenAI:', {
        organizationId,
        topicTitle: topic.title,
        hasCTAsInPrompt: enhancedPrompt.includes('AVAILABLE CTAS'),
        promptIncludesNoCTAWarning: enhancedPrompt.includes('NO CTAS AVAILABLE')
      });
      const completion = await this.openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content: `You are an expert SEO content strategist who creates blog posts that consistently score 95+ on comprehensive SEO analysis. You understand both technical SEO requirements and user experience needs. You integrate brand voice, internal linking, and CTAs naturally into valuable content.

CRITICAL REQUIREMENTS:
1. SEO EXCELLENCE: Target 95+ SEO score through comprehensive optimization
2. BRAND CONSISTENCY: Match provided brand voice and style patterns exactly  
3. STRATEGIC LINKING: Include internal links that genuinely add value
4. CONVERSION OPTIMIZATION: Place CTAs where they feel natural and helpful
5. MOBILE-FIRST: Structure content for mobile readability and engagement
6. FACTUAL ACCURACY: No fabricated statistics or false claims
7. GENUINE VALUE: Every section must provide actionable insights`
          },
          {
            role: 'user',
            content: enhancedPrompt
          }
        ],
        temperature: 0.3, // Lower temperature for more consistent quality
        max_tokens: 7000 // Increased to accommodate full blog with all visual elements
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // CRITICAL: Check for response truncation
      const finishReason = completion.choices[0].finish_reason;
      console.log('🔍 Blog Generation completion details:', {
        finish_reason: finishReason,
        prompt_tokens: completion.usage?.prompt_tokens,
        completion_tokens: completion.usage?.completion_tokens,
        total_tokens: completion.usage?.total_tokens,
        max_tokens_limit: 7000,
        duration: `${duration}ms`,
        model: model,
        organizationDataScore: organizationContext.completenessScore
      });

      if (finishReason === 'length') {
        console.error('❌ TRUNCATION ERROR: Blog generation response was cut off due to max_tokens limit');
        console.error('📊 Token usage:', {
          used: completion.usage?.completion_tokens,
          limit: 7000,
          overflow: completion.usage?.completion_tokens - 7000
        });
        throw new Error('Blog response truncated - increase max_tokens to at least ' + (completion.usage?.completion_tokens + 1000));
      }

      if (finishReason !== 'stop') {
        console.warn('⚠️ Unusual finish_reason:', finishReason);
      }

      const response = completion.choices[0].message.content;
      const blogData = this.parseOpenAIResponse(response);

      console.log('✅ [CTA DEBUG] Generation: OpenAI response received:', {
        organizationId,
        contentLength: blogData.content?.length || 0,
        hasContent: !!blogData.content,
        contentPreview: blogData.content?.substring(0, 200) + '...'
      });

      // Tweets were already included during generation (passed in prompt)
      // Just process any tweet placeholders that OpenAI inserted
      if (blogData.content && blogData.content.includes('![TWEET:')) {
        console.log('🐦 Processing tweet placeholders inserted by OpenAI during generation...');
        blogData.content = await this.processTweetPlaceholders(blogData.content);
        console.log(`✅ [TWEET] Processed tweet placeholders into rich cards`);
      } else {
        console.log('ℹ️ [TWEET] No tweet placeholders found in generated content');
      }

      blogData._needsTweetEnrichment = false;

      // Debug: Check if highlight boxes were generated and if they have content
      const highlightBoxMatches = blogData.content?.match(/<blockquote[^>]*data-highlight-type[^>]*>.*?<\/blockquote>/gs) || [];
      console.log('📦 [HIGHLIGHT BOX DEBUG] Highlight boxes in generated content:', {
        count: highlightBoxMatches.length,
        boxes: highlightBoxMatches.map(box => {
          const innerContent = box.replace(/<blockquote[^>]*>/, '').replace(/<\/blockquote>/, '');
          return {
            type: box.match(/data-highlight-type="(\w+)"/)?.[1],
            isEmpty: !box.match(/<blockquote[^>]*><\/blockquote>/),
            innerContentLength: innerContent.length,
            innerContentPreview: innerContent.substring(0, 200),
            fullBoxPreview: box.substring(0, 300) + '...'
          };
        })
      });

      // Check if CTAs appear in generated content
      const ctaLinkMatches = blogData.content?.match(/\[.*?\]\(.*?\)/g) || [];
      console.log('🔍 [CTA DEBUG] Generation: CTA links in generated content:', {
        ctaLinkCount: ctaLinkMatches.length,
        ctaLinks: ctaLinkMatches.slice(0, 5) // Show first 5
      });

      // SKIP synchronous image processing - will be done async after save
      console.log('🔍 [IMAGE DEBUG] Checking for image placeholders...');
      console.log('🔍 [IMAGE DEBUG] Content length:', blogData.content?.length);
      console.log('🔍 [IMAGE DEBUG] Content preview:', blogData.content?.substring(0, 300));
      console.log('🔍 [IMAGE DEBUG] Contains ![IMAGE:', blogData.content?.includes('![IMAGE:'));
      console.log('🔍 [IMAGE DEBUG] Contains ![CHART:', blogData.content?.includes('![CHART:'));

      if (blogData.content && (blogData.content.includes('![IMAGE:') || blogData.content.includes('![CHART:'))) {
        console.log('✅ [IMAGE DEBUG] Setting _hasImagePlaceholders = true');
        console.log('🎨 Detected image/chart placeholders - will process ASYNC after save');
        // Store metadata for async processing
        blogData._hasImagePlaceholders = true;
        blogData._topicForImages = topic;
        blogData._organizationIdForImages = organizationId;
      } else {
        console.log('❌ [IMAGE DEBUG] No placeholders found');
        console.log('📊 No image/chart placeholders detected in generated content');
        blogData._hasImagePlaceholders = false;
      }

      // Process tweet placeholders synchronously (fast - just HTML conversion)
      if (blogData.content && blogData.content.includes('![TWEET:')) {
        console.log('🐦 Detected tweet placeholders in content - processing...');
        blogData.content = await this.processTweetPlaceholders(blogData.content);
      } else {
        console.log('ℹ️ No tweet placeholders in generated content');
        console.log('ℹ️ This is OK - tweets are optional when no real tweets are available');
      }

      // Clean up formatting issues
      console.log('🧹 Cleaning up content formatting...');
      blogData.content = this.cleanupFormatting(blogData.content);

      // Validate tweet requirement (check if tweet cards exist after processing)
      const tweetCardCount = (blogData.content?.match(/class="tweet-card"/g) || []).length;
      const tweetPlaceholderCount = (blogData.content?.match(/!\[TWEET:/g) || []).length;
      console.log('🐦 [TWEET VALIDATION]:', {
        tweetCardsGenerated: tweetCardCount,
        tweetPlaceholdersRemaining: tweetPlaceholderCount,
        status: tweetCardCount > 0 ? 'Has tweets' : 'No tweets (OK if none available)'
      });

      // Tweets are now optional - no error if missing
      if (tweetCardCount === 0 && tweetPlaceholderCount === 0) {
        console.log('ℹ️ Blog post generated without tweet embeds (no real tweets were available)');
      }

      // Enhance blog data with organization context
      blogData.organizationContext = {
        dataCompleteness: organizationContext.completenessScore,
        hasWebsiteData: organizationContext.hasWebsiteData,
        hasManualInputs: organizationContext.hasManualFallbacks,
        enhancementLevel: organizationContext.completenessScore > 60 ? 'high' : 
                         organizationContext.completenessScore > 30 ? 'medium' : 'basic'
      };

      // Add generation metadata
      blogData.generationMetadata = {
        model: model,
        duration: duration,
        tokensUsed: completion.usage?.total_tokens,
        enhancementLevel: blogData.organizationContext.enhancementLevel,
        generatedAt: new Date().toISOString()
      };

      // Final check: Log highlight boxes in final content being returned
      const finalBoxMatches = blogData.content?.match(/<blockquote[^>]*data-highlight-type[^>]*>.*?<\/blockquote>/gs) || [];
      console.log('📦 [FINAL CHECK] Highlight boxes in content being returned to frontend:', {
        count: finalBoxMatches.length,
        boxes: finalBoxMatches.map(box => {
          const innerText = box.replace(/<blockquote[^>]*>/, '').replace(/<\/blockquote>/, '');
          return {
            type: box.match(/data-highlight-type="(\w+)"/)?.[1],
            innerTextLength: innerText.length,
            innerText: innerText.substring(0, 300),
            fullBox: box
          };
        })
      });

      return blogData;

    } catch (error) {
      console.error('Enhanced blog generation error:', error);
      throw new Error(`Enhanced blog generation failed: ${error.message}`);
    }
  }

  /**
   * Async image generation - processes image placeholders after blog is saved
   * Call this AFTER saving the blog post to database
   * @param {string} blogPostId - The ID of the saved blog post
   * @param {string} content - Content with image placeholders
   * @param {Object} topic - Blog topic information
   * @param {string} organizationId - Organization ID
   * @returns {Object} Updated content with generated images
   */
  async generateImagesAsync(blogPostId, content, topic, organizationId) {
    try {
      console.log(`🎨 [ASYNC IMAGE GEN] Starting async image generation for blog: ${blogPostId}`);

      // Add overall timeout of 45 seconds for all image generation (within Vercel's 60s limit)
      const updatedContent = await Promise.race([
        this.processImagePlaceholders(content, topic, organizationId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Async image generation timeout (45s total)')), 45000)
        )
      ]);

      console.log(`✅ [ASYNC IMAGE GEN] Images generated successfully for blog: ${blogPostId}`);

      return {
        success: true,
        content: updatedContent,
        blogPostId
      };
    } catch (error) {
      console.error(`❌ [ASYNC IMAGE GEN] Failed for blog ${blogPostId}:`, error.message);
      return {
        success: false,
        error: error.message,
        blogPostId,
        content // Return original content with placeholders
      };
    }
  }

  /**
   * Update blog post content in database
   * Used by async image/tweet generation to update post with generated content
   * @param {string} blogPostId - The ID of the blog post to update
   * @param {string} content - Updated content with images/tweets
   */
  async updateBlogPostContent(blogPostId, content) {
    try {
      console.log(`📝 Updating blog post ${blogPostId} with generated content...`);

      await db.query(
        `UPDATE blog_posts
         SET content = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [content, blogPostId]
      );

      console.log(`✅ Blog post ${blogPostId} content updated successfully`);
    } catch (error) {
      console.error(`❌ Failed to update blog post ${blogPostId}:`, error);
      throw error;
    }
  }

  /**
   * Enrich blog post with tweets asynchronously (background processing)
   * @param {string} blogPostId - The ID of the blog post to enrich
   * @param {string} content - Original blog post content
   * @param {Object} topic - Blog post topic
   * @param {Object} businessInfo - Business information
   * @returns {Object} Result with success status and enriched content
   */
  async enrichTweetsAsync(blogPostId, content, topic, businessInfo) {
    try {
      console.log(`🐦 [ASYNC TWEET] Starting async tweet enrichment for blog: ${blogPostId}`);

      // Step 1: Extract search queries from generated content
      const searchQueries = await this.extractTweetSearchQueries(content, topic, businessInfo);

      // Step 2: Search for tweets using all queries
      const tweets = await this.searchForTweetsWithMultipleQueries(searchQueries);

      // Step 3: Select tweets that support the narrative
      const selectedTweets = await this.selectNarrativeSupportingTweets(content, tweets, businessInfo);

      // Step 4: Enrich content with selected tweets
      let enrichedContent = content;
      if (selectedTweets.length > 0) {
        enrichedContent = await this.enrichContentWithTweets(content, selectedTweets);
        console.log(`✅ [ASYNC TWEET] Enriched content with ${selectedTweets.length} tweets for blog: ${blogPostId}`);
      } else {
        console.log(`ℹ️ [ASYNC TWEET] No tweets selected for blog: ${blogPostId}`);
      }

      return {
        success: true,
        content: enrichedContent,
        blogPostId,
        tweetsAdded: selectedTweets.length
      };
    } catch (error) {
      console.error(`❌ [ASYNC TWEET] Failed for blog ${blogPostId}:`, error.message);
      return {
        success: false,
        error: error.message,
        blogPostId,
        content // Return original content
      };
    }
  }

  /**
   * Generate visual content suggestions for blog post
   */
  async generateVisualContentSuggestions(blogData, organizationId) {
    try {
      console.log('🎨 Generating visual content suggestions...');

      // Get brand guidelines if available
      const brandResult = await db.query(
        'SELECT input_data FROM user_manual_inputs WHERE organization_id = $1 AND input_type = $2 AND validated = TRUE',
        [organizationId, 'brand_colors']
      );

      let brandGuidelines = {};
      if (brandResult.rows.length > 0) {
        brandGuidelines = JSON.parse(brandResult.rows[0].input_data);
      }

      // Generate suggestions based on content
      const suggestions = await this.visualContentService.suggestVisualContent(
        { title: blogData.title, content: blogData.content },
        brandGuidelines
      );

      return suggestions;

    } catch (error) {
      console.error('Visual content suggestion error:', error);
      return []; // Return empty array on failure, don't break blog generation
    }
  }

  /**
   * Complete enhanced blog generation with visual content
   */
  async generateCompleteEnhancedBlog(topic, businessInfo, organizationId, options = {}) {
    try {
      console.log(`🎯 Starting complete enhanced blog generation for: ${topic.title}`);

      // Load organization context for quality recommendations
      const organizationContext = await this.getOrganizationContext(organizationId);

      // If tweets were provided in options, attach them to topic for downstream use
      if (options.preloadedTweets && options.preloadedTweets.length > 0) {
        topic = {
          ...topic,
          preloadedTweets: options.preloadedTweets
        };
        console.log(`🐦 [TWEET] Attached ${options.preloadedTweets.length} pre-fetched tweets to topic`);
      }

      // Generate the blog post content
      const blogData = await this.generateEnhancedBlogPost(
        topic,
        businessInfo,
        organizationId,
        options.additionalInstructions || ''
      );

      // Generate visual content suggestions if requested
      let visualSuggestions = [];
      if (options.includeVisuals !== false) {
        visualSuggestions = await this.generateVisualContentSuggestions(blogData, organizationId);
      }

      // Combine everything into complete response
      const completeResponse = {
        ...blogData,
        visualContentSuggestions: visualSuggestions,
        enhancedGeneration: true,
        qualityPrediction: {
          expectedSEOScore: blogData.seoOptimizationScore || 85,
          enhancementLevel: blogData.organizationContext.enhancementLevel,
          dataCompleteness: blogData.organizationContext.dataCompleteness,
          recommendations: this.generateQualityRecommendations(organizationContext)
        }
      };

      console.log(`✅ Complete enhanced blog generation finished`);
      console.log(`📊 Quality prediction: ${completeResponse.qualityPrediction.expectedSEOScore} SEO score`);
      console.log('🔍 [IMAGE DEBUG] Return object has _hasImagePlaceholders:', completeResponse._hasImagePlaceholders);
      console.log('🔍 [IMAGE DEBUG] Return object has _topicForImages:', !!completeResponse._topicForImages);
      console.log('🔍 [IMAGE DEBUG] Return object has _organizationIdForImages:', !!completeResponse._organizationIdForImages);

      return completeResponse;

    } catch (error) {
      console.error('Complete enhanced blog generation error:', error);
      throw error;
    }
  }

  /**
   * Generate quality improvement recommendations
   */
  generateQualityRecommendations(organizationContext) {
    const recommendations = [];
    const { availability = {}, completenessScore = 0 } = organizationContext || {};

    if (!availability.has_blog_content) {
      recommendations.push({
        category: 'brand_voice',
        priority: 'high',
        message: 'Add brand voice guidelines to improve content consistency and quality scores',
        action: 'Upload existing blog content or provide manual brand voice inputs'
      });
    }

    if (!availability.has_cta_data) {
      recommendations.push({
        category: 'conversion',
        priority: 'medium',
        message: 'Add CTA preferences to improve conversion optimization scores',
        action: 'Provide manual CTA preferences or upload existing website content'
      });
    }

    if (!availability.has_internal_links) {
      recommendations.push({
        category: 'seo',
        priority: 'medium',
        message: 'Add internal linking strategy to boost SEO scores',
        action: 'Provide manual internal linking preferences or analyze existing website structure'
      });
    }

    if (completenessScore < 60) {
      recommendations.push({
        category: 'overall',
        priority: 'high',
        message: `Data completeness at ${completenessScore}% limits content quality potential`,
        action: 'Complete website analysis or provide additional manual inputs to reach 90%+ quality scores'
      });
    }

    return recommendations;
  }

  /**
   * Generate blog with iterative optimization to reach target score
   */
  async generateWithOptimization(topic, businessInfo, organizationId, targetScore = 95, options = {}) {
    console.log(`🎯 Starting iterative optimization targeting ${targetScore}+ SEO score`);
    
    const maxIterations = options.maxIterations || 3;
    let currentIteration = 0;
    let bestResult = null;
    let bestScore = 0;
    const attempts = [];

    while (currentIteration < maxIterations) {
      currentIteration++;
      console.log(`🔄 Optimization attempt ${currentIteration}/${maxIterations}`);

      try {
        // Generate blog post with improved instructions
        const iterationInstructions = currentIteration > 1 ? 
          `${options.additionalInstructions || ''} Previous attempt scored ${bestScore}. Focus on improving SEO optimization, content depth, and keyword integration to reach ${targetScore}+ score.` : 
          `${options.additionalInstructions || ''} Target ${targetScore}+ SEO score with comprehensive optimization.`;

        const blogResult = await this.generateCompleteEnhancedBlog(
          topic,
          businessInfo,
          organizationId,
          {
            ...options,
            additionalInstructions: iterationInstructions
          }
        );

        // Mock SEO score analysis (in real system, would use actual SEO analysis)
        const content = blogResult.content || '';
        const wordCount = content.split(' ').length;
        const hasHeaders = content.includes('#');
        const hasKeywords = blogResult.seoKeywords?.some(keyword => 
          content.toLowerCase().includes(keyword.toLowerCase())
        );
        
        const score = Math.min(95, 
          60 + 
          (wordCount > 1200 ? 20 : wordCount > 800 ? 15 : 10) + 
          (hasHeaders ? 10 : 0) + 
          (hasKeywords ? 15 : 5) +
          (blogResult.internalLinks?.length > 2 ? 10 : 5)
        );

        console.log(`📊 Attempt ${currentIteration} SEO score: ${score}`);

        attempts.push({
          iteration: currentIteration,
          score: score,
          blog: blogResult
        });

        // Update best result if this is better
        if (score > bestScore) {
          bestScore = score;
          bestResult = blogResult;
        }

        // If we hit the target score, stop iterating
        if (score >= targetScore) {
          console.log(`🎉 Target score ${targetScore} achieved with score ${score}!`);
          break;
        }

      } catch (iterationError) {
        console.error(`❌ Iteration ${currentIteration} failed:`, iterationError.message);
        attempts.push({
          iteration: currentIteration,
          error: iterationError.message,
          score: 0
        });
      }
    }

    return {
      bestResult: bestResult,
      finalScore: bestScore,
      targetReached: bestScore >= targetScore,
      attempts: attempts,
      iterations: currentIteration,
      maxIterations
    };
  }

  /**
   * Save enhanced blog post to database with metadata
   */
  async saveEnhancedBlogPost(userId, organizationId, blogData, options = {}) {
    try {
      const { v4: uuidv4 } = await import('uuid');
      const postId = uuidv4();

      // Save main blog post
      const result = await db.query(`
        INSERT INTO blog_posts (
          id, user_id, organization_id, title, content, meta_description,
          topic_data, generation_metadata, status, word_count, seo_score_prediction,
          internal_links_data, cta_suggestions_data, enhancement_level
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
      `, [
        postId,
        userId,
        organizationId,
        blogData.title,
        blogData.content,
        blogData.metaDescription,
        JSON.stringify({ 
          title: blogData.title,
          subtitle: blogData.subtitle,
          tags: blogData.tags,
          seoKeywords: blogData.seoKeywords
        }),
        JSON.stringify(blogData.generationMetadata),
        options.status || 'draft',
        blogData.content ? blogData.content.split(' ').length : 0,
        blogData.qualityPrediction?.expectedSEOScore || null,
        JSON.stringify(blogData.internalLinks || []),
        JSON.stringify(blogData.ctaSuggestions || []),
        blogData.organizationContext?.enhancementLevel || 'basic'
      ]);

      console.log(`✅ Enhanced blog post saved: ${postId}`);
      return result.rows[0];

    } catch (error) {
      console.error('Error saving enhanced blog post:', error);
      throw error;
    }
  }
}

// Create and export service instance
const enhancedBlogGenerationService = new EnhancedBlogGenerationService();
export default enhancedBlogGenerationService;