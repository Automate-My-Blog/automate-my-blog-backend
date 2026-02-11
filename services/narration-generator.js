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
    audiences
  } = params;

  const audienceProblems = audiences
    ?.map(a => a.problem)
    .filter(Boolean)
    .slice(0, 3) || [];

  console.log('📊 [NARRATION] Audience context:', {
    businessName,
    businessType,
    audienceCount: audiences?.length || 0,
    problemCount: audienceProblems.length,
    hasAnalysisData: !!analysisData
  });

  const prompt = `You are a business consultant. This is PART 2 of your presentation (continuing from analysis findings).

Business: ${businessName} (${businessType || 'Not specified'})

Audience Segments Found (${audiences?.length || 0}):
${audienceProblems.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Write the next statement (1-2 sentences, max 130 chars) that:
- Introduces the ${audiences?.length || 0} audience segments you discovered
- Explains WHY they fit the target market (shared characteristics or behaviors)
- Asks which one to focus on
- NO quotes, NO exclamation marks, NO flowery words
- Keep the same consultant perspective as Part 1

WRONG: "I found 5 audiences struggling with X, Y, Z" (just lists problems)
RIGHT: "I found ${audiences?.length || 0} distinct audiences that fit your target market because they both [specific shared trait] and [specific behavior]. Which one should we focus on?"

Direct and factual. This continues your presentation and leads to showing topics next.`;

  console.log('💬 [NARRATION] Prompt length:', prompt.length, 'characters');

  try {
    console.log('🤖 [NARRATION] Calling OpenAI API...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 110,
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
    selectedAudience
  } = params;

  const audience = selectedAudience;
  const audienceSegment = audience?.segment || 'your target audience';
  const problem = audience?.problem || 'content challenges';
  const pitch = audience?.pitch || null;

  console.log('📊 [NARRATION] Topic context:', {
    businessName,
    businessType,
    audienceSegment,
    hasProblem: !!problem,
    hasPitch: !!pitch,
    hasValue: !!audience?.value
  });

  const prompt = `You are a business consultant. This is PART 3 (final) of your presentation.

They selected: ${audienceSegment}
Their problem: ${problem}

Write the final statement (1-2 sentences, max 120 chars) that:
- Acknowledges their audience choice briefly
- Introduces topic recommendations with specific REASONS they'll drive results
- NOT generic phrases like "content challenges" or "help with"
- Explain WHY (e.g., "high search volume", "addresses pain point", "drives conversions")
- NO quotes, NO exclamation marks
- Maintain same professional tone from Parts 1 & 2

WRONG: "Here are topics to address content challenges" (generic, no reasoning)
RIGHT: "For ${audienceSegment}, here are blog ideas that should drive results because they [specific reason like "target high-volume searches"] and [specific reason like "address their main pain point"]. Which one should we write?"

Direct and factual. This completes your 3-part presentation.`;

  console.log('💬 [NARRATION] Prompt length:', prompt.length, 'characters');

  try {
    console.log('🤖 [NARRATION] Calling OpenAI API...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
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
