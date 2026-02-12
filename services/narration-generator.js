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

Write the next statement (1-2 sentences, max 140 chars) that:
- Continues naturally from previous narration
- Introduces the ${audiences?.length || 0} segments with SPECIFIC data:
  * Mention what they're searching for / struggling with (their specific problem)
  * Include search volume (e.g., "2.5k searches/month")
  * Note competition level (Low/Medium/High)
  * Explain WHY they fit based on search behavior and pain points
- Asks which one to focus on
- NO quotes, NO exclamation marks, NO conversion scores, maintain consultant tone

WRONG: "I found audiences with challenges (85/100 conv)" (generic, has scores)
RIGHT: "I found 3 audiences: Safety Managers searching for incident prevention tools (4.2k/mo, Low competition), Operations Managers needing compliance software (2.8k/mo, Medium), Compliance Officers seeking audit prep (1.5k/mo, High). Which should we prioritize?"

Be data-driven and specific about search behavior, volumes, and competition.`;

  console.log('💬 [NARRATION] Prompt length:', prompt.length, 'characters');

  try {
    console.log('🤖 [NARRATION] Calling OpenAI API...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 130,
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
- Search Volume: ${searchVolume}/month
- Competition: ${competition}

Write the final statement (1-2 sentences, max 130 chars) that:
- Continues naturally from previous narration
- Introduces topics that address their specific pain point
- Mentions search volume (e.g., "4.2k/mo searches") and competition level
- Shows reasoning for why these topics will drive results based on search behavior
- NO quotes, NO exclamation marks, NO conversion scores
- Maintain same professional tone from Parts 1 & 2

WRONG: "Here are topics for your audience (92/100 conv)" (has scores, no search data)
RIGHT: "For Safety Managers, these topics target incident prevention searches (4.2k/mo, Low competition), directly addressing their post-incident reporting needs. Which should we write?"

Direct and factual with search volume and competition data. This completes your 3-part presentation.`;

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
