import OpenAI from 'openai';
import dotenv from 'dotenv';
import analyticsService from './analytics.js';
import { getWebsiteAnalysisSystemMessage, buildWebsiteAnalysisUserMessage } from '../prompts/index.js';
import streamManager from './stream-manager.js';

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
   * Analyze website content and extract business information.
   * @param {string} websiteContent - Scraped page text
   * @param {string} url - Page URL
   * @param {{ onProgress?: (phase: string) => void }} [opts] - Optional progress callback for granular sub-steps (e.g. "Researching business (brand & competitors)", "Researching keywords & SEO", "Analyzing business from content")
   */
  async analyzeWebsite(websiteContent, url, opts = {}) {
    const { onProgress } = opts;
    const report = (phase) => { if (typeof onProgress === 'function') try { onProgress(phase); } catch (e) { /* noop */ } };

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

      // Perform web search-enhanced research in parallel (faster); report granular phase as each completes
      const skipWebResearch = /^(1|true|yes)$/i.test(process.env.SKIP_WEBSITE_WEB_RESEARCH || '');
      let webSearchData = '';
      let keywordData = '';
      let webSearchResults = { status: 'rejected', value: null };
      let keywordResults = { status: 'rejected', value: null };

      if (skipWebResearch) {
        console.log('⏭️ Skipping web search research (SKIP_WEBSITE_WEB_RESEARCH=true), using scraped content only');
      } else {
        const researchTimeoutMs = Math.max(0, parseInt(process.env.WEBSITE_WEB_RESEARCH_TIMEOUT_MS || '0', 10)) || null;
        const withTimeout = (promise, label) => {
          if (!researchTimeoutMs) return promise;
          return Promise.race([
            promise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`${label} timed out after ${researchTimeoutMs}ms`)), researchTimeoutMs)
            )
          ]);
        };

        report('Researching business (brand & competitors)');
        report('Researching keywords & SEO');
        console.log('=== STARTING WEB SEARCH RESEARCH (parallel) ===');

        const businessPromise = withTimeout(this.performBusinessResearch(businessName, businessType, url), 'Business research')
          .then((v) => { report('Researching business (brand & competitors)'); return { status: 'fulfilled', value: v }; })
          .catch((e) => { console.error('Business Research Error:', e?.message || e); return { status: 'rejected', value: null }; });
        const keywordPromise = withTimeout(this.performKeywordResearch(businessType, 'target customers', null), 'Keyword research')
          .then((v) => { report('Researching keywords & SEO'); return { status: 'fulfilled', value: v }; })
          .catch((e) => { console.error('Keyword Research Error:', e?.message || e); return { status: 'rejected', value: null }; });

        [webSearchResults, keywordResults] = await Promise.all([businessPromise, keywordPromise]);

        if (webSearchResults.status === 'fulfilled' && webSearchResults.value) {
          webSearchData = `\n\nWEB SEARCH BUSINESS INTELLIGENCE:\n${webSearchResults.value}`;
          console.log('✅ Web search business research completed');
        }
        if (keywordResults.status === 'fulfilled' && keywordResults.value) {
          keywordData = `\n\nKEYWORD & SEO RESEARCH:\n${keywordResults.value}`;
          console.log('✅ Keyword research completed');
        }
      }

      report('Analyzing business from content');
      const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
      console.log('Using OpenAI model for final analysis:', model);

      const analyzeCompletionTimeoutMs = Math.max(15000, parseInt(process.env.OPENAI_ANALYZE_WEBSITE_TIMEOUT_MS || '90000', 10));
      const completionPromise = openai.chat.completions.create({
        model: model,
        messages: [
          { role: 'system', content: getWebsiteAnalysisSystemMessage() },
          { role: 'user', content: buildWebsiteAnalysisUserMessage({ url, websiteContent, webSearchData, keywordData }) }
        ],
        temperature: 0.3,
        max_tokens: 2000  // Basic business analysis only (scenarios generated separately)
      });
      const completion = await Promise.race([
        completionPromise,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`OpenAI website analysis timed out after ${analyzeCompletionTimeoutMs}ms`)),
            analyzeCompletionTimeoutMs
          )
        )
      ]);

      console.log('OpenAI request completed successfully');
      console.log('Response choices:', completion.choices?.length || 0);

      // CRITICAL: Check for response truncation
      const finishReason = completion.choices[0].finish_reason;
      console.log('🔍 Website Analysis completion details:', {
        finish_reason: finishReason,
        prompt_tokens: completion.usage?.prompt_tokens,
        completion_tokens: completion.usage?.completion_tokens,
        total_tokens: completion.usage?.total_tokens,
        max_tokens_limit: 2000
      });

      if (finishReason === 'length') {
        console.error('❌ TRUNCATION ERROR: Website analysis response was cut off due to max_tokens limit');
        console.error('📊 Token usage:', {
          used: completion.usage?.completion_tokens,
          limit: 2000,
          overflow: completion.usage?.completion_tokens - 2000
        });
        throw new Error('Website analysis response truncated - increase max_tokens to at least ' + (completion.usage?.completion_tokens + 500));
      }

      if (finishReason !== 'stop') {
        console.warn('⚠️ Unusual finish_reason:', finishReason);
      }

      const response = completion.choices[0].message.content;
      console.log('Response content length:', response?.length || 0);
      console.log('📄 First 500 chars of response:', response?.substring(0, 500));
      console.log('📄 Last 500 chars of response:', response?.substring(response.length - 500));

      const analysisResult = this.parseOpenAIResponse(response);
      
      // Add web search enhancement status to the response (webSearchResults/keywordResults are { status, value } when research ran)
      const webSearchStatus = {
        businessResearchSuccess: webSearchResults?.status === 'fulfilled' && !!webSearchResults?.value,
        keywordResearchSuccess: keywordResults?.status === 'fulfilled' && !!keywordResults?.value,
        enhancementComplete: (webSearchResults?.status === 'fulfilled' && !!webSearchResults?.value) ||
                             (keywordResults?.status === 'fulfilled' && !!keywordResults?.value)
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
   * Generate narrative analysis from website analysis data.
   * Returns a short opening statement (1-2 sentences, max 140 chars) plus 4-6 insight cards for the frontend.
   */
  async generateWebsiteAnalysisNarrative(analysisData, intelligenceData, ctaData) {
    console.log('📝 [NARRATIVE-GEN] Starting narrative generation (opening + insight cards)');
    console.log('📝 [NARRATIVE-GEN] Business:', analysisData.businessName);
    console.log('📝 [NARRATIVE-GEN] Type:', analysisData.businessType);

    const businessName = analysisData.businessName || 'this business';
    const businessType = analysisData.businessType || 'Not specified';
    const orgDescription = analysisData.description || 'Not provided';
    const scenariosRaw = intelligenceData.customer_scenarios;
    const scenarioCount = Array.isArray(scenariosRaw)
      ? scenariosRaw.length
      : (typeof scenariosRaw === 'string' ? (() => { try { const a = JSON.parse(scenariosRaw); return Array.isArray(a) ? a.length : 0; } catch { return 0; } })() : 0);
    const keyInsightsSnippet = intelligenceData.business_value_assessment
      ? String(intelligenceData.business_value_assessment).substring(0, 100)
      : (intelligenceData.content_strategy_recommendations ? String(intelligenceData.content_strategy_recommendations).substring(0, 100) : 'Multiple patterns');

    const openingPrompt = `You are a business consultant presenting analysis findings. This is PART 1 of a 3-part presentation.

Business: ${businessName}
Type: ${businessType}
Description: ${orgDescription}

Analysis:
- ${scenarioCount} customer scenarios identified
- Key insights: ${keyInsightsSnippet}

Write a direct opening statement (1-2 sentences, max 140 chars) that:
- States what you LEARNED about THEIR BUSINESS (positioning, brand, focus areas)
- NOT what customers want - focus on the business itself
- Be specific about their business model, positioning, or value proposition
- Professional consultant tone - NO quotes, NO exclamation marks, NO flowery language
- Use simple present tense: "I analyzed X and learned Y"

WRONG: "I found that Safety Managers seek immediate solutions" (talks about customers)
RIGHT: "I analyzed ${businessName} and learned you're a premium ${businessType} positioned as [specific positioning], focusing on [specific solutions]."

Be factual and direct. This leads into showing them the audience segments next.`;

    let openingStatement = '';
    try {
      const openingCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: openingPrompt }],
        max_tokens: 120,
        temperature: 0.7
      });
      openingStatement = (openingCompletion.choices[0]?.message?.content?.trim() || '').replace(/^["']|["']$/g, '');
      console.log('📝 [NARRATIVE-GEN] Opening statement:', openingStatement.substring(0, 80) + (openingStatement.length > 80 ? '...' : ''));
    } catch (e) {
      console.warn('⚠️ [NARRATIVE-GEN] Opening statement failed, using fallback:', e?.message);
      openingStatement = `I analyzed ${businessName} and learned you're a ${businessType} focused on ${orgDescription.substring(0, 50)}${orgDescription.length > 50 ? '...' : ''}.`;
    }

    const prompt = `You are an insightful business consultant who just deeply analyzed ${analysisData.businessName} (${analysisData.businessType}). Generate 4-6 insight cards that demonstrate deep understanding of their business and build trust with the user.

**DESIGN PRINCIPLES:**
1. INSIGHT OVER OBSERVATION - Go beyond obvious facts to reveal meaningful patterns
2. SPECIFIC OVER GENERIC - Use concrete details, not vague generalities
3. VALUE OVER PROCESS - Focus on implications, not just what you found
4. FORWARD-LOOKING OVER BACKWARD-LOOKING - Show opportunities, not just current state

**Business Context:**
- Name: ${analysisData.businessName}
- Type: ${analysisData.businessType}
- Description: ${analysisData.description}
- Business Model: ${analysisData.businessModel}
- Website Goals: ${analysisData.websiteGoals}

**Customer Intelligence:**
- Decision Makers: ${analysisData.decisionMakers}
- End Users: ${analysisData.endUsers}
- Search Behavior: ${analysisData.searchBehavior}
- Content Focus: ${analysisData.contentFocus}
${intelligenceData.customer_language_patterns ? `- Customer Language: ${JSON.stringify(intelligenceData.customer_language_patterns)}` : ''}
${intelligenceData.customer_scenarios ? `- Customer Scenarios: ${JSON.stringify(intelligenceData.customer_scenarios)}` : ''}

**Website & Conversion:**
- Blog Strategy: ${analysisData.blogStrategy}
${ctaData && ctaData.length > 0 ? `- CTAs Found: ${ctaData.map(c => c.cta_text ?? c.text ?? '').filter(Boolean).join(', ')}` : ''}

**Strategic Findings:**
${intelligenceData.seo_opportunities ? `- SEO Opportunities: ${intelligenceData.seo_opportunities}` : ''}
${intelligenceData.content_strategy_recommendations ? `- Content Recommendations: ${intelligenceData.content_strategy_recommendations}` : ''}
${intelligenceData.business_value_assessment ? `- Value Assessment: ${intelligenceData.business_value_assessment}` : ''}

**CARD CATEGORIES TO CHOOSE FROM:**
- Customer Psychology - Why customers choose them, emotional drivers, pain points
- Market Positioning - Where they fit in their industry, competitive differentiation
- Search Behavior - How customers find them, search intent, decision triggers
- Competitive Advantage - What makes them unique, strengths to leverage
- Content Gap - Opportunities to address unmet customer needs
- Opportunity Preview - High-value audiences or content opportunities identified

**EACH CARD MUST HAVE:**
1. **Category** - One of the categories above
2. **Heading** - Short, compelling title (3-6 words)
3. **Body** - 2-3 sentences showing deep insight (not obvious observations)
4. **Takeaway** - One sentence implication or "so what" (starts with context like "Trust factor:", "Competitive advantage:", "Opportunity:", etc.)

**GOOD EXAMPLES:**
{
  "category": "Customer Psychology",
  "heading": "Your Patients Seek Specialized Care",
  "body": "Patients arrive after feeling dismissed by general practitioners. Your specialized focus on reproductive psychiatry directly addresses their search for someone who truly understands the complexity of hormonal and emotional challenges combined.",
  "takeaway": "Trust factor: Specialization beats general care for this vulnerable audience"
}

{
  "category": "Market Positioning",
  "heading": "You Bridge Two Worlds",
  "body": "You occupy a unique niche between general psychiatry (too broad) and fertility clinics (not mental health focused). Most providers stay in their lane—you're one of the few who understand both the reproductive and psychological dimensions.",
  "takeaway": "Competitive advantage: Few providers can speak to both aspects of their journey"
}

**BAD EXAMPLES (avoid these):**
- "You are a psychiatry practice" (too obvious)
- "Your website has a professional appearance" (generic)
- "We analyzed your homepage structure" (process, not insight)
- "You serve healthcare consumers" (vague)

Format as JSON:
{
  "cards": [
    {
      "category": "Category Name",
      "heading": "Card Heading",
      "body": "2-3 sentences of deep insight about their business.",
      "takeaway": "Context: One sentence implication"
    }
  ],
  "confidence": <0-1 score based on data quality>
}`;

    console.log('📝 [NARRATIVE-GEN] Prompt length:', prompt.length);

    try {
      const systemMessage = 'You are an insightful business consultant who demonstrates understanding through specific, valuable insights. Show that you truly understand their business, their customers, and their opportunities. Be confident but not arrogant. Be specific, not generic. Focus on forward-looking implications, not just observations.';

      console.log('📝 [NARRATIVE-GEN] System message:', systemMessage);
      console.log('📝 [NARRATIVE-GEN] Model: gpt-4o');
      console.log('📝 [NARRATIVE-GEN] Response format: JSON');
      console.log('📝 [NARRATIVE-GEN] Calling OpenAI API...');

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: systemMessage
          },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.6
      });

      console.log('📝 [NARRATIVE-GEN] OpenAI response received');

      const result = JSON.parse(completion.choices[0].message.content);

      console.log('📝 [NARRATIVE-GEN] Generated', result.cards?.length, 'insight cards');
      console.log('📝 [NARRATIVE-GEN] Confidence:', result.confidence);

      const cards = result.cards || [];
      return {
        narrative: openingStatement,
        cards,
        confidence: result.confidence || 0.8,
        keyInsights: cards,
        isAIGenerated: true
      };

    } catch (error) {
      console.error('❌ Error generating insight cards:', error);

      const fallbackCards = [
        {
          category: 'Market Positioning',
          heading: 'Your Business Focus',
          body: `${analysisData.businessName} operates as a ${analysisData.businessType}. ${analysisData.description}`,
          takeaway: `Focus: Serving ${analysisData.endUsers} in this market`
        },
        {
          category: 'Search Behavior',
          heading: 'How Customers Find You',
          body: `Your customers search when ${analysisData.searchBehavior}. This represents a key moment in their decision-making process.`,
          takeaway: 'Opportunity: Content that addresses this search intent'
        }
      ];
      return {
        narrative: openingStatement || `I analyzed ${analysisData.businessName} and found ${scenarioCount} distinct customer scenarios.`,
        cards: fallbackCards,
        confidence: 0.5,
        keyInsights: fallbackCards,
        isAIGenerated: false
      };
    }
  }

  /**
   * Generate audience narrative - contextual transition from analysis to audiences
   * @param {object} analysisData - Business analysis data
   * @param {array} audiences - Generated audience segments
   * @returns {Promise<string>} Narrative text
   */
  async generateAudienceNarrative(analysisData, audiences) {
    console.log('📝 [AUDIENCE-NARRATIVE] Generating audience narrative');
    console.log('📝 [AUDIENCE-NARRATIVE] Business:', analysisData.businessName);
    console.log('📝 [AUDIENCE-NARRATIVE] Audiences:', audiences.length);

    const audienceList = audiences.slice(0, 3).map((a, i) =>
      `${i + 1}. ${a.audienceName || a.name}: ${a.description || a.scenario || ''}`
    ).join('\n');

    const prompt = `You just analyzed ${analysisData.businessName} and learned they are a ${analysisData.businessType}. ${analysisData.description}

Now you've identified ${audiences.length} audience segment${audiences.length > 1 ? 's' : ''} that could benefit from their ${analysisData.contentFocus || 'content'}:

${audienceList}

Write a 2-3 sentence narrative that:
1. References what you learned about ${analysisData.businessName} (be specific about their business)
2. Naturally transitions to introducing the audience segments you discovered
3. Shows how these audiences connect to what ${analysisData.businessName} offers

Be conversational, knowledgeable, and make it clear you understand their business context. Reference specific details from their analysis.

Example style: "Based on what we learned about [Business] being a [specific type] that [specific offering], I've identified [number] audience segments who are actively searching for [specific solution]. These audiences represent decision-makers and end-users who would benefit from [their specific value]."

Write ONLY the narrative text, no JSON or formatting.`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an AI assistant helping with content strategy. You demonstrate understanding by referencing specific details from the business analysis.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 150,
        temperature: 0.7
      });

      const narrative = completion.choices[0].message.content.trim();
      console.log('✅ [AUDIENCE-NARRATIVE] Generated:', narrative.substring(0, 100) + '...');
      return narrative;

    } catch (error) {
      console.error('❌ [AUDIENCE-NARRATIVE] Error:', error);
      // Fallback narrative
      return `Based on what we learned about ${analysisData.businessName}, I've identified ${audiences.length} audience segment${audiences.length > 1 ? 's' : ''} who would benefit from their ${analysisData.contentFocus || 'expertise'}. Each represents a unique opportunity to connect with decision-makers searching for solutions.`;
    }
  }

  /**
   * Generate topic narrative - contextual transition from audience to topics
   * @param {object} analysisData - Business analysis data
   * @param {object} selectedAudience - The audience segment user selected
   * @param {array} topics - Generated topic suggestions
   * @returns {Promise<string>} Narrative text
   */
  async generateTopicNarrative(analysisData, selectedAudience, topics) {
    console.log('📝 [TOPIC-NARRATIVE] Generating topic narrative');
    console.log('📝 [TOPIC-NARRATIVE] Business:', analysisData.businessName);
    console.log('📝 [TOPIC-NARRATIVE] Audience:', selectedAudience?.audienceName || selectedAudience?.name);
    console.log('📝 [TOPIC-NARRATIVE] Topics:', topics.length);

    const audienceName = selectedAudience?.audienceName || selectedAudience?.name || 'your target audience';
    const topicList = topics.slice(0, 3).map((t, i) =>
      `${i + 1}. ${t.title || t.topic}`
    ).join('\n');

    const prompt = `You're helping ${analysisData.businessName} (a ${analysisData.businessType}) create content for ${audienceName}.

The business offers: ${analysisData.description}
The audience: ${selectedAudience?.description || selectedAudience?.scenario || audienceName}

You've generated ${topics.length} topic ideas:
${topicList}

Write a 2-3 sentence narrative that:
1. References the specific audience segment they chose (${audienceName})
2. Shows how these topics address that audience's needs
3. Naturally transitions to having them select a topic

Be conversational and show you understand the connection between ${analysisData.businessName}'s offering, the audience's needs, and why these topics will resonate.

Example style: "Now that we've identified [specific audience], let's explore topics that address their needs. I've found [number] article ideas that directly speak to [audience challenge/need]. These topics will help position ${analysisData.businessName} as the solution they're searching for."

Write ONLY the narrative text, no JSON or formatting.`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an AI assistant helping with content strategy. You connect business offerings to audience needs through specific, relevant topics.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 150,
        temperature: 0.7
      });

      const narrative = completion.choices[0].message.content.trim();
      console.log('✅ [TOPIC-NARRATIVE] Generated:', narrative.substring(0, 100) + '...');
      return narrative;

    } catch (error) {
      console.error('❌ [TOPIC-NARRATIVE] Error:', error);
      // Fallback narrative
      return `Now that we've identified ${audienceName}, let's explore topics that will resonate with them. I've found ${topics.length} article ideas that address their specific needs and position ${analysisData.businessName} as the solution they're searching for.`;
    }
  }

  /**
   * Generate a brief conversational observation during scraping (Moment 1).
   * Used for narrative-driven streaming UX - "thinking out loud" observations.
   * @param {{ domain: string, initialContent: string }} context
   * @returns {Promise<string>} 1-2 sentence casual observation
   */
  async generateScrapingObservation(context) {
    const prompt = `You're an expert business analyst examining ${context.domain}.

You just saw: "${(context.initialContent || '').slice(0, 200)}"

React naturally with 1-2 casual, insightful observations. Show you understand their industry.
Examples: "Ok, auto dealership... competitive space." or "Hm, B2B SaaS... nice focus."

Be conversational, brief, and demonstrate genuine industry knowledge.`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a thoughtful business analyst thinking out loud.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 80,
      temperature: 0.8
    });

    return (response.choices[0]?.message?.content || '').trim();
  }

  /**
   * Generate a brief CTA observation during analysis (Moment 1).
   * @param {{ ctasFound: number, ctaTypes: string[] }} context
   * @returns {Promise<string>} 1-2 sentence casual observation
   */
  async generateCTAObservation(context) {
    const types = (context.ctaTypes || []).join(', ') || 'various';
    const prompt = `You found ${context.ctasFound} CTAs of types: ${types}.

React with a brief, casual observation about their conversion strategy.
Examples: "Found 3 CTAs... pretty standard - login, signup, demo" or "Only 1 CTA... might want more options"

Show genuine analysis, keep it conversational.`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a thoughtful business analyst thinking out loud.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 60,
      temperature: 0.8
    });

    return (response.choices[0]?.message?.content || '').trim();
  }

  /**
   * Generate a cleaned/suggested version of user-edited analysis fields (Issue #261).
   * Used for "Apply suggestion" in the guided funnel Edit flow.
   * @param {{ [key: string]: string }} editedFields - User-edited fields, e.g. { businessName, targetAudience, contentFocus }
   * @returns {Promise<{ [key: string]: string }>} LLM-cleaned suggested values for the same keys
   */
  async generateCleanedEdit(editedFields) {
    if (!editedFields || typeof editedFields !== 'object') {
      return {};
    }
    const entries = Object.entries(editedFields).filter(([, v]) => v != null && String(v).trim() !== '');
    if (entries.length === 0) return {};

    const prompt = `The user edited their website analysis. Clean and polish these values for professional use. Keep the same meaning and intent; fix typos, capitalization, and wording. Return ONLY a JSON object with the same keys and cleaned string values. No explanation.

User edits:
${JSON.stringify(Object.fromEntries(entries), null, 2)}

Respond with only valid JSON, e.g. {"businessName": "Acme Corp", "targetAudience": "Marketing directors at mid-size B2B companies"}`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: 'You return only valid JSON with the same keys as the user input and cleaned string values.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 500,
      temperature: 0.3
    });

    const text = (response.choices[0]?.message?.content || '').trim();
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) return {};
      const result = {};
      for (const key of Object.keys(editedFields)) {
        if (parsed[key] != null && typeof parsed[key] === 'string') {
          result[key] = parsed[key].trim();
        }
      }
      return result;
    } catch {
      return {};
    }
  }


  /**
   * Generate first-person content-generation-step narration for the guided funnel (Issue #261).
   * @param {{ businessName?: string, selectedTopic?: string }} context
   * @returns {Promise<string>} Short first-person paragraph
   */
  async generateContentGenerationNarration(context = {}) {
    const name = context.businessName || 'your business';
    const topic = context.selectedTopic || 'this topic';
    const prompt = `Write one short first-person paragraph (2-4 sentences) for an onboarding funnel. The narrator is the product (AI assistant). Say we're about to generate a blog post for ${name} on "${topic}". Be warm and concise. No markdown.`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: 'You write short, first-person onboarding copy. One paragraph only.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 150,
      temperature: 0.6
    });
    return (response.choices[0]?.message?.content || '').trim();
  }

  /**
   * Generate full analysis narrative as plain text for word-by-word streaming (Moment 2).
   * Active-listener snippets (echo back + brief reaction), separated by double paragraph breaks.
   * @param {object} data - Business analysis data
   * @returns {Promise<string>} Snippets separated by double paragraph breaks
   */
  async generateFullAnalysisNarrative(data) {
    const analysis = data.analysis || {};
    const prompt = `You just analyzed ${analysis.businessName || analysis.companyName || 'this business'} (${analysis.businessType || 'business'}).

Write 4-6 short snippets as an active listener: echo back what you learned and add a brief, natural reaction (e.g. "Oh, you're in the car industry. That's a big market." or "Your customers are searching when they're comparing—good moment to show up."). Separate each snippet with a double paragraph break (two newlines). No section headers. Warm and concise.

Business data:
${JSON.stringify(data, null, 2).slice(0, 3000)}`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are an expert business consultant presenting analysis findings.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 800,
      temperature: 0.7
    });

    return (response.choices[0]?.message?.content || '').trim();
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

      // Generate DALL-E images in parallel (same as stream path)
      console.log('Generating DALL-E images for all topics');
      const imageResults = await Promise.all(
        topics.map((topic, index) =>
          this.generateTopicImage(topic).then((image) => ({ index, topic: { ...topic, image } }))
        )
      );
      imageResults.forEach(({ index, topic }) => { topics[index] = topic; });

      return topics;
    } catch (error) {
      console.error('OpenAI trending topics error:', error);
      throw new Error('Failed to generate trending topics with AI');
    }
  }

  /**
   * Generate and stream topic narrative in the background. Does not block topic stream.
   * Events: topic-chunk (per word), topic-complete-narrative.
   * @param {string} connectionId
   * @param {object} analysisData
   * @param {object} selectedAudience
   */
  async streamTopicNarrativeInBackground(connectionId, analysisData, selectedAudience) {
    try {
      console.log('📝 [TOPIC-NARRATIVE-STREAM] Generating narrative (parallel with topics)');
      const narrative = await this.generateTopicNarrative(analysisData, selectedAudience, []);

      const words = narrative.split(/(\s+)/);
      for (let i = 0; i < words.length; i++) {
        streamManager.publish(connectionId, 'topic-chunk', { text: words[i] });
        if (words[i].trim()) await new Promise((r) => setTimeout(r, 15));
      }
      streamManager.publish(connectionId, 'topic-complete-narrative', {});
      console.log('✅ [TOPIC-NARRATIVE-STREAM] Narrative streamed');
    } catch (narrativeErr) {
      console.warn('⚠️ [TOPIC-NARRATIVE-STREAM] Error:', narrativeErr.message);
    }
  }

  /**
   * Stream trending topics: GPT stream then DALL-E per topic. Events: topic-complete (per topic, no image),
   * topic-image-complete (per topic with image), complete { topics }.
   * topic-complete is emitted as soon as each topic's JSON is ready so the frontend can show cards immediately.
   * Narrative (if any) runs in parallel and does not block topic-complete.
   * @param {string} businessType
   * @param {string} targetAudience
   * @param {string} contentFocus
   * @param {string} connectionId
   */
  async generateTrendingTopicsStream(businessType, targetAudience, contentFocus, connectionId, analysisData = null, selectedAudience = null) {
    // Stream narrative in background so topic-complete can fire as soon as topic JSON is ready
    if (analysisData && selectedAudience) {
      void this.streamTopicNarrativeInBackground(connectionId, analysisData, selectedAudience).catch(() => {});
    }

    const model = process.env.OPENAI_TOPICS_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const systemContent = `You are a content strategist. Create blog topics that are SEO-optimized, use searchable keywords, and promise clear value. Use direct language people actually search for—no abstract or academic phrasing.`;

    const userContent = `Generate 2 blog topics for:
Business: ${businessType}
Audience: ${targetAudience}
Focus: ${contentFocus}

For each topic return JSON only:
{"id":number,"trend":"string","title":"SEO-friendly title (e.g. How to X, not 'The Paradox of...')","subheader":"subtitle","seoBenefit":"value when they search for [terms]","category":"category"}

Rules: Searchable keywords, clear benefit, specific problem/solution. Avoid vague or philosophical titles. Return an array of 2 objects, no other text.`;

    const extractCompleteObjects = (buf) => {
      let depth = 0;
      let startIdx = -1;
      const objects = [];
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === '{') {
          if (depth === 0) startIdx = i;
          depth++;
        } else if (buf[i] === '}') {
          depth--;
          if (depth === 0 && startIdx >= 0) {
            try {
              const obj = JSON.parse(buf.slice(startIdx, i + 1));
              objects.push(obj);
            } catch (e) {}
            startIdx = i + 1;
          }
        }
      }
      return { objects, remainingBuffer: startIdx >= 0 ? buf.slice(startIdx) : '' };
    };

    try {
      const stream = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent }
        ],
        temperature: 0.7,
        max_tokens: 1024,
        stream: true
      });

      let buffer = '';
      const allTopics = [];
      /** Start each topic's image as soon as the topic is streamed (overlap GPT stream with DALL-E). */
      const imagePromises = [];

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) {
          buffer += delta;
          const { objects, remainingBuffer } = extractCompleteObjects(buffer);
          buffer = remainingBuffer;
          for (const obj of objects) {
            const index = allTopics.length;
            allTopics.push(obj);
            streamManager.publish(connectionId, 'topic-complete', { topic: obj });
            streamManager.publish(connectionId, 'topic-image-start', {
              index,
              total: allTopics.length,
              topic: obj
            });
            imagePromises.push(
              this.generateTopicImage(obj).then((image) => ({ index, topic: { ...obj, image } }))
            );
          }
        }
      }

      const total = allTopics.length;
      const imageResults = await Promise.all(imagePromises);
      for (const { index, topic } of imageResults) {
        allTopics[index] = topic;
        streamManager.publish(connectionId, 'topic-image-complete', { index, topic });
      }

      streamManager.publish(connectionId, 'complete', { topics: allTopics });
    } catch (error) {
      console.error('OpenAI trending topics stream error:', error);
      streamManager.publish(connectionId, 'error', { error: error.message, errorCode: error.code ?? null });
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
      
      const prompt = `Professional blog header image for: "${topic.title}". Style: sharp, well-lit, clean. No text, no faces. Realistic stock-photo style.`;

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
   * Generate DALL-E image for a single audience scenario
   * @param {Object} scenario - The audience scenario
   * @param {Object} brandContext - Brand voice and style context
   */
  async generateAudienceImage(scenario, brandContext = {}) {
    try {
      console.log('Generating DALL-E image for audience:', scenario.targetSegment.demographics);

      // Extract demographic context to inform the background
      const demographics = scenario.targetSegment.demographics || '';
      const searchBehavior = scenario.targetSegment.searchBehavior || '';
      const brandVoice = brandContext.brandVoice || 'Professional';

      // Map brand voice to visual tone
      const getToneFromBrandVoice = (voice) => {
        const voiceLower = (voice || '').toLowerCase();
        if (voiceLower.includes('playful') || voiceLower.includes('fun') || voiceLower.includes('casual')) {
          return 'vibrant, playful, energetic with bold colors';
        } else if (voiceLower.includes('professional') || voiceLower.includes('corporate') || voiceLower.includes('formal')) {
          return 'clean, professional, sophisticated with muted colors';
        } else if (voiceLower.includes('friendly') || voiceLower.includes('approachable') || voiceLower.includes('warm')) {
          return 'warm, inviting, friendly with soft colors';
        } else if (voiceLower.includes('modern') || voiceLower.includes('innovative') || voiceLower.includes('tech')) {
          return 'modern, sleek, minimalist with cool colors';
        } else if (voiceLower.includes('luxury') || voiceLower.includes('premium') || voiceLower.includes('elegant')) {
          return 'elegant, refined, sophisticated with rich colors';
        }
        return 'balanced, professional yet approachable with harmonious colors';
      };

      const visualTone = getToneFromBrandVoice(brandVoice);

      // Create simple, clean character illustration
      const searchPrompt = `Create a simple, clean flat illustration of a person representing this audience: ${demographics}

PURPOSE: This is the cover image for an audience preview card, so the person should clearly represent the target audience.

STYLE:
- Minimalist flat illustration (like modern app icons)
- Simple, friendly cartoon character
- Clean lines and basic shapes
- Solid pastel colors (blue, purple, coral, or mint)
- Visual tone: ${visualTone}

PERSON (REPRESENTING THE AUDIENCE):
- Single person that visually represents: ${demographics}
- Standing or sitting in a simple, neutral pose
- Simple geometric forms for body
- Stylized non-skin-tone color (soft blue, purple, coral, mint)
- Minimal facial features (dots for eyes, simple smile)
- Simple, modern clothing appropriate to the demographic
- Person should be identifiable as the target audience

BACKGROUND:
- Completely transparent or pure white (#FFFFFF)
- NO props, NO objects, NO environment, NO decorative elements
- Just the person alone on transparent/white background

CONSISTENCY:
- Same illustration style across all 4 images
- Same level of simplification
- Same color approach
- Clean, professional look suitable for preview cards

Focus: Simple character that clearly represents the audience demographic. This is a preview card cover, so the audience should be the prominent feature.`;


      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: searchPrompt,
        size: "1024x1024",
        quality: "standard",
        n: 1,
      });

      console.log('DALL-E audience image generated successfully');
      return response.data[0].url;

    } catch (error) {
      console.error('DALL-E audience image generation error:', error);

      // Fallback to a placeholder image
      const fallbackUrl = `https://via.placeholder.com/1024x1024/e3f2fd/1890ff?text=${encodeURIComponent('Online Search')}`;
      console.log('Using fallback image:', fallbackUrl);
      return fallbackUrl;
    }
  }

  /**
   * Generate DALL-E images for multiple audience scenarios in parallel
   * @param {Array} scenarios - Array of audience scenarios
   * @param {Object} brandContext - Brand voice and style context
   * @param {{ onImageComplete?: (scenario: object, index: number) => void }} [options]
   */
  async generateAudienceImages(scenarios, brandContext = {}, options = {}) {
    try {
      const { onImageComplete } = options;
      console.log(`🎨 Generating DALL-E images for ${scenarios.length} audiences with brand voice: ${brandContext.brandVoice || 'Professional'}...`);

      // Generate images in parallel to minimize total time
      const imagePromises = scenarios.map(async (scenario, index) => {
        console.log(`Generating image ${index + 1}/${scenarios.length} for: ${scenario.targetSegment.demographics}`);
        const imageUrl = await this.generateAudienceImage(scenario, brandContext);
        const result = {
          ...scenario,
          imageUrl
        };
        if (typeof onImageComplete === 'function') onImageComplete(result, index);
        return result;
      });

      const scenariosWithImages = await Promise.all(imagePromises);
      console.log('✅ All audience images generated');

      return scenariosWithImages;

    } catch (error) {
      console.error('❌ Failed to generate audience images:', error);
      throw error;
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
   * Generate analytics insights from data
   * @param {Object} analyticsData - Analytics data (funnel, cohorts, sessions, revenue)
   * @param {String} context - Analysis context (funnel, retention, revenue)
   * @returns {Promise<Object>} Insights and recommendations
   */
  async generateAnalyticsInsights(analyticsData, userOpportunities = []) {
    try {
      console.log(`📈 OpenAI: Generating analytics insights with ${userOpportunities.length} user opportunities`);

      const { funnel, metrics, cohorts, sessions, revenue } = analyticsData;

      // Format user opportunities for LLM
      const opportunitySummary = userOpportunities.slice(0, 15).map((opp, idx) =>
        `${idx + 1}. [${opp.opportunity_type}] ${opp.full_name || 'Unknown'} (${opp.email}): ${opp.recommended_action}`
      ).join('\n');

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',  // Use GPT-4o for better reasoning
        messages: [
          {
            role: 'system',
            content: `You are a product analytics expert analyzing AutoBlog, a blog generation SaaS platform. Your goal is to provide SPECIFIC, ACTIONABLE insights with user names and concrete next steps - not generic advice.`
          },
          {
            role: 'user',
            content: `Analyze this product analytics data and provide 5-7 SPECIFIC actionable insights.

**Platform Metrics:**
- Total Users: ${metrics?.total_users || 0}
- New Users (30d): ${metrics?.new_users || 0}
- User Growth Rate: ${metrics?.user_growth_rate || 0}%
- Active Paying Users: ${metrics?.total_paying_users || 0}
- Starter Plans: ${metrics?.starter_count || 0}
- Professional Plans: ${metrics?.professional_count || 0}
- Subscription MRR: $${metrics?.subscription_mrr || 0}
- Pay-Per-Use Revenue (30d): $${metrics?.pay_per_use_revenue || 0}
- Total Revenue (30d): $${metrics?.total_revenue || 0}
- Revenue Growth Rate: ${metrics?.revenue_growth_rate || 0}%
- Total Referrals: ${metrics?.total_referrals || 0}
- Successful Referrals: ${metrics?.successful_referrals || 0}
- Referral Conversion Rate: ${metrics?.referral_conversion_rate || 0}%
- Referral Posts Granted: ${metrics?.referral_posts_granted || 0}
- Referral Posts Used: ${metrics?.referral_posts_used || 0}
- Active Users (30d): ${metrics?.active_users || 0}

**Top User Opportunities (Specific People to Contact):**
${opportunitySummary || 'No specific user opportunities identified yet'}

**IMPORTANT INSTRUCTIONS:**
Provide insights in this EXACT format:
**[Priority: High/Medium/Low] Insight Title**
- **User/Segment**: [Specific user names/emails from above OR segment description with numbers]
- **Action**: [Exact steps - WHO to contact, WHAT to say, WHEN to do it]
- **Expected Result**: [Concrete metric improvement with target numbers]

Focus on:
1. **Immediate revenue opportunities** - Which SPECIFIC users to reach out to first and why
2. **Conversion optimization** - Specific bottlenecks with user examples
3. **Retention risks** - Name paying customers at risk of churning
4. **Growth tactics** - Referral program improvements with user examples
5. **Product improvements** - Based on user behavior patterns

BE SPECIFIC - Use actual user names, emails, and numbers from the data above. Never say "reach out to users who..." - instead say "Reach out to John Smith (john@example.com)..."`
          }
        ],
        temperature: 0.5,
        max_tokens: 2500
      });

      const response = completion.choices[0].message.content;

      return {
        insights: this.parseActionableInsights(response),
        rawResponse: response,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('❌ OpenAI: Failed to generate analytics insights:', error);
      return {
        insights: [],
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Parse actionable insights with user/segment and specific actions
   * @param {String} text - Raw LLM response
   * @returns {Array} Parsed insights
   */
  parseActionableInsights(text) {
    const insights = [];
    // Updated regex to match the new format with Priority, User/Segment, Action, Expected Result
    const regex = /\*\*\[Priority:\s*(High|Medium|Low)\]\s*(.+?)\*\*\s*-\s*\*\*User\/Segment\*\*:\s*(.+?)\n\s*-\s*\*\*Action\*\*:\s*(.+?)\n\s*-\s*\*\*Expected Result\*\*:\s*(.+?)(?=\n\*\*\[Priority:|$)/gs;

    let match;
    while ((match = regex.exec(text)) !== null) {
      insights.push({
        priority: match[1].trim(),
        title: match[2].trim(),
        userSegment: match[3].trim(),
        action: match[4].trim(),
        expectedResult: match[5].trim(),
        impact: match[1].trim()  // Map priority to impact for backwards compatibility
      });
    }

    // Fallback: try old format if new format didn't match
    if (insights.length === 0) {
      const oldRegex = /\d+\.\s\*\*Insight\*\*:\s(.+?)\n\s+-\s\*\*Impact\*\*:\s(.+?)\n\s+-\s\*\*Action\*\*:\s(.+?)\n\s+-\s\*\*Expected Result\*\*:\s(.+?)(?=\n\n|\n\d+\.|$)/gs;
      let oldMatch;
      while ((oldMatch = oldRegex.exec(text)) !== null) {
        insights.push({
          priority: oldMatch[2].trim(),
          title: oldMatch[1].trim(),
          userSegment: 'General',
          action: oldMatch[3].trim(),
          expectedResult: oldMatch[4].trim(),
          impact: oldMatch[2].trim()
        });
      }
    }

    return insights;
  }

  /**
   * Parse insights from analytics LLM response (legacy method for backwards compatibility)
   * @param {String} text - Raw LLM response
   * @returns {Array} Parsed insights
   */
  parseAnalyticsInsights(text) {
    // Redirect to new parser
    return this.parseActionableInsights(text);
  }

  /**
   * Generate revenue-focused insights for maximizing MRR and revenue
   * @param {Object} metrics - Platform metrics
   * @param {Array} userOpportunities - User opportunity data
   * @returns {Promise<Object>} Revenue insights with potential MRR increase
   */
  async generateRevenueInsights(metrics, userOpportunities) {
    try {
      console.log('🤑 OpenAI: Generating revenue-focused insights');

      // Filter for revenue-related opportunities
      const revenueUsers = userOpportunities.filter(u =>
        ['out_of_credits', 'upsell_to_pro', 'active_free_user'].includes(u.opportunity_type)
      );

      // Format user opportunities with specific details
      const userSummary = revenueUsers.slice(0, 15).map((u, idx) =>
        `${idx + 1}. [${u.opportunity_type}] ${u.full_name || 'Unknown'} (${u.email}):
       - Plan: ${u.plan_name || 'Free'}
       - Credits: ${u.available_credits || 0} available, ${u.used_credits || 0} used
       - Posts (30d): ${u.posts_last_30_days || 0}
       - Action: ${u.recommended_action}`
      ).join('\n');

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'system',
          content: `You are a SaaS revenue strategist specializing in immediate revenue opportunities and pricing optimization. Your goal is to maximize Monthly Recurring Revenue (MRR) and pay-per-use revenue through specific user outreach and pricing strategies.`
        }, {
          role: 'user',
          content: `Analyze this SaaS platform data and provide 3-5 HIGH-PRIORITY revenue opportunities.

**Platform Revenue Metrics:**
- Subscription MRR: $${metrics?.subscription_mrr || 0}/month
- Pay-Per-Use Revenue (30d): $${metrics?.pay_per_use_revenue || 0}
- Total Revenue (30d): $${metrics?.total_revenue || 0}
- Starter Plans: ${metrics?.starter_count || 0} ($20/mo each)
- Professional Plans: ${metrics?.professional_count || 0} ($50/mo each)
- Active Paying Users: ${metrics?.total_paying_users || 0}
- Total Users: ${metrics?.total_users || 0}

**Revenue Opportunity Users (Top ${revenueUsers.length}):**
${userSummary || 'No specific revenue opportunities identified'}

**Pricing Context:**
- Pay-per-use: $15 per blog post
- Starter plan: $20/mo (4 posts included = $5/post)
- Professional plan: $50/mo (8 posts included = $6.25/post)
- Free tier: 3 free posts for new users

Provide 3-5 SPECIFIC, ACTIONABLE revenue insights in this EXACT format:

**[Priority: High/Medium] Insight Title**
- **User/Segment**: [Specific user names & emails OR segment with exact user count]
- **Action**: [WHO to reach out to, WHAT to offer, WHEN to do it, exact email template/message]
- **Expected Result**: [Exact $ MRR increase or revenue impact with calculations]

Focus on:
1. Immediate revenue from users out of credits (ready to buy NOW)
2. Upsell opportunities for users over their plan allocation
3. Pricing strategy changes (data-driven recommendations)
4. Converting high-engagement free users to paid plans

Be SPECIFIC - use actual user names, emails, credit counts, and exact dollar calculations.`
        }],
        temperature: 0.5,
        max_tokens: 2000
      });

      const insights = this.parseActionableInsights(completion.choices[0].message.content);

      // Calculate potential MRR increase
      const potentialMRR = revenueUsers.length * 20; // Estimate: $20/user avg

      return {
        title: "Revenue Opportunities",
        priority: metrics?.subscription_mrr < 100 ? "immediate_action_required" : "monitor",
        insights,
        summary: `${insights.length} immediate revenue opportunities identified`,
        potentialMRRIncrease: potentialMRR,
        userCount: revenueUsers.length,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('❌ OpenAI: Failed to generate revenue insights:', error);
      return {
        title: "Revenue Opportunities",
        insights: [],
        error: error.message,
        potentialMRRIncrease: 0,
        userCount: 0,
        timestamp: new Date()
      };
    }
  }

  /**
   * Generate funnel and retention insights for user growth
   * @param {Object} metrics - Platform metrics
   * @param {Object} funnel - Funnel conversion data
   * @param {Array} userOpportunities - User opportunity data
   * @returns {Promise<Object>} Funnel insights with churn risk data
   */
  async generateFunnelInsights(metrics, funnel, userOpportunities) {
    try {
      console.log('📈 OpenAI: Generating sales funnel insights');

      // Filter for growth-related opportunities
      const funnelUsers = userOpportunities.filter(u =>
        ['churn_risk', 'unused_referral'].includes(u.opportunity_type)
      );

      // Format user details
      const userSummary = funnelUsers.slice(0, 15).map((u, idx) =>
        `${idx + 1}. [${u.opportunity_type}] ${u.full_name || 'Unknown'} (${u.email}):
       - Last Activity: ${u.last_activity ? new Date(u.last_activity).toLocaleDateString() : 'Never'}
       - Subscription: ${u.subscription_status || 'None'} (${u.plan_name || 'Free'})
       - Posts Generated: ${u.posts_last_30_days || 0} in last 30 days
       - Issue: ${u.opportunity_reason}`
      ).join('\n');

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'system',
          content: `You are a customer success and growth strategist specializing in conversion funnel optimization and user retention. Your goal is to maximize user activation, prevent churn, and improve conversion rates at every funnel stage.`
        }, {
          role: 'user',
          content: `Analyze this conversion funnel data and provide 3-5 SPECIFIC actions to improve user growth.

**Funnel Metrics:**
- Total Users: ${metrics?.total_users || 0}
- New Users (30d): ${metrics?.new_users || 0}
- Active Users (30d): ${metrics?.active_users || 0}
- User Growth Rate: ${metrics?.user_growth_rate || 0}%
- Successful Referrals: ${metrics?.successful_referrals || 0}/${metrics?.total_referrals || 0} (${metrics?.referral_conversion_rate || 0}% conversion)

**Funnel Steps:**
${funnel?.steps ? funnel.steps.map(s => `- ${s.step}: ${s.count} users (${s.conversion_rate}% conversion)`).join('\n') : 'Funnel data not provided'}

**At-Risk & Inactive Users (Top ${funnelUsers.length}):**
${userSummary || 'No specific retention opportunities identified'}

Provide 3-5 SPECIFIC, ACTIONABLE funnel insights in this EXACT format:

**[Priority: High/Medium] Insight Title**
- **User/Segment**: [Specific user names & emails OR segment with exact user count and stage]
- **Action**: [Exact outreach strategy - WHO to contact, WHAT to say, WHEN to reach out, specific messaging]
- **Expected Result**: [Concrete conversion % improvement or user activation count with calculations]

Focus on:
1. Users who registered but didn't generate their first post (activation gap)
2. Paying customers at risk of churning (inactive 30+ days)
3. Conversion rate improvements at specific funnel steps
4. Referral program optimization (users with unused referral codes)

Be SPECIFIC - use actual user names, emails, last activity dates, and exact expected outcomes.`
        }],
        temperature: 0.5,
        max_tokens: 2000
      });

      const insights = this.parseActionableInsights(completion.choices[0].message.content);

      return {
        title: "Sales Funnel & Retention",
        priority: funnelUsers.length > 5 ? "monitor" : "healthy",
        insights,
        summary: `${insights.length} funnel optimization opportunities`,
        atRiskCount: funnelUsers.length,
        potentialChurnCost: funnelUsers.filter(u => u.opportunity_type === 'churn_risk').length * 20,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('❌ OpenAI: Failed to generate funnel insights:', error);
      return {
        title: "Sales Funnel & Retention",
        insights: [],
        error: error.message,
        atRiskCount: 0,
        potentialChurnCost: 0,
        timestamp: new Date()
      };
    }
  }

  /**
   * Generate product improvement insights for feature adoption and UX
   * @param {Object} metrics - Platform metrics
   * @param {Object} funnel - Funnel conversion data
   * @returns {Promise<Object>} Product insights with impact estimates
   */
  async generateProductInsights(metrics, funnel) {
    try {
      console.log('🛠️ OpenAI: Generating product insights');

      // Fetch engagement metrics
      const engagementMetrics = await analyticsService.getEngagementMetrics('30d');

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'system',
          content: `You are a product strategist specializing in SaaS feature adoption and UX optimization. Your goal is to identify product gaps, feature dropoff points, and improvements that will increase user engagement and retention.`
        }, {
          role: 'user',
          content: `Analyze this product usage data and provide 3-4 SPECIFIC product improvement recommendations.

**Product Metrics:**
- Total Users: ${metrics?.total_users || 0}
- Active Users (30d): ${metrics?.active_users || 0} (${((metrics?.active_users / metrics?.total_users) * 100).toFixed(1)}% activation rate)
- New Users (30d): ${metrics?.new_users || 0}
- Average Posts per Active User: ${metrics?.active_users > 0 ? ((metrics?.total_posts || 0) / metrics?.active_users).toFixed(1) : 0}

**Engagement & Navigation Metrics (30d):**
- Page Views: ${engagementMetrics?.pageViews?.total || 0}
- Most Visited Page: ${engagementMetrics?.pageViews?.byPage?.[0]?.page_url || 'N/A'} (${engagementMetrics?.pageViews?.byPage?.[0]?.view_count || 0} views)
- Tab Switches: ${engagementMetrics?.tabSwitches?.total || 0}
- Most Used Tab: ${engagementMetrics?.tabSwitches?.byTab?.[0]?.tab_name || 'N/A'} (${engagementMetrics?.tabSwitches?.byTab?.[0]?.switch_count || 0} switches)
- Topic Selections: ${engagementMetrics?.topicSelection?.total || 0}
- Most Popular Topic: ${engagementMetrics?.topicSelection?.byTopic?.[0]?.topic || 'N/A'} (${engagementMetrics?.topicSelection?.byTopic?.[0]?.selection_count || 0} selections)
- Export Activity: ${engagementMetrics?.exportActivity?.total || 0}
- Avg Session Duration: ${engagementMetrics?.sessionMetrics?.avg_session_duration ? parseFloat(engagementMetrics.sessionMetrics.avg_session_duration).toFixed(1) : 0} minutes
- Logout Events: ${engagementMetrics?.logout?.logout_count || 0} by ${engagementMetrics?.logout?.users_who_logged_out || 0} users

**Feature Adoption Gaps:**
- Referral Program: ${metrics?.successful_referrals || 0}/${metrics?.total_referrals || 0} conversion (${metrics?.referral_conversion_rate || 0}%)
- Referral Posts Used: ${metrics?.referral_posts_used || 0}/${metrics?.referral_posts_granted || 0} granted
- Subscription Adoption: ${metrics?.total_paying_users || 0}/${metrics?.total_users || 0} users (${((metrics?.total_paying_users / metrics?.total_users) * 100).toFixed(1)}% paid conversion)

**Funnel Conversion Issues:**
${funnel?.steps ? funnel.steps.filter(s => s.conversion_rate < 50).map(s =>
  `- ${s.step}: Only ${s.conversion_rate}% conversion (${s.count} users dropoff)`
).join('\n') : 'Funnel data not provided'}

Provide 3-4 SPECIFIC, ACTIONABLE product insights in this EXACT format:

**[Priority: Medium/Low] Insight Title**
- **User/Segment**: [Affected segment with exact user count OR % of users]
- **Action**: [Specific product/feature change, UX improvement, or onboarding enhancement]
- **Expected Result**: [Concrete adoption % improvement or engagement metric increase]

Focus on:
1. Features with low adoption rates (data-driven identification)
2. Funnel steps with high dropoff (>50% dropoff rate)
3. Onboarding improvements for new user activation
4. Product changes to increase engagement frequency
5. Navigation patterns and user behavior insights (use engagement metrics to identify friction points)

Be SPECIFIC - use actual percentages, user counts, and measurable expected outcomes. Provide concrete implementation ideas based on engagement data.`
        }],
        temperature: 0.5,
        max_tokens: 2000
      });

      const insights = this.parseActionableInsights(completion.choices[0].message.content);

      return {
        title: "Product Opportunities",
        priority: "backlog",
        insights,
        summary: `${insights.length} product improvement recommendations`,
        impactedUserCount: Math.floor(metrics?.total_users * 0.6), // Estimate: 60% could benefit
        timestamp: new Date()
      };
    } catch (error) {
      console.error('❌ OpenAI: Failed to generate product insights:', error);
      return {
        title: "Product Opportunities",
        insights: [],
        error: error.message,
        impactedUserCount: 0,
        timestamp: new Date()
      };
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

  /**
   * Generate audience scenarios WITHOUT pitches (faster, focused on audience intelligence)
   * @param {Object} analysisData - Basic website analysis data
   * @param {String} webSearchData - Web search research data
   * @param {String} keywordData - Keyword research data
   * @param {Array} existingAudiences - Existing audiences to avoid duplication
   * @returns {Promise<Array>} Array of scenarios without pitches
   */
  async generateAudienceScenarios(analysisData, webSearchData = '', keywordData = '', existingAudiences = []) {
    try {
      const isIncrementalAnalysis = existingAudiences.length > 0;
      console.log(`🎯 Generating audience scenarios (${isIncrementalAnalysis ? 'INCREMENTAL' : 'INITIAL'})...`);
      if (isIncrementalAnalysis) {
        console.log(`📊 Deduplication: ${existingAudiences.length} existing audiences to avoid`);
      } else {
        console.log(`📊 Initial analysis: Generating comprehensive starting set`);
      }

      const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

      // Format existing audiences for the prompt
      let existingAudiencesText = '';
      if (existingAudiences.length > 0) {
        const audienceDescriptions = existingAudiences.map((aud, idx) => {
          let demographics = 'Unknown demographics';
          try {
            const parsed = typeof aud.target_segment === 'string' ? JSON.parse(aud.target_segment) : aud.target_segment;
            demographics = parsed?.demographics || 'Unknown demographics';
          } catch (e) {
            // Fallback if parsing fails
          }
          return `${idx + 1}. ${aud.customer_problem} - ${demographics}`;
        }).join('\n');

        existingAudiencesText = `

EXISTING AUDIENCES (DO NOT DUPLICATE):
You have already created ${existingAudiences.length} audience(s) for this user/website:
${audienceDescriptions}

CRITICAL: Generate ONLY net new audiences that are completely different from the above. Focus on different demographics, different customer problems, and different psychographic segments.`;
      }

      // Adjust instructions based on whether this is initial or incremental analysis
      const systemPrompt = isIncrementalAnalysis
        ? `You are a customer psychology expert focused on audience research and segmentation. Generate additional audience scenarios only when they represent genuine business opportunities. Quality over quantity - it's better to suggest 1-2 excellent incremental audiences than to force unnecessary ones. You must avoid duplicating existing audiences and only suggest new segments if they would genuinely benefit the business.`
        : `You are a customer psychology expert focused on audience research and segmentation. Generate detailed audience scenarios for content marketing. This is an initial analysis, so provide a comprehensive starting set of 4-5 distinct, high-value audience opportunities.`;

      const targetCount = isIncrementalAnalysis ? '1-2 additional' : '4-5';
      const qualityNote = isIncrementalAnalysis
        ? '- Generate 1-2 additional audience scenarios ONLY if they represent genuine, valuable opportunities beyond what already exists\n- Each audience must have strong business value and conversion potential\n- Do NOT force audiences just to reach a certain number\n- If no strong additional audiences exist beyond what\'s already covered, return fewer audiences or an empty array'
        : '- Generate 4-5 distinct audience scenarios that represent the best opportunities for this business\n- Each audience must have strong business value and conversion potential\n- Cover the breadth of customer segments who would benefit from this business';

      const completion = await openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Based on this business analysis, identify ${targetCount} genuine audience opportunities:

Business Context:
- Business Type: ${analysisData?.businessType ?? 'Business'}
- Business Name: ${analysisData?.businessName ?? analysisData?.companyName ?? 'Company'}
- Target Audience: ${analysisData?.targetAudience ?? 'General market'}
- Business Model: ${analysisData?.businessModel ?? 'Service-based'}
- Content Focus: ${analysisData?.contentFocus ?? 'Customer problems and solutions'}
${webSearchData}
${keywordData}${existingAudiencesText}

CRITICAL INSTRUCTIONS FOR DIVERSITY:
${qualityNote}
- Each audience MUST be COMPLETELY DIFFERENT - different age groups, life stages, roles, industries
- NO semantic duplicates - avoid variations of the same audience (e.g., don't create "small business owners wanting to grow" AND "small business owners seeking expansion")
- Aim for maximum demographic diversity: different career levels (entry, mid, senior, executive), different age ranges (20s, 30s, 40s, 50+), different contexts (B2B, B2C, personal use)
- Each audience should have distinctly different pain points, motivations, and search behaviors${isIncrementalAnalysis ? ' from existing audiences' : ''}

EXAMPLES OF GOOD DIVERSITY (for a business consulting firm):
✅ GOOD: [Startup founders in tech (20-35), Mid-market CEOs in manufacturing (45-60), Freelance consultants building practice (30-50), Corporate executives transitioning to entrepreneurship (40-55)]
❌ BAD: [Small business owners wanting to grow, Small business owners seeking expansion, Small business owners looking to scale, Business owners trying to improve]

Generate scenarios as JSON array:

[
  {
    "customerProblem": "Specific problem driving search behavior",
    "targetSegment": {
      "demographics": "Natural language description (e.g., 'First-time mothers aged 25-35 experiencing high pregnancy anxiety')",
      "psychographics": "Emotional state, urgency level, decision-making context",
      "searchBehavior": "When/how they search (crisis-driven vs planned)"
    },
    "businessValue": {
      "searchVolume": "e.g., 'High - 3,500/month'",
      "competition": "Low/Medium/High with gaps",
      "conversionPotential": "High/Medium/Low",
      "priority": 1
    },
    "customerLanguage": ["search phrase 1", "search phrase 2"],
    "seoKeywords": ["keyword 1", "keyword 2", "keyword 3"],
    "conversionPath": "How content leads to business goal",
    "contentIdeas": [
      {
        "title": "Blog post title",
        "searchIntent": "Why they search",
        "businessAlignment": "Conversion strategy"
      }
    ]
  }
]

Return only audiences with strong business potential. If no strong additional audiences exist, return an empty array []. Each scenario must target DIFFERENT demographics from existing audiences. Order by priority (highest value first).`
          }
        ],
        temperature: 0.8,
        max_tokens: 3500
      });

      const response = completion.choices[0].message.content;
      const parsed = this.parseOpenAIResponse(response);

      // Handle model returning object (e.g. { scenarios: [...] }) instead of array
      let scenarios = Array.isArray(parsed) ? parsed : null;
      if (!scenarios && parsed && typeof parsed === 'object') {
        scenarios = parsed.scenarios ?? parsed.audiences ?? parsed.customerScenarios ?? parsed.results ?? null;
      }
      if (!Array.isArray(scenarios)) {
        console.warn('generateAudienceScenarios: expected array, got', typeof parsed, Object.keys(parsed || {}));
        return [];
      }

      console.log(`✅ Generated ${scenarios.length} audience scenarios`);
      return scenarios;

    } catch (error) {
      console.error('❌ Failed to generate audience scenarios:', error);
      throw error;
    }
  }

  /**
   * Stream audience scenarios via SSE (Phase 3). Emit audience-complete per object, then complete.
   * @param {Object} analysisData
   * @param {string} webSearchData
   * @param {string} keywordData
   * @param {Array} existingAudiences
   * @param {string} connectionId
   */
  async generateAudienceScenariosStream(analysisData, webSearchData = '', keywordData = '', existingAudiences = [], connectionId) {
    const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
    let existingAudiencesText = '';
    if (existingAudiences.length > 0) {
      const audienceDescriptions = existingAudiences.map((aud, idx) => {
        let demographics = 'Unknown demographics';
        try {
          const parsed = typeof aud.target_segment === 'string' ? JSON.parse(aud.target_segment) : aud.target_segment;
          demographics = parsed?.demographics || 'Unknown demographics';
        } catch (e) {}
        return `${idx + 1}. ${aud.customer_problem} - ${demographics}`;
      }).join('\n');
      existingAudiencesText = `

EXISTING AUDIENCES (DO NOT DUPLICATE):
You have already created ${existingAudiences.length} audience(s) for this user/website:
${audienceDescriptions}

CRITICAL: Generate ONLY net new audiences that are completely different from the above.`;
    }
    const isIncrementalAnalysis = existingAudiences.length > 0;
    const systemPrompt = isIncrementalAnalysis
      ? `You are a customer psychology expert. Generate additional audience scenarios only when they represent genuine opportunities. Avoid duplicating existing audiences.`
      : `You are a customer psychology expert. Generate 4-5 distinct audience scenarios for content marketing.`;
    const targetCount = isIncrementalAnalysis ? '1-2 additional' : '4-5';
    const qualityNote = isIncrementalAnalysis
      ? '- Generate 1-2 additional audience scenarios ONLY if genuine opportunities exist\n- Do NOT force audiences to reach a number'
      : '- Generate 4-5 distinct audience scenarios\n- Each must have strong business value';

    try {
      const stream = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Based on this business analysis, identify ${targetCount} genuine audience opportunities:

Business Context:
- Business Type: ${analysisData?.businessType ?? 'Business'}
- Business Name: ${analysisData?.businessName ?? analysisData?.companyName ?? 'Company'}
- Target Audience: ${analysisData?.targetAudience ?? 'General market'}
- Business Model: ${analysisData?.businessModel ?? 'Service-based'}
- Content Focus: ${analysisData?.contentFocus ?? 'Customer problems and solutions'}
${webSearchData}
${keywordData}${existingAudiencesText}

CRITICAL: ${qualityNote}
Generate scenarios as JSON array: [ { "customerProblem": "...", "targetSegment": { "demographics": "...", "psychographics": "...", "searchBehavior": "..." }, "businessValue": { "searchVolume": "...", "competition": "...", "conversionPotential": "...", "priority": 1 }, "customerLanguage": [], "seoKeywords": [], "conversionPath": "...", "contentIdeas": [] }, ... ]
Return only audiences with strong business potential. Order by priority.`
          }
        ],
        temperature: 0.3,
        max_tokens: 3500,
        stream: true
      });

      let buffer = '';
      const allAudiences = [];
      const extractCompleteObjects = (buf) => {
        let depth = 0;
        let startIdx = -1;
        const objects = [];
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] === '{') {
            if (depth === 0) startIdx = i;
            depth++;
          } else if (buf[i] === '}') {
            depth--;
            if (depth === 0 && startIdx >= 0) {
              try {
                const obj = JSON.parse(buf.slice(startIdx, i + 1));
                objects.push(obj);
              } catch (e) {}
              startIdx = i + 1;
            }
          }
        }
        return { objects, remainingBuffer: startIdx >= 0 ? buf.slice(startIdx) : '' };
      };

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) {
          buffer += delta;
          const { objects, remainingBuffer } = extractCompleteObjects(buffer);
          buffer = remainingBuffer;
          for (const obj of objects) {
            allAudiences.push(obj);
            streamManager.publish(connectionId, 'audience-complete', { audience: obj });
          }
        }
      }
      streamManager.publish(connectionId, 'complete', { audiences: allAudiences });
    } catch (error) {
      console.error('Audience stream error:', error);
      streamManager.publish(connectionId, 'error', { error: error.message, errorCode: error.code ?? null });
    }
  }

  /**
   * Stream audience scenarios and call onAudience for each parsed object; returns full array.
   * Used by job pipeline for per-audience partial results (audience-complete events).
   * @param {Object} analysisData
   * @param {string} webSearchData
   * @param {string} keywordData
   * @param {Array} existingAudiences
   * @param { (scenario: object) => void } [onAudience]
   * @returns {Promise<Array>}
   */
  async generateAudienceScenariosStreamWithCallback(analysisData, webSearchData = '', keywordData = '', existingAudiences = [], onAudience = null) {
    const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
    let existingAudiencesText = '';
    if (existingAudiences.length > 0) {
      const audienceDescriptions = existingAudiences.map((aud, idx) => {
        let demographics = 'Unknown demographics';
        try {
          const parsed = typeof aud.target_segment === 'string' ? JSON.parse(aud.target_segment) : aud.target_segment;
          demographics = parsed?.demographics || 'Unknown demographics';
        } catch (e) {}
        return `${idx + 1}. ${aud.customer_problem} - ${demographics}`;
      }).join('\n');
      existingAudiencesText = `

EXISTING AUDIENCES (DO NOT DUPLICATE):
You have already created ${existingAudiences.length} audience(s) for this user/website:
${audienceDescriptions}

CRITICAL: Generate ONLY net new audiences that are completely different from the above.`;
    }
    const isIncrementalAnalysis = existingAudiences.length > 0;
    const systemPrompt = isIncrementalAnalysis
      ? `You are a customer psychology expert. Generate additional audience scenarios only when they represent genuine opportunities. Avoid duplicating existing audiences.`
      : `You are a customer psychology expert. Generate 4-5 distinct audience scenarios for content marketing.`;
    const targetCount = isIncrementalAnalysis ? '1-2 additional' : '4-5';
    const qualityNote = isIncrementalAnalysis
      ? '- Generate 1-2 additional audience scenarios ONLY if genuine opportunities exist\n- Do NOT force audiences to reach a number'
      : '- Generate 4-5 distinct audience scenarios\n- Each must have strong business value';

    const stream = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Based on this business analysis, identify ${targetCount} genuine audience opportunities:

Business Context:
- Business Type: ${analysisData?.businessType ?? 'Business'}
- Business Name: ${analysisData?.businessName ?? analysisData?.companyName ?? 'Company'}
- Target Audience: ${analysisData?.targetAudience ?? 'General market'}
- Business Model: ${analysisData?.businessModel ?? 'Service-based'}
- Content Focus: ${analysisData?.contentFocus ?? 'Customer problems and solutions'}
${webSearchData}
${keywordData}${existingAudiencesText}

CRITICAL: ${qualityNote}
Generate scenarios as JSON array: [ { "customerProblem": "...", "targetSegment": { "demographics": "...", "psychographics": "...", "searchBehavior": "..." }, "businessValue": { "searchVolume": "...", "competition": "...", "conversionPotential": "...", "priority": 1 }, "customerLanguage": [], "seoKeywords": [], "conversionPath": "...", "contentIdeas": [] }, ... ]
Return only audiences with strong business potential. Order by priority.`
        }
      ],
      temperature: 0.3,
      max_tokens: 3500,
      stream: true
    });

    let buffer = '';
    const allAudiences = [];
    const extractCompleteObjects = (buf) => {
      let depth = 0;
      let startIdx = -1;
      const objects = [];
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === '{') {
          if (depth === 0) startIdx = i;
          depth++;
        } else if (buf[i] === '}') {
          depth--;
          if (depth === 0 && startIdx >= 0) {
            try {
              const obj = JSON.parse(buf.slice(startIdx, i + 1));
              objects.push(obj);
            } catch (e) {}
            startIdx = i + 1;
          }
        }
      }
      return { objects, remainingBuffer: startIdx >= 0 ? buf.slice(startIdx) : '' };
    };

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        buffer += delta;
        const { objects, remainingBuffer } = extractCompleteObjects(buffer);
        buffer = remainingBuffer;
        for (const obj of objects) {
          allAudiences.push(obj);
          if (typeof onAudience === 'function') onAudience(obj);
        }
      }
    }
    return allAudiences;
  }

  /**
   * Generate step-by-step funnel pitches for audience scenarios
   * @param {Array} scenarios - Audience scenarios without pitches
   * @param {Object} businessContext - Business context for revenue calculations
   * @param {{ onPitchComplete?: (scenario: object, index: number) => void }} [options]
   * @returns {Promise<Array>} Scenarios with generated pitches
   */
  async generatePitches(scenarios, businessContext, options = {}) {
    try {
      const { onPitchComplete } = options;
      console.log('💰 Generating conversion funnel pitches...');

      const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

      // Generate pitches for each scenario (can be done in parallel for speed)
      const pitchPromises = scenarios.map(async (scenario, index) => {
        const completion = await openai.chat.completions.create({
          model: model,
          messages: [
            {
              role: 'system',
              content: `You are a conversion funnel expert who creates educational step-by-step revenue projections.`
            },
            {
              role: 'user',
              content: `Create a step-by-step conversion funnel pitch for this audience scenario:

Business: ${businessContext.businessType} - ${businessContext.businessName}
Audience: ${scenario.targetSegment.demographics}
Problem: ${scenario.customerProblem}
Emotional State: ${scenario.targetSegment.psychographics}
Search Behavior: ${scenario.targetSegment.searchBehavior}
Search Volume: ${scenario.businessValue.searchVolume}
Primary SEO Keyword (USE EXACTLY IN STEP 1): "${scenario.seoKeywords[0]}"
Related Keywords: ${scenario.seoKeywords.slice(1).join(', ')}
Conversion Potential: ${scenario.businessValue.conversionPotential}

Generate a pitch as plain text string (NOT JSON) following this format:

Step 1: [search volume number] people search monthly for "${scenario.seoKeywords[0]}"
Step 2: Your blog posts capture [X-Y%] ([A-B clicks]) once SEO builds over 6-12 months
Step 3: [M-N%] engage and read ([P-Q readers]) vs bouncing - [WHY based on their emotional state]
Step 4: [R-S%] click CTA ([T-U bookings]) - [WHY based on their search urgency]
Step 5: CRITICAL - Calculate PROFIT (not just revenue):
  First determine appropriate profit margin for this business type:
  - Consulting/coaching/therapy services: 70-85% margin (low overhead, expertise-based)
  - Digital products/courses: 80-95% margin (once created, minimal fulfillment cost)
  - Physical products/ecommerce: 30-50% margin (inventory, shipping, overhead)
  - Professional services (legal, accounting): 60-75% margin

  Then calculate:
  - Revenue: $[low]-$[high]/month at $[price]/[unit] ([conversions] bookings from Step 4)
  - Profit margin: [appropriate % based on business type]
  - Profit: $[revenue × margin]-$[revenue × margin]/month

  Format: "Profit of $X-$Y monthly ($A-$B revenue, Z% margin at $C/consultation)"

Use realistic conversion rates based on industry benchmarks:
- Capture rate: 0.5-4% of total searches (depends on ranking position #1-10)
- Engagement rate: 20-60% (inverse of bounce rate, higher for crisis content)
- CTA conversion: 2-15% (higher for urgent/crisis-driven needs, lower for research)

Example:
Step 1: 3,500 people search monthly for "safe anxiety medication during pregnancy"
Step 2: Your posts capture 1-3% (35-105 clicks) once SEO authority builds over 6-12 months
Step 3: 30-50% engage (11-53 readers) vs bouncing - they need clinical guidance but many bounce to check multiple sources
Step 4: 5-12% book (1-6 consultations) due to crisis-driven urgency and fear about harming baby
Step 5: Profit of $400-$2,400 monthly ($500-$3,000 revenue, 80% margin at $500/consultation)

Use their specific emotional state and urgency to justify rates. Plain text only, max 600 characters.`
            }
          ],
          temperature: 0.2,
          max_tokens: 800
        });

        const pitch = completion.choices[0].message.content.trim();

        // Extract profit metrics from Step 5 for database storage
        const metrics = this.extractProfitMetrics(pitch);

        const result = {
          ...scenario,
          pitch,
          ...metrics
        };
        if (typeof onPitchComplete === 'function') onPitchComplete(result, index);
        return result;
      });

      const scenariosWithPitches = await Promise.all(pitchPromises);

      console.log(`✅ Generated ${scenariosWithPitches.length} pitches`);
      return scenariosWithPitches;

    } catch (error) {
      console.error('❌ Failed to generate pitches:', error);
      throw error;
    }
  }

  /**
   * Extract profit metrics from pitch Step 5 for database storage
   * @param {String} pitch - The generated pitch text
   * @returns {Object} Extracted metrics (revenue, profit, margin, price)
   */
  extractProfitMetrics(pitch) {
    const metrics = {
      projected_revenue_low: null,
      projected_revenue_high: null,
      projected_profit_low: null,
      projected_profit_high: null,
      profit_margin_percent: null,
      price_per_unit: null,
      unit_type: 'consultation'
    };

    try {
      // Extract profit from Step 5
      const profitMatch = pitch.match(
        /Step 5:[^\$]*(?:Profit|profit)\s+of\s*\$([0-9,]+)-\$([0-9,]+)\s*(?:\/month|\/mo|monthly)/i
      );

      if (profitMatch) {
        metrics.projected_profit_low = parseInt(profitMatch[1].replace(/,/g, ''), 10);
        metrics.projected_profit_high = parseInt(profitMatch[2].replace(/,/g, ''), 10);
      }

      // Extract revenue
      const revenueMatch = pitch.match(/\$([0-9,]+)-\$([0-9,]+)\s+revenue/i);
      if (revenueMatch) {
        metrics.projected_revenue_low = parseInt(revenueMatch[1].replace(/,/g, ''), 10);
        metrics.projected_revenue_high = parseInt(revenueMatch[2].replace(/,/g, ''), 10);
      }

      // Extract margin
      const marginMatch = pitch.match(/(\d+)%\s+margin/i);
      if (marginMatch) {
        metrics.profit_margin_percent = parseFloat(marginMatch[1]);
      }

      // Extract price per unit
      const priceMatch = pitch.match(/\$([0-9,]+)\/(?:consultation|session|product|unit)/i);
      if (priceMatch) {
        metrics.price_per_unit = parseInt(priceMatch[1].replace(/,/g, ''), 10);
      }

      // Determine unit type
      if (pitch.toLowerCase().includes('session')) {
        metrics.unit_type = 'session';
      } else if (pitch.toLowerCase().includes('product')) {
        metrics.unit_type = 'product';
      }

      console.log('📊 Extracted metrics from pitch:', metrics);
      return metrics;

    } catch (error) {
      console.warn('⚠️ Failed to extract profit metrics from pitch:', error.message);
      return metrics;
    }
  }
}

export default new OpenAIService();