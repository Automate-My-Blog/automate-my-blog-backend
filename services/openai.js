import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class OpenAIService {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required in environment variables');
    }
  }

  /**
   * Clean OpenAI response by removing markdown code blocks and parsing JSON with robust error handling
   */
  parseOpenAIResponse(response) {
    try {
      console.log('🔍 Starting OpenAI response parsing...');
      console.log('Raw response length:', response?.length || 0);
      
      if (!response || typeof response !== 'string') {
        throw new Error('Invalid response: not a string or empty');
      }
      
      // Log first and last parts for debugging without exposing full content
      console.log('Response preview (first 200 chars):', response.substring(0, 200));
      console.log('Response preview (last 200 chars):', response.substring(Math.max(0, response.length - 200)));
      
      // Remove markdown code blocks if present
      let cleanedResponse = response.trim();
      
      // More robust markdown removal
      const patterns = [
        /^```json\s*/i,
        /^```\s*/,
        /\s*```$/
      ];
      
      patterns.forEach(pattern => {
        cleanedResponse = cleanedResponse.replace(pattern, '');
      });
      
      cleanedResponse = cleanedResponse.trim();
      
      // Check if response looks like it might be truncated
      const lastChar = cleanedResponse.charAt(cleanedResponse.length - 1);
      if (lastChar !== '}' && lastChar !== ']') {
        console.warn('⚠️ Response may be truncated - does not end with } or ]');
        console.log('Last 50 characters:', cleanedResponse.substring(cleanedResponse.length - 50));
      }
      
      console.log('Attempting to parse cleaned response...');
      return JSON.parse(cleanedResponse);
      
    } catch (parseError) {
      console.error('❌ Primary JSON parsing failed:', parseError.message);
      
      // Enhanced error logging with position context
      const errorMatch = parseError.message.match(/position (\d+)/);
      if (errorMatch) {
        const errorPosition = parseInt(errorMatch[1]);
        console.log(`Character at error position ${errorPosition}:`, response.charAt(errorPosition));
        console.log(`Context around position ${errorPosition}:`, 
          response.substring(Math.max(0, errorPosition - 50), errorPosition + 50));
      }
      
      // Fallback 1: Try parsing original response
      try {
        console.log('🔄 Attempting fallback: parsing original response...');
        return JSON.parse(response);
      } catch (fallbackError) {
        console.error('❌ Fallback parsing also failed:', fallbackError.message);
        console.error('📄 Full response that failed to parse:');
        console.error(response);

        // REMOVED FALLBACK: Instead of returning "Unable to determine", throw error
        // This allows frontend to show empty state instead of misleading placeholder data
        throw new Error(`JSON parsing failed: ${parseError.message}. Check logs for full response.`);
      }
    }
  }

  /**
   * Analyze website content and extract business information
   */
  async analyzeWebsite(websiteContent, url) {
    try {
      console.log('OpenAI website analysis starting...');
      console.log('Model:', process.env.OPENAI_MODEL || 'gpt-3.5-turbo');
      console.log('Content length:', websiteContent?.length || 0);
      
      // Check for minimal content that might indicate JavaScript-heavy site
      if (websiteContent && websiteContent.length < 500) {
        console.log('Warning: Very limited content detected. Possible JavaScript-heavy site.');
      }
      
      if (websiteContent && websiteContent.toLowerCase().includes('javascript') && websiteContent.length < 1000) {
        console.log('Warning: Site appears to require JavaScript for content rendering.');
      }

      // Extract basic business info for web search
      let businessName = '';
      let businessType = '';
      
      // Quick extraction of business name and type from URL and content
      const domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      businessName = domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
      
      // Try to identify business type from content
      const contentLower = websiteContent?.toLowerCase() || '';
      if (contentLower.includes('doctor') || contentLower.includes('medical') || contentLower.includes('health')) {
        businessType = 'Healthcare/Medical Practice';
      } else if (contentLower.includes('restaurant') || contentLower.includes('food') || contentLower.includes('dining')) {
        businessType = 'Restaurant/Food Service';
      } else if (contentLower.includes('lawyer') || contentLower.includes('attorney') || contentLower.includes('legal')) {
        businessType = 'Legal Services';
      } else if (contentLower.includes('consulting') || contentLower.includes('consultant')) {
        businessType = 'Consulting Services';
      } else {
        businessType = 'Business Services';
      }

      // Perform web search-enhanced research (parallel execution for speed)
      console.log('=== STARTING WEB SEARCH RESEARCH ===');
      console.log('Business Name:', businessName);
      console.log('Business Type:', businessType);
      console.log('Website URL:', url);
      console.log('About to call performBusinessResearch and performKeywordResearch...');
      
      const [webSearchResults, keywordResults] = await Promise.allSettled([
        this.performBusinessResearch(businessName, businessType, url),
        this.performKeywordResearch(businessType, 'target customers', null)
      ]);

      console.log('=== WEB SEARCH RESULTS ===');
      console.log('Business Research Status:', webSearchResults.status);
      if (webSearchResults.status === 'rejected') {
        console.error('Business Research Error:', webSearchResults.reason);
      }
      console.log('Keyword Research Status:', keywordResults.status);
      if (keywordResults.status === 'rejected') {
        console.error('Keyword Research Error:', keywordResults.reason);
      }

      let webSearchData = '';
      let keywordData = '';

      if (webSearchResults.status === 'fulfilled' && webSearchResults.value) {
        webSearchData = `\n\nWEB SEARCH BUSINESS INTELLIGENCE:\n${webSearchResults.value}`;
        console.log('✅ Web search business research completed successfully');
        console.log('Data length:', webSearchResults.value?.length || 0);
      } else {
        console.log('❌ Web search business research failed or unavailable, continuing with basic analysis');
      }

      if (keywordResults.status === 'fulfilled' && keywordResults.value) {
        keywordData = `\n\nKEYWORD & SEO RESEARCH:\n${keywordResults.value}`;
        console.log('✅ Keyword research completed successfully');
        console.log('Data length:', keywordResults.value?.length || 0);
      } else {
        console.log('❌ Keyword research failed or unavailable, continuing with basic analysis');
      }
      
      const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
      console.log('Using OpenAI model for final analysis:', model);
      
      const completion = await openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content: `You are a customer psychology expert who analyzes ANY type of business to understand real customer behavior. You must be extremely precise with your analysis and follow the exact JSON format specified. Your responses will be parsed by code, so accuracy is critical.

IMPORTANT: Your analysis will drive content generation that must be genuinely insightful, empathetic, and valuable - not generic advice. Focus on the complex emotional reality of customer problems and the specific psychological barriers they face.`
          },
          {
            role: 'user',
            content: `Analyze this website and provide customer psychology insights for content marketing, incorporating web search research data:

Website: ${url}
Content: ${websiteContent}${webSearchData}${keywordData}

CRITICAL REQUIREMENTS:
1. Return EXACTLY the JSON structure specified - no deviations
2. ALL fields are REQUIRED - no empty strings or null values
3. Follow character limits strictly
4. Use realistic customer language, not business jargon
5. Think systematically about who pays vs who uses the product/service

ANALYSIS FRAMEWORK (Integrate web search data where available):

CORE BUSINESS ANALYSIS:
- Who has purchasing power/budget authority vs who uses the product?
- How does this business make money? (analyze pricing, products, CTAs, conversion elements)
- What are the website's conversion goals? (analyze forms, buttons, user flows, calls-to-action)
- How should blog content support these business objectives?

ENHANCED CUSTOMER PSYCHOLOGY (Use web search insights):
- What specific problems drive people to search for this business type?
- How do customers actually describe their problems? (Use keyword research data if available)
- What emotional language patterns emerge from customer reviews/discussions?
- What are the different search scenarios (problem → search phrases → content opportunities → business conversion)?
- When are customers most likely to search (urgency, emotional state)?
- CRITICAL: For each customer problem, identify DISTINCT target segments with DIFFERENT demographics, life stages, and psychographics
- NEVER use identical or similar target audience descriptions across scenarios - each must be unique and specific

BRAND & COMPETITIVE INTELLIGENCE (Leverage web search findings):
- What are the actual brand colors and visual identity? (Use web search brand research if available)
- How does this business position itself vs competitors?
- What industry-specific terminology and trends should inform content strategy?
- What recent developments or context affect customer behavior?

KEYWORD & SEO INTEGRATION (Apply keyword research):
- What keywords are customers actually using to find businesses like this?
- What search intent patterns reveal about customer journey stages?
- How can content strategy align with actual search behavior?
- What are the current trending topics and opportunities in this space?

JSON RESPONSE (follow EXACTLY):
{
  "businessType": "Specific category (max 50 chars) - be descriptive, avoid generic terms like 'E-commerce' or 'Technology'",
  "businessName": "Exact company name from website content",
  "decisionMakers": "Who actually makes purchasing decisions (max 100 chars) - consider demographics, role, authority",
  "endUsers": "Who uses the product/service (max 100 chars) - may be same as decision makers",
  "contentFocus": "Content themes addressing customer problems (max 100 chars)",
  "brandVoice": "Communication tone for this customer situation (max 50 chars)",
  "brandColors": {
    "primary": "#6B8CAE",
    "secondary": "#F4E5D3", 
    "accent": "#8FBC8F"
  },
  "description": "How business solves customer problems (max 150 chars)",
  "businessModel": "How this business makes money based on website analysis (max 100 chars)",
  "websiteGoals": "Primary conversion objectives inferred from CTAs, forms, user flows (max 150 chars)",
  "blogStrategy": "How blog content should support business conversion goals (max 200 chars)",
  "searchBehavior": "When/how customers search (max 150 chars) - urgency, emotional state, timing patterns",
  "scenarios": [
    {
      "customerProblem": "Specific problem that drives search behavior (use emotional language)",
      "pitch": "REQUIRED: Explain the strategic opportunity with insight. Include: (1) WHO + WHAT they search - demographics + exact keywords (e.g., 'First-time mothers 25-35 searching for safe antidepressants during pregnancy'), (2) SIZE - exact monthly number (e.g., '3,500 searches'), (3) MARKET GAP - why they're underserved (e.g., 'most content is generic parenting advice, not clinical guidance'), (4) CONVERSION INSIGHT - psychological/emotional reason they'll convert (e.g., 'their fear and urgency means they need expert reassurance, not blog posts'). Show strategic thinking, not just 'low competition = conversions'. Vary structures. Max 350 chars.",
      "targetSegment": {
        "demographics": "MUST BE UNIQUE FOR EACH SCENARIO: Specific age range, life stage, education, income, family status that differentiates this segment from others",
        "psychographics": "MUST BE DISTINCT: Different emotional state, urgency level, healthcare-seeking behavior, decision-making context from other scenarios",
        "searchBehavior": "MUST VARY BY SCENARIO: When and how this specific segment searches (crisis-driven vs planned, reactive vs proactive) - different from other scenarios"
      },
      "businessValue": {
        "searchVolume": "Estimated monthly searches (e.g., 'High - 5,400/month' or 'Medium - 1,200/month')",
        "competition": "Competition level (Low/Medium/High) and competitive gaps",
        "conversionPotential": "Conversion likelihood based on urgency, payment ability, and intent (High/Medium/Low)",
        "priority": "Overall business priority ranking (1=highest value, 2=secondary, etc.)"
      },
      "customerLanguage": ["2-3 phrases customers actually type into Google for this problem", "use keyword research data if available, otherwise infer from emotional context"],
      "seoKeywords": ["3-4 SEO-focused keywords for this problem", "prioritize keyword research findings if available", "balance search volume with specificity"],
      "conversionPath": "How this content scenario supports business goals (max 150 chars)",
      "contentIdeas": [
        {
          "title": "Blog post title addressing this specific problem",
          "searchIntent": "What motivates this customer segment to search for this topic",
          "businessAlignment": "How this content drives toward conversion goals"
        }
      ]
    },
    "// Generate 4-5 scenarios based on different customer problems, each with distinct target segments and ranked by business value"
  ],
  "connectionMessage": "2-3 sentences explaining how this business connects with customers through content, specific to their situation and customer psychology (max 300 chars)"
}

VALIDATION RULES:
- PRIORITIZE WEB SEARCH DATA: When web search research is available, use it to enhance accuracy of customer language, SEO keywords, and business context
- NO placeholder text like "Target Audience" or "Business Type"
- NO generic terms like "customers" or "users" - be specific
- NO business jargon - use customer language in customerLanguage fields (prioritize keyword research findings)
- ALL arrays must have specified number of items
- ALL text must be under character limits
- businessModel, websiteGoals, blogStrategy must be inferred from actual website content and web search intelligence

SCENARIO-SPECIFIC REQUIREMENTS:
- scenarios must have 4-5 items, each addressing a different customer problem with business alignment
- CRITICAL: EACH SCENARIO MUST HAVE COMPLETELY DIFFERENT TARGET DEMOGRAPHICS - NO IDENTICAL OR SIMILAR DESCRIPTIONS ALLOWED
- targetSegment.demographics MUST be specific and unique for each scenario: include DIFFERENT age ranges, life stages, income levels, education, family status
- targetSegment.psychographics MUST describe DIFFERENT emotional states, urgency levels, healthcare-seeking behaviors, and decision-making contexts
- If targeting the same broad category (e.g., reproductive health), EACH scenario must target a DISTINCT SUBSET with different characteristics
- Example: "Pregnant women 25-35, first-time mothers, high anxiety about medication" vs "New mothers 0-12 months postpartum, overwhelmed, seeking immediate relief"
- businessValue.priority must rank scenarios by total opportunity (1=highest, 2=secondary, etc.)
- businessValue fields must include realistic search volume estimates and conversion assessments
- scenarios must be ordered by priority (highest business value first)
- conversionPath must show clear connection from content to business goals
- seoKeywords should be optimization-focused, incorporating keyword research data when available
- customerLanguage should be emotional phrases customers actually type (use web search customer insights)
- brandColors should reflect actual brand guidelines found through web search when available
- contentIdeas must include businessAlignment showing conversion strategy
- connectionMessage must be specific to this business, not generic template text
- JSON must be valid and parseable`
          }
        ],
        temperature: 0.3,
        max_tokens: 4000  // Increased from 3000 to accommodate complex JSON structure
      });

      console.log('OpenAI request completed successfully');
      console.log('Response choices:', completion.choices?.length || 0);

      // CRITICAL: Check for response truncation
      const finishReason = completion.choices[0].finish_reason;
      console.log('🔍 Website Analysis completion details:', {
        finish_reason: finishReason,
        prompt_tokens: completion.usage?.prompt_tokens,
        completion_tokens: completion.usage?.completion_tokens,
        total_tokens: completion.usage?.total_tokens,
        max_tokens_limit: 4000
      });

      if (finishReason === 'length') {
        console.error('❌ TRUNCATION ERROR: Website analysis response was cut off due to max_tokens limit');
        console.error('📊 Token usage:', {
          used: completion.usage?.completion_tokens,
          limit: 4000,
          overflow: completion.usage?.completion_tokens - 4000
        });
        throw new Error('Website analysis response truncated - increase max_tokens to at least ' + (completion.usage?.completion_tokens + 1000));
      }

      if (finishReason !== 'stop') {
        console.warn('⚠️ Unusual finish_reason:', finishReason);
      }

      const response = completion.choices[0].message.content;
      console.log('Response content length:', response?.length || 0);
      console.log('📄 First 500 chars of response:', response?.substring(0, 500));
      console.log('📄 Last 500 chars of response:', response?.substring(response.length - 500));

      const analysisResult = this.parseOpenAIResponse(response);
      
      // Add web search enhancement status to the response
      const webSearchStatus = {
        businessResearchSuccess: webSearchResults.status === 'fulfilled' && !!webSearchResults.value,
        keywordResearchSuccess: keywordResults.status === 'fulfilled' && !!keywordResults.value,
        enhancementComplete: (webSearchResults.status === 'fulfilled' && !!webSearchResults.value) || 
                           (keywordResults.status === 'fulfilled' && !!keywordResults.value)
      };
      
      return {
        ...analysisResult,
        webSearchStatus
      };
    } catch (error) {
      console.error('OpenAI website analysis error:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        status: error.status,
        code: error.code,
        type: error.type
      });
      throw new Error(`Failed to analyze website with AI: ${error.message}`);
    }
  }

  /**
   * Generate trending topics for a specific industry
   */
  async generateTrendingTopics(businessType, targetAudience, contentFocus) {
    try {
      // First, generate the topic ideas without images
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are a content strategist who creates blog topics optimized for search and user intent. You understand that readers search using specific keywords and phrases when looking for solutions to their problems.

CRITICAL PRINCIPLES:
1. SEO-OPTIMIZED: Focus on searchable keywords and clear value propositions that match what people actually search for
2. CLEAR & DIRECT: Titles should tell readers exactly what they'll learn using straightforward language
3. SEARCHABILITY: Use language people actually search for, not abstract concepts or academic phrasing
4. PRACTICAL VALUE: Promise specific, actionable outcomes that solve real problems`
          },
          {
            role: 'user',
            content: `Generate 2 strategic blog post topics for this business that promise genuinely insightful content:

Business Analysis:
- Business Type: ${businessType}
- Target Audience: ${targetAudience}
- Content Focus: ${contentFocus}

TOPIC QUALITY REQUIREMENTS:

1. SEARCH-OPTIMIZED: Use keywords and phrases that people actually type into search engines when looking for solutions.

2. CLEAR VALUE: Make it immediately obvious what specific benefit or solution the reader will get from the article.

3. SPECIFIC FOCUS: Address concrete problems or questions with actionable answers, not broad conceptual overviews.

4. NATURAL LANGUAGE: Use conversational, everyday language that real people use when describing their problems.

For each topic, provide:
{
  "id": number,
  "trend": "string - content theme/topic area using searchable keywords",
  "title": "string - clear, SEO-friendly title using searchable keywords (e.g., 'How to Manage Postpartum Depression' not 'The Paradox of Maternal Mental Health')",
  "subheader": "string - subtitle that clarifies the specific problem solved and target audience",
  "seoBenefit": "string - specific value like 'Can help [audience] find answers when they search for [actual search terms they use]'",
  "category": "string - content category using common search terms"
}

AVOID:
- Abstract or philosophical language (e.g., "The Paradox of...", "Navigating the Complexity of...")
- Excessive use of colons or clever wordplay in titles
- Vague promises that don't specify what the reader will learn
- Academic or overly formal language that people don't search for

CREATE:
- Direct, searchable titles that match common search queries
- Specific problem statements that readers can immediately relate to
- Clear benefit statements using action words (How to, Ways to, Steps to, Guide to)
- Language that sounds like something a real person would type into Google

Return an array of 2 SEO-optimized topics that address real search intent with clear value.`
          }
        ],
        temperature: 0.7,
        max_tokens: 1500
      });

      const response = completion.choices[0].message.content;
      const topics = this.parseOpenAIResponse(response);

      // Generate DALL-E images for all topics (now only 2)
      console.log('Generating DALL-E images for all topics');
      const dalleLimit = topics.length;
      
      for (let i = 0; i < dalleLimit; i++) {
        console.log(`Generating DALL-E image ${i + 1}/${dalleLimit} for topic: ${topics[i].title}`);
        topics[i].image = await this.generateTopicImage(topics[i]);
      }
      
      // All topics now have DALL-E images

      return topics;
    } catch (error) {
      console.error('OpenAI trending topics error:', error);
      throw new Error('Failed to generate trending topics with AI');
    }
  }

  /**
   * Generate blog post content
   */
  async generateBlogPost(topic, businessInfo, additionalInstructions = '') {
    const startTime = Date.now();
    const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
    
    try {
      // Log request details for analysis
      const requestPayload = {
        topic: topic,
        businessInfo: businessInfo,
        additionalInstructions: additionalInstructions
      };
      
      const payloadSize = JSON.stringify(requestPayload).length;
      
      console.log('🚀 BLOG GENERATION REQUEST START');
      console.log('📊 Request Metrics:', {
        model: model,
        payloadSizeBytes: payloadSize,
        payloadSizeKB: Math.round(payloadSize / 1024 * 100) / 100,
        estimatedTokens: Math.round(payloadSize / 4), // Rough token estimate (1 token ≈ 4 chars)
        topicTitle: topic.title,
        topicSubheader: topic.subheader,
        businessType: businessInfo.businessType,
        hasEnhancedData: !!(businessInfo.scenarios && businessInfo.scenarios.length > 0),
        scenarioCount: businessInfo.scenarios?.length || 0,
        additionalInstructionsLength: additionalInstructions?.length || 0,
        timestamp: new Date().toISOString()
      });
      
      // Log key components of the request
      console.log('🔍 Request Components:', {
        topicKeys: Object.keys(topic),
        businessInfoKeys: Object.keys(businessInfo),
        hasScenarios: !!(businessInfo.scenarios && businessInfo.scenarios.length > 0),
        scenariosLength: businessInfo.scenarios ? JSON.stringify(businessInfo.scenarios).length : 0
      });

      const completion = await openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content: `You are an expert content strategist who creates genuinely insightful, empathetic blog posts that provide real value. You understand that readers' time is precious and every piece of content must earn their attention through depth, originality, and emotional connection.

CRITICAL REQUIREMENTS:
1. FACTUAL ACCURACY: Never fabricate statistics, studies, case studies, or personal stories. Work only with established knowledge and general principles.
2. ANALYTICAL DEPTH: Provide unique insights through analysis and synthesis of existing knowledge, not generic advice.
3. EMOTIONAL INTELLIGENCE: Demonstrate deep understanding of the reader's lived experience and emotional reality.
4. ORIGINALITY: Avoid predictable templates. Create content that makes readers think "I never thought of it that way" or "This person really understands my situation."
5. CTA INTEGRITY: ONLY use CTAs explicitly provided in the "AVAILABLE CTAS" section. Use the EXACT href URLs - never modify or generate new ones. Place CTAs naturally where they enhance content, not randomly. If no CTAs are provided, do NOT create any - just informational content. NEVER generate placeholder URLs like "yourwebsite.com" or "example.com". Better to have no CTA than a fake/placeholder CTA.`
          },
          {
            role: 'user',
            content: `Write a complete blog post with the following specifications:

Topic: ${topic.title}
Subtitle: ${topic.subheader}
Business Type: ${businessInfo.businessType}
Target Audience: ${businessInfo.targetAudience}
Brand Voice: ${businessInfo.brandVoice}
Content Focus: ${businessInfo.contentFocus}

Additional Instructions: ${additionalInstructions}

CONTENT QUALITY STANDARDS:

1. EMPATHY & RELATABILITY:
   - Begin by acknowledging the specific emotional reality of this problem
   - Validate why this situation is genuinely difficult (don't minimize it)
   - Address the gap between "knowing what to do" and "being able to do it"
   - Show understanding of practical and emotional barriers

2. ANALYTICAL DEPTH (NO FABRICATION):
   - Provide unique analytical frameworks for understanding the problem
   - Synthesize existing knowledge in novel ways
   - Offer contrarian but defensible perspectives where appropriate
   - Connect concepts from different areas to create fresh insights
   - Focus on WHY things work, not just WHAT to do

3. FACTUAL ACCURACY:
   - NO fabricated statistics, research citations, or case studies
   - NO invented personal stories or testimonials
   - Stay within bounds of established general knowledge
   - Present analysis and insights, not speculation as fact

4. STRUCTURE & VALUE:
   - Avoid predictable listicle formats
   - Create content that justifies the reader's time investment
   - Make every paragraph provide genuine insight or understanding
   - End with perspective that shifts how readers think about the topic

Please provide a JSON response with:
{
  "title": "string - SEO-optimized title that promises genuine insight",
  "subtitle": "string - compelling subtitle that sets up unique perspective",
  "metaDescription": "string - SEO meta description emphasizing insight/understanding (150-160 chars)",
  "content": "string - full blog post content in markdown format meeting all quality standards",
  "tags": ["array", "of", "relevant", "tags"],
  "estimatedReadTime": "string - reading time estimate",
  "seoKeywords": ["array", "of", "SEO", "keywords"]
}

CRITICAL JSON FORMATTING REQUIREMENTS:
- Return valid JSON that can be parsed by standard JSON.parse()
- In the "content" field, escape all newlines as \\n (double backslash followed by n)
- Escape all quotes within content as \\" 
- Do not include literal line breaks within any JSON string values
- Ensure all string values are properly quoted and escaped

The content should be 1000-1500 words and demonstrate expertise through empathy, insight, and analytical depth - not generic advice recycling.`
          }
        ],
        temperature: 0.7,
        max_tokens: 2500
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Log successful completion metrics
      console.log('✅ BLOG GENERATION SUCCESS');
      console.log('📈 Success Metrics:', {
        durationMs: duration,
        durationSeconds: Math.round(duration / 1000 * 100) / 100,
        inputTokens: completion.usage?.prompt_tokens || 'unknown',
        outputTokens: completion.usage?.completion_tokens || 'unknown',
        totalTokens: completion.usage?.total_tokens || 'unknown',
        model: model,
        finishReason: completion.choices[0]?.finish_reason || 'unknown',
        timestamp: new Date().toISOString()
      });

      const response = completion.choices[0].message.content;
      
      // Log the raw response for debugging
      console.log('✅ OpenAI API call successful, parsing response...');
      console.log('📄 Raw Response Length:', response?.length || 0);
      console.log('📄 Raw Response Preview (first 500 chars):', response?.substring(0, 500));
      console.log('📄 Raw Response End (last 200 chars):', response?.substring(response.length - 200));
      
      return this.parseOpenAIResponse(response);
    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.error('❌ BLOG GENERATION FAILED');
      console.error('🔍 Comprehensive Error Analysis:', {
        // Basic error info
        errorType: error.constructor.name,
        errorName: error.name,
        errorMessage: error.message,
        errorCode: error.code,
        errorStatus: error.status,
        errorType: error.type,
        
        // OpenAI specific error details
        openaiError: error.error,
        openaiErrorType: error.error?.type,
        openaiErrorCode: error.error?.code,
        openaiErrorParam: error.error?.param,
        
        // Full error object for debugging
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        
        // Request context
        durationMs: duration,
        durationSeconds: Math.round(duration / 1000 * 100) / 100,
        model: model,
        requestSize: JSON.stringify({ topic, businessInfo, additionalInstructions }).length,
        estimatedTokens: Math.round(JSON.stringify({ topic, businessInfo, additionalInstructions }).length / 4),
        timestamp: new Date().toISOString()
      });
      
      // Log the actual request that failed (truncated for readability)
      console.error('📤 Failed Request Details:', {
        topicTitle: topic?.title,
        businessType: businessInfo?.businessType,
        targetAudience: businessInfo?.targetAudience,
        scenarioCount: businessInfo?.scenarios?.length || 0,
        additionalInstructionsLength: additionalInstructions?.length || 0
      });
      
      // Check for specific error types to provide better error messages
      let specificErrorMessage = 'Failed to generate blog content with AI';
      
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        specificErrorMessage = 'Request timed out - content generation took too long';
      } else if (error.status === 429) {
        specificErrorMessage = 'Rate limit exceeded - too many requests to OpenAI API';
      } else if (error.code === 'context_length_exceeded') {
        specificErrorMessage = 'Content too long - request exceeded token limits';
      } else if (error.status === 500) {
        specificErrorMessage = 'OpenAI server error - temporary issue with AI service';
      } else if (error.status === 503) {
        specificErrorMessage = 'OpenAI service unavailable - server overloaded';
      }
      
      console.error('📤 Error Message to Client:', specificErrorMessage);
      throw new Error(specificErrorMessage);
    }
  }

  /**
   * Generate export content in different formats
   */
  async generateExportContent(blogPost, format) {
    try {
      let prompt = '';
      
      switch (format.toLowerCase()) {
        case 'markdown':
          prompt = `Convert this blog post to clean markdown format:
Title: ${blogPost.title}
Content: ${blogPost.content}

Return only the markdown content, properly formatted.`;
          break;
          
        case 'html':
          prompt = `Convert this blog post to clean HTML format:
Title: ${blogPost.title}
Content: ${blogPost.content}

Return a complete HTML document with proper structure, meta tags, and styling.`;
          break;
          
        case 'json':
          return JSON.stringify(blogPost, null, 2);
          
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }

      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a content formatter that converts blog posts to different formats while maintaining quality and structure.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 2000
      });

      return completion.choices[0].message.content;
    } catch (error) {
      console.error('OpenAI export generation error:', error);
      throw new Error('Failed to generate export content with AI');
    }
  }

  /**
   * Generate image using DALL-E for blog topics
   */
  async generateTopicImage(topic) {
    try {
      console.log('Generating DALL-E image for topic:', topic.title);
      
      // Create a descriptive prompt for realistic blog header image
      const prompt = `Create a high-quality, realistic image for the blog post: "${topic.title}". 
      
      Style: Professional photography, sharp focus, excellent lighting
      Quality: Ultra-high resolution, magazine quality, commercial photography
      Composition: Clean, modern, suitable for blog header use
      Colors: Vibrant but professional color palette
      Requirements: No text, no people's faces, realistic style only
      
      The image should look like a professional stock photo that perfectly represents the topic.`;

      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: prompt,
        size: "1024x1024",
        quality: "standard",
        n: 1,
      });

      console.log('DALL-E image generated successfully');
      return response.data[0].url;
      
    } catch (error) {
      console.error('DALL-E image generation error:', error);
      
      // Fallback to a placeholder image if DALL-E fails
      const fallbackUrl = `https://via.placeholder.com/400x250/6B8CAE/FFFFFF?text=${encodeURIComponent(topic.title.substring(0, 30))}`;
      console.log('Using fallback image:', fallbackUrl);
      return fallbackUrl;
    }
  }

  /**
   * Perform web search-enhanced business research
   */
  async performBusinessResearch(businessName, businessType, websiteUrl) {
    console.log('🔍 performBusinessResearch() called with:', {
      businessName,
      businessType,
      websiteUrl
    });
    
    try {
      console.log('Starting web search-enhanced business research...');
      
      // Try OpenAI Responses API with web search first
      console.log('Attempting OpenAI Responses API call...');
      try {
        const response = await openai.responses.create({
          model: "gpt-4o",
          tools: [{
            type: "web_search",
            filters: {
              // Focus on business-relevant domains for better results
              allowed_domains: [
                businessName.toLowerCase().replace(/\s+/g, '') + '.com',
                'linkedin.com',
                'facebook.com',
                'instagram.com',
                'twitter.com',
                'crunchbase.com',
                'glassdoor.com',
                'yelp.com',
                'google.com',
                'better-business-bureau.org',
                'chamber-of-commerce.org'
              ].filter(domain => domain !== '.com') // Remove empty business name domains
            }
          }],
          input: `Research comprehensive business intelligence for: ${businessName} (${businessType}) - Website: ${websiteUrl}

          RESEARCH OBJECTIVES:
          1. BRAND IDENTITY & COLORS: Find actual brand colors and marketing materials
          2. COMPETITIVE ANALYSIS: Research competitors and market positioning  
          3. CUSTOMER INTELLIGENCE: Analyze reviews and customer language patterns
          4. BUSINESS CREDIBILITY: Find news, achievements, and context

          Provide specific findings for business strategy ranking and target audience analysis.`
        });

        console.log('OpenAI Responses API with web search successful');
        return response.output_text || response.output;
        
      } catch (responsesError) {
        console.error('🚨 OpenAI Responses API failed:');
        console.error('Error name:', responsesError.name);
        console.error('Error message:', responsesError.message);
        console.error('Error code:', responsesError.code);
        console.error('Full error:', responsesError);
        return null;
      }
      
    } catch (error) {
      console.error('All business research methods failed:', error);
      console.log('Continuing with basic analysis only');
      return null;
    }
  }

  /**
   * Analyze content changes and generate a summary of what changed
   */
  async analyzeContentChanges(previousContent, newContent, customFeedback = '') {
    try {
      console.log('Starting AI content change analysis...');
      
      const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
      
      const completion = await openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content: `You are an expert content analyst who identifies conceptual changes between two versions of content. You focus on meaningful improvements and changes that matter to readers, not superficial text differences.

ANALYSIS APPROACH:
- Focus on conceptual and structural changes, not word-for-word differences
- Identify improvements in tone, clarity, depth, examples, structure, etc.
- Explain changes in terms that content creators and readers would care about
- Be specific and actionable in your descriptions

CRITICAL REQUIREMENTS:
- Return valid JSON that can be parsed
- Provide 3-5 key changes maximum
- Each change should be a clear, specific insight
- Avoid generic statements like "content was improved"
- Focus on what actually matters to the reader experience`
          },
          {
            role: 'user',
            content: `Analyze the changes between these two versions of content and explain what conceptually changed:

ORIGINAL CONTENT:
${previousContent}

NEW CONTENT:
${newContent}

${customFeedback ? `USER FEEDBACK APPLIED: ${customFeedback}` : ''}

Provide a JSON response with this exact structure:
{
  "summary": "Brief 1-2 sentence summary of the overall changes",
  "keyChanges": [
    {
      "change": "Specific description of what changed (e.g., 'Made the writing more conversational and approachable')",
      "impact": "Why this change matters to readers (e.g., 'Easier to understand for beginners')"
    }
  ],
  "feedbackApplied": "How the user's feedback was implemented (if any feedback was provided)"
}`
          }
        ],
        temperature: 0.3,
        max_tokens: 800
      });

      const response = completion.choices[0].message.content;
      console.log('AI change analysis completed successfully');
      
      return this.parseOpenAIResponse(response);
    } catch (error) {
      console.error('OpenAI content change analysis error:', error);
      throw new Error(`Failed to analyze content changes: ${error.message}`);
    }
  }

  /**
   * Perform keyword and SEO research using web search
   */
  async performKeywordResearch(businessType, targetAudience, location = null) {
    console.log('📊 performKeywordResearch() called with:', {
      businessType,
      targetAudience,
      location
    });
    
    try {
      console.log('Starting web search-enhanced keyword research...');
      
      const locationFilter = location ? `, location: ${location}` : '';
      
      // Try web search first
      try {
        const response = await openai.responses.create({
          model: "gpt-4o",
          tools: [{
            type: "web_search",
            filters: {
              // Focus on SEO and marketing research domains
              allowed_domains: [
                'semrush.com',
                'ahrefs.com',
                'moz.com',
                'google.com',
                'searchenginejournal.com',
                'reddit.com',
                'quora.com',
                'answerthepublic.com',
                'ubersuggest.com'
              ]
            }
          }],
          input: `Research keyword opportunities for: ${businessType} targeting ${targetAudience}${locationFilter}

          PRIORITY RESEARCH:
          1. Search volume estimates for customer problems
          2. Competition analysis and content gaps  
          3. Customer problem prioritization by business value
          4. Conversion potential analysis

          Provide business value ranking for different customer problems with search volume and competition data.`
        });

        console.log('Web search keyword research successful');
        return response.output_text || response.output;
        
      } catch (responsesError) {
        console.log('Web search keyword research not available:', responsesError.message);
        return null;
      }
      
    } catch (error) {
      console.error('All keyword research methods failed:', error);
      console.log('Continuing without keyword enhancement');
      return null;
    }
  }
}

export default new OpenAIService();