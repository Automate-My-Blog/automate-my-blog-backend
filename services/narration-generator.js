/**
 * Narration generation service for onboarding funnel (Issue #303).
 * Uses OpenAI to generate personalized, contextual narration messages.
 * Used by SSE streaming endpoints in routes/analysis.js.
 */

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate analysis completion narration using LLM
 * @param {object} params - Rich analysis data
 * @returns {Promise<string>} Personalized narration message
 */
export async function generateAnalysisNarration(params) {
  console.log('🎙️ [NARRATION] generateAnalysisNarration called');
  console.log('📦 [NARRATION] Params received:', JSON.stringify(params, null, 2));

  const {
    businessName,
    businessType,
    industryCategory,
    orgDescription,
    analysisData
  } = params;

  const scenarios = analysisData?.customerScenarios;
  const keyInsights = analysisData?.keyInsights;
  const scenarioCount = Array.isArray(scenarios) ? scenarios.length : 0;

  console.log('📊 [NARRATION] Analysis context:', {
    businessName,
    businessType,
    industryCategory,
    scenarioCount,
    hasKeyInsights: !!keyInsights,
    hasConfidenceScore: !!analysisData?.confidenceScore
  });

  const prompt = `You are a business consultant presenting analysis findings. This is PART 1 of a 3-part presentation.

Business: ${businessName}
Type: ${businessType || 'Not specified'}
Description: ${orgDescription || 'Not provided'}

Analysis:
- ${scenarioCount} customer scenarios identified
- Key insights: ${keyInsights ? JSON.stringify(keyInsights).substring(0, 100) : 'Multiple patterns'}

Write a direct opening statement (1-2 sentences, max 140 chars) that:
- States what you LEARNED about THEIR BUSINESS (positioning, brand, focus areas)
- NOT what customers want - focus on the business itself
- Be specific about their business model, positioning, or value proposition
- Professional consultant tone - NO quotes, NO exclamation marks, NO flowery language
- Use simple present tense: "I analyzed X and learned Y"

WRONG: "I found that Safety Managers seek immediate solutions" (talks about customers)
RIGHT: "I analyzed ${businessName} and learned you're a premium ${businessType || 'business'} positioned as [specific positioning], focusing on [specific solutions]."

Be factual and direct. This leads into showing them the audience segments next.`;

  console.log('💬 [NARRATION] Prompt length:', prompt.length, 'characters');

  try {
    console.log('🤖 [NARRATION] Calling OpenAI API...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 120,
      temperature: 0.7,
    });

    let narration = completion.choices[0]?.message?.content?.trim();

    // Remove quotes if LLM added them
    narration = narration.replace(/^["']|["']$/g, '');

    console.log('✅ [NARRATION] LLM response received:', narration);

    if (!narration) {
      throw new Error('Empty response from OpenAI');
    }

    return narration;
  } catch (error) {
    console.error('❌ [NARRATION] Error generating analysis narration:', error.message);
    console.error('❌ [NARRATION] Full error:', error);
    const fallback = `I analyzed ${businessName || 'your business'} and found ${scenarioCount} distinct customer groups.`;
    console.log('⚠️ [NARRATION] Using fallback:', fallback);
    return fallback;
  }
}

/**
 * Generate audience selection narration using LLM
 * @param {object} params - Rich analysis and audience data
 * @returns {Promise<string>} Personalized narration message
 */
export async function generateAudienceNarration(params) {
  console.log('👥 [NARRATION] generateAudienceNarration called');
  console.log('📦 [NARRATION] Params received:', JSON.stringify(params, null, 2));

  const {
    businessName,
    businessType,
    orgDescription,
    analysisData,
    audiences,
    previousNarration
  } = params;

  // Build rich audience context with search volume, competition, and problems
  const audienceContext = audiences
    ?.map((a, i) => {
      // Extract business value data (search volume, competition)
      const businessValue = a.business_value || {};
      const searchVolume = businessValue.searchVolume || businessValue.search_volume || 'Unknown';
      const competition = businessValue.competition || 'Unknown';

      return `${i + 1}. ${a.target_segment}
   Problem: ${a.customer_problem || 'N/A'}
   Search Volume: ${searchVolume}/month
   Competition: ${competition}`;
    })
    .join('\n') || 'No audiences available';

  console.log('📊 [NARRATION] Audience context:', {
    businessName,
    businessType,
    audienceCount: audiences?.length || 0,
    hasAnalysisData: !!analysisData,
    hasPreviousNarration: !!previousNarration
  });

  const prompt = `You are a business consultant. This is PART 2 of your presentation.

Business: ${businessName} (${businessType || 'Not specified'})
Previous narration: "${previousNarration || 'Analysis complete'}"

Audience Segments Found (${audiences?.length || 0}):
${audienceContext}

Write a concise introduction (2-3 sentences, max 200 chars) that:
- Continues naturally from previous narration
- Introduces ${audiences?.length || 0} segments by SUMMARIZING the key pattern:
  * What types of people/problems they represent (e.g., "small businesses to startups seeking growth")
  * Overall search interest level (High, Medium, or Low based on the data)
  * General competition range (Low, Medium, or High)
- Then asks which one to focus on
- NO quotes, NO exclamation marks, NO conversion scores, maintain consultant tone
- Do NOT list all audiences individually - summarize the overall opportunity
- Do NOT make up specific explanations about WHO is competing or WHY - just state the levels

WRONG: "Competition is low to medium from generic blogs creating opportunities" - making up WHO competes
RIGHT: "I found 5 audiences from small businesses to startups seeking growth, with high search interest and low to medium competition. Which should we focus on?"

Be concise and factual. Only use the data provided - don't infer or explain competition sources.`;

  console.log('💬 [NARRATION] Prompt length:', prompt.length, 'characters');

  try {
    console.log('🤖 [NARRATION] Calling OpenAI API...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.7,
    });

    let narration = completion.choices[0]?.message?.content?.trim();

    // Remove quotes if LLM added them
    narration = narration.replace(/^["']|["']$/g, '');

    console.log('✅ [NARRATION] LLM response received:', narration);

    if (!narration) {
      throw new Error('Empty response from OpenAI');
    }

    return narration;
  } catch (error) {
    console.error('❌ [NARRATION] Error generating audience narration:', error.message);
    console.error('❌ [NARRATION] Full error:', error);
    const fallback = `I found ${audiences?.length || 'several'} audience segments. Which one should we focus on?`;
    console.log('⚠️ [NARRATION] Using fallback:', fallback);
    return fallback;
  }
}

/**
 * Generate topic selection narration using LLM
 * @param {object} params - Full audience record with rich context
 * @returns {Promise<string>} Personalized narration message
 */
export async function generateTopicNarration(params) {
  console.log('📝 [NARRATION] generateTopicNarration called');
  console.log('📦 [NARRATION] Params received:', JSON.stringify(params, null, 2));

  const {
    businessName,
    businessType,
    orgDescription,
    selectedAudience,
    previousNarration
  } = params;

  const audience = selectedAudience;
  const audienceSegment = audience?.segment || 'your target audience';
  const problem = audience?.problem || 'content challenges';
  const pitch = audience?.pitch || null;

  // Extract search volume and competition from business_value
  const businessValue = audience?.business_value || {};
  const searchVolume = businessValue.searchVolume || businessValue.search_volume || 'Unknown';
  const competition = businessValue.competition || 'Unknown';

  console.log('📊 [NARRATION] Topic context:', {
    businessName,
    businessType,
    audienceSegment,
    hasProblem: !!problem,
    hasPitch: !!pitch,
    hasValue: !!audience?.business_value,
    searchVolume,
    competition,
    hasPreviousNarration: !!previousNarration
  });

  const prompt = `You are a business consultant. This is PART 3 (final) of your presentation.

Previous narration: "${previousNarration || 'Audience selected'}"

Selected Audience: ${audienceSegment}
- Problem: ${problem}
- Search Volume: ${searchVolume}
- Competition: ${competition}

Write the final statement (2-3 sentences, max 180 chars) that:
- Continues naturally from previous narration
- Introduces topics that address their specific pain point
- Mentions the search volume level (High, Medium, or Low)
- States the competition level (Low, Medium, or High)
- Shows these topics will help attract their target audience
- NO quotes, NO exclamation marks, NO conversion scores
- Maintain same professional tone from Parts 1 & 2
- Do NOT make up explanations about WHO is competing or WHY there's opportunity

WRONG: "Topics face low competition from generic blogs creating opportunities" - making up competitors
RIGHT: "For Safety Managers, topics on incident prevention show high search volume with medium competition, directly addressing their reporting needs."

Be concise and factual. Only use the provided data. This completes your 3-part presentation.`;

  console.log('💬 [NARRATION] Prompt length:', prompt.length, 'characters');

  try {
    console.log('🤖 [NARRATION] Calling OpenAI API...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 180,
      temperature: 0.7,
    });

    let narration = completion.choices[0]?.message?.content?.trim();

    // Remove quotes if LLM added them
    narration = narration.replace(/^["']|["']$/g, '');

    console.log('✅ [NARRATION] LLM response received:', narration);

    if (!narration) {
      throw new Error('Empty response from OpenAI');
    }

    return narration;
  } catch (error) {
    console.error('❌ [NARRATION] Error generating topic narration:', error.message);
    console.error('❌ [NARRATION] Full error:', error);
    const fallback = `For ${audienceSegment}, I have topics that address ${problem}. Which one should we write?`;
    console.log('⚠️ [NARRATION] Using fallback:', fallback);
    return fallback;
  }
}

/**
 * Generate content narration using LLM (future use)
 * @param {object} params - { selectedTopic, selectedAudience }
 * @returns {Promise<string>} Personalized narration message
 */
export async function generateContentNarration(params) {
  const { selectedTopic, selectedAudience } = params;

  const topicName = selectedTopic?.title || selectedTopic?.topic || 'this topic';
  const audienceInfo = selectedAudience?.targetSegment || 'your audience';

  const prompt = `You are an AI assistant helping guide a user through content creation.

Selected Topic: ${topicName}
Target Audience: ${audienceInfo}

Write a single, natural sentence (under 100 characters) that:
- Introduces the content creation phase
- References the selected topic
- Sounds encouraging and actionable
- Uses first person ("I'll help" or similar)

Keep it very concise and friendly.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 80,
      temperature: 0.7,
    });

    const narration = completion.choices[0]?.message?.content?.trim();
    if (!narration) {
      throw new Error('Empty response from OpenAI');
    }

    return narration;
  } catch (error) {
    console.error('Error generating content narration:', error.message);
    // Fallback to simple template
    return `Let me help you create compelling content about ${topicName}.`;
  }
}

/**
 * Stream text as chunks with typing effect simulation
 * @param {string} text - Full text to stream
 * @param {function} onChunk - Callback for each chunk (word)
 * @param {number} delayMs - Delay between chunks (default 50ms)
 * @returns {Promise<void>}
 */
export async function streamTextAsChunks(text, onChunk, delayMs = 50) {
  const words = text.split(' ');

  for (let i = 0; i < words.length; i++) {
    const chunk = i === 0 ? words[i] : ' ' + words[i];
    await onChunk(chunk);

    // Add delay between words for realistic streaming effect
    if (i < words.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
