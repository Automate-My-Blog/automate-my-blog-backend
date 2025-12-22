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
   * Clean OpenAI response by removing markdown code blocks and parsing JSON
   */
  parseOpenAIResponse(response) {
    try {
      // Log the raw response for debugging
      console.log('Raw OpenAI response:', response);
      
      // Remove markdown code blocks if present
      let cleanedResponse = response.trim();
      
      // Remove ```json at the beginning and ``` at the end
      if (cleanedResponse.startsWith('```json')) {
        cleanedResponse = cleanedResponse.substring(7);
      } else if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.substring(3);
      }
      
      if (cleanedResponse.endsWith('```')) {
        cleanedResponse = cleanedResponse.slice(0, -3);
      }
      
      // Trim whitespace
      cleanedResponse = cleanedResponse.trim();
      
      // OpenAI responses are already valid JSON, no need for control character fixes
      
      console.log('Cleaned response:', cleanedResponse);
      
      // Parse JSON
      return JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('JSON parsing failed:', parseError);
      console.error('Attempted to parse:', response);
      
      // Try parsing the original response as a fallback
      try {
        return JSON.parse(response);
      } catch (fallbackError) {
        throw new Error(`Failed to parse OpenAI response as JSON: ${parseError.message}`);
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
        max_tokens: 3000
      });

      console.log('OpenAI request completed successfully');
      console.log('Response choices:', completion.choices?.length || 0);
      
      const response = completion.choices[0].message.content;
      console.log('Response content length:', response?.length || 0);
      
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
            content: `You are a content strategist who creates blog topics that provide genuine insight and value, not generic content. You understand that readers are overwhelmed by surface-level advice and crave depth, empathy, and fresh perspectives. Your topics promise content that will make readers think differently about their problems.

CRITICAL PRINCIPLES:
1. INSIGHT-DRIVEN: Topics must promise unique analytical perspectives, not generic advice recycling
2. EMOTIONALLY INTELLIGENT: Topics acknowledge the real emotional complexity of audience problems
3. CONTRARIAN THINKING: When appropriate, challenge conventional wisdom with defensible alternative viewpoints
4. DEPTH OVER BREADTH: Focus on deep understanding of specific problems rather than broad overviews`
          },
          {
            role: 'user',
            content: `Generate 2 strategic blog post topics for this business that promise genuinely insightful content:

Business Analysis:
- Business Type: ${businessType}
- Target Audience: ${targetAudience}
- Content Focus: ${contentFocus}

TOPIC QUALITY REQUIREMENTS:

1. INSIGHT PROMISE: Each topic must promise to provide a unique perspective, analytical framework, or counter-intuitive insight that goes beyond obvious advice.

2. EMOTIONAL RESONANCE: Topics should acknowledge the specific emotional reality and practical barriers the target audience faces.

3. DEPTH FOCUS: Avoid broad overview topics. Focus on specific, nuanced aspects of problems that deserve deep exploration.

4. VALUE DIFFERENTIATION: Each topic should promise content that will be genuinely different from what readers can find elsewhere.

For each topic, provide:
{
  "id": number,
  "trend": "string - content theme/topic area that suggests depth",
  "title": "string - title that promises genuine insight or fresh perspective (not generic advice)",
  "subheader": "string - subtitle that acknowledges emotional reality and promises analytical depth",
  "seoBenefit": "string - specific value like 'Can help [audience] understand [complex aspect] of [their situation] when they search for [specific insight-focused terms]'",
  "category": "string - content category emphasizing analytical depth"
}

AVOID:
- Generic "how-to" topics that rehash obvious advice
- Broad overview topics that stay surface-level
- Titles that promise simple solutions to complex problems
- Topics that ignore the emotional/psychological aspects

CREATE:
- Topics that promise to explain WHY things work the way they do
- Titles that suggest contrarian or counter-intuitive insights
- Content angles that acknowledge complexity rather than oversimplify
- Topics that demonstrate deep understanding of audience psychology

Return an array of 2 strategic topics that promise genuinely valuable, insight-driven content.`
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
4. ORIGINALITY: Avoid predictable templates. Create content that makes readers think "I never thought of it that way" or "This person really understands my situation."`
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
          model: "gpt-4o-mini",
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
          model: "gpt-4o-mini",
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