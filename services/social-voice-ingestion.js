import OpenAI from 'openai';
import db from './database.js';
import grokTweetSearch from './grok-tweet-search.js';
import youtubeVideoSearch from './youtube-video-search.js';

/**
 * Social voice ingestion: build a text corpus from an organization's social handles
 * (YouTube channel titles/descriptions; Twitter/X via Grok; LinkedIn etc. when APIs are available).
 * Used to derive brand voice from social content (see docs/brand-voice-from-social-media-proposal.md).
 */

const DEFAULT_MAX_YOUTUBE_ITEMS = 20;
const DEFAULT_MAX_TWITTER_TWEETS_PER_HANDLE = 20;
const MIN_CORPUS_WORDS_FOR_VOICE = 50;

/**
 * Normalize handle for a platform (strip @ if needed for API, keep consistent shape).
 * @param {string} handle
 * @param {string} platform
 * @returns {string}
 */
function normalizeHandle(handle, platform) {
  if (!handle || typeof handle !== 'string') return '';
  const t = handle.trim();
  if (platform === 'youtube') {
    return t; // keep @handle, c/name, channel/ID as-is for YouTube API
  }
  return t;
}

/**
 * Ingest content from YouTube handles: fetch recent video titles + descriptions per channel.
 * @param {string[]} handles - Array of YouTube handles (e.g. ["@acme"], ["c/name"])
 * @param {number} maxItemsPerChannel
 * @returns {Promise<Array<{ title: string, description: string }>>}
 */
async function ingestYouTube(handles, maxItemsPerChannel = DEFAULT_MAX_YOUTUBE_ITEMS) {
  if (!handles || !Array.isArray(handles) || handles.length === 0) return [];
  const out = [];
  for (const h of handles) {
    const handle = normalizeHandle(h, 'youtube');
    if (!handle) continue;
    const items = await youtubeVideoSearch.getChannelContentByHandle(handle, maxItemsPerChannel);
    out.push(...items);
  }
  return out;
}

/**
 * Ingest content from Twitter/X handles via Grok (x_search with from:handle).
 * @param {string[]} handles - Array of Twitter handles (e.g. ["@acme"], ["acme"])
 * @param {number} maxTweetsPerHandle
 * @returns {Promise<Array<{ text: string, author?: string, handle?: string }>>}
 */
async function ingestTwitter(handles, maxTweetsPerHandle = DEFAULT_MAX_TWITTER_TWEETS_PER_HANDLE) {
  if (!handles || !Array.isArray(handles) || handles.length === 0) return [];
  const out = [];
  for (const h of handles) {
    const handle = normalizeHandle(h, 'twitter');
    if (!handle) continue;
    const tweets = await grokTweetSearch.getRecentTweetsByHandle(handle, maxTweetsPerHandle);
    out.push(...tweets.map((t) => ({ text: t.text || '', author: t.author, handle: t.handle })));
  }
  return out;
}

/**
 * Build a single text corpus from all ingested content (for OpenAI voice analysis).
 * @param {Object} byPlatform - { youtube: Array<{title, description}>, twitter: Array<{text}> }
 * @returns {{ corpus: string, wordCount: number }}
 */
function buildCorpus(byPlatform) {
  const parts = [];
  if (byPlatform.youtube && byPlatform.youtube.length > 0) {
    parts.push('## YouTube (channel content)\n');
    byPlatform.youtube.forEach((item) => {
      if (item.title) parts.push(`Title: ${item.title}`);
      if (item.description) parts.push(`Description: ${item.description}`);
      parts.push('');
    });
  }
  if (byPlatform.twitter && byPlatform.twitter.length > 0) {
    parts.push('## X / Twitter (posts)\n');
    byPlatform.twitter.forEach((item) => {
      if (item.text) parts.push(item.text);
      parts.push('');
    });
  }
  const corpus = parts.join('\n').trim();
  const wordCount = corpus.split(/\s+/).filter(Boolean).length;
  return { corpus, wordCount };
}

/**
 * Ingest social content for an organization and return a merged corpus.
 * @param {Object} options
 * @param {string} options.organizationId - Organization UUID
 * @param {Object} [options.socialHandles] - If provided, used instead of reading from DB (e.g. from refresh flow)
 * @param {number} [options.maxYouTubeItemsPerChannel] - Max recent videos per YouTube channel (default 20)
 * @param {number} [options.maxTwitterTweetsPerHandle] - Max tweets per Twitter handle (default 20)
 * @returns {Promise<{ corpus: string, wordCount: number, byPlatform: Object, platformsUsed: string[] }>}
 */
export async function ingestSocialContentForOrganization({
  organizationId,
  socialHandles: socialHandlesOverride,
  maxYouTubeItemsPerChannel = DEFAULT_MAX_YOUTUBE_ITEMS,
  maxTwitterTweetsPerHandle = DEFAULT_MAX_TWITTER_TWEETS_PER_HANDLE
} = {}) {
  let socialHandles = socialHandlesOverride;
  if (socialHandles == null) {
    const row = await db.query(
      'SELECT social_handles FROM organizations WHERE id = $1',
      [organizationId]
    );
    socialHandles = row.rows[0]?.social_handles || {};
  }
  if (typeof socialHandles !== 'object' || Object.keys(socialHandles).length === 0) {
    return {
      corpus: '',
      wordCount: 0,
      byPlatform: {},
      platformsUsed: []
    };
  }

  const byPlatform = {};
  const platformsUsed = [];

  // YouTube: we have API support
  const youtubeHandles = socialHandles.youtube || socialHandles.yt || [];
  if (youtubeHandles.length > 0) {
    const items = await ingestYouTube(youtubeHandles, maxYouTubeItemsPerChannel);
    byPlatform.youtube = items;
    if (items.length > 0) platformsUsed.push('youtube');
  }

  // Twitter/X: Grok x_search with from:handle
  const twitterHandles = socialHandles.twitter || socialHandles.x || [];
  if (twitterHandles.length > 0) {
    const tweets = await ingestTwitter(twitterHandles, maxTwitterTweetsPerHandle);
    byPlatform.twitter = tweets;
    if (tweets.length > 0) platformsUsed.push('twitter');
  }

  // LinkedIn, Instagram, etc.: would need respective APIs or optional scrape; skip for now.

  const { corpus, wordCount } = buildCorpus(byPlatform);
  return {
    corpus,
    wordCount,
    byPlatform,
    platformsUsed
  };
}

/**
 * Whether the ingested corpus has enough content to run voice analysis.
 * @param {number} wordCount
 * @returns {boolean}
 */
export function hasEnoughContentForVoice(wordCount) {
  return wordCount >= MIN_CORPUS_WORDS_FOR_VOICE;
}

export { MIN_CORPUS_WORDS_FOR_VOICE };

function getOpenAI() {
  if (!getOpenAI._client) {
    getOpenAI._client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return getOpenAI._client;
}

/**
 * Parse JSON from OpenAI response (strip markdown code blocks if present).
 * @param {string} response
 * @returns {Object}
 */
function parseAIResponse(response) {
  try {
    let cleaned = (response || '').trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    return JSON.parse(cleaned.trim());
  } catch (e) {
    console.error('Failed to parse social voice AI response:', e);
    return {};
  }
}

/**
 * Analyze social corpus with OpenAI to derive tone, style, and brand voice keywords.
 * Returns shape compatible with content_analysis_results / social_voice_analysis (snake_case).
 * @param {string} corpus - Merged text from social content (e.g. YouTube titles/descriptions)
 * @returns {Promise<{ tone_analysis: Object, style_patterns: Object, brand_voice_keywords: string[] }>}
 */
export async function analyzeVoiceFromSocialCorpus(corpus) {
  if (!corpus || corpus.trim().length === 0) {
    return { tone_analysis: {}, style_patterns: {}, brand_voice_keywords: [] };
  }

  const startMs = Date.now();
  const prompt = `Analyze this brand's social media content (e.g. video titles and descriptions) to identify their voice and style.

Content:
${corpus.slice(0, 12000)}

Provide analysis in this exact JSON format (no other text):
{
  "toneAnalysis": {
    "primaryTone": "professional|casual|friendly|authoritative|conversational|witty|inspirational",
    "confidence": 0.0 to 1.0,
    "toneCharacteristics": ["list", "of", "observed", "traits"]
  },
  "stylePatterns": {
    "sentenceLength": "short|medium|long",
    "useOfQuestions": "frequent|occasional|rare",
    "personalPronouns": "first_person|third_person|mixed",
    "technicalLanguage": "high|medium|low",
    "voiceDescription": "brief description of how they communicate"
  },
  "brandVoiceKeywords": ["keyword1", "keyword2", "keyword3"]
}`;

  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a content strategist analyzing social media content to identify brand voice, tone, and style. Return only valid JSON.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 800
    });
    const text = completion.choices[0]?.message?.content;
    if (!text) return { tone_analysis: {}, style_patterns: {}, brand_voice_keywords: [] };
    const parsed = parseAIResponse(text);
    const durationMs = Date.now() - startMs;
    return {
      tone_analysis: parsed.toneAnalysis || {},
      style_patterns: parsed.stylePatterns || {},
      brand_voice_keywords: Array.isArray(parsed.brandVoiceKeywords) ? parsed.brandVoiceKeywords : [],
      _meta: { ai_model_used: 'gpt-4o', analysis_duration_ms: durationMs }
    };
  } catch (error) {
    console.error('Social voice analysis error:', error);
    return { tone_analysis: {}, style_patterns: {}, brand_voice_keywords: [] };
  }
}

/**
 * Persist social voice analysis for an organization. Marks previous row as not current.
 * @param {string} organizationId
 * @param {Object} data
 * @param {string[]} data.platforms_used
 * @param {number} data.corpus_word_count
 * @param {Object} data.tone_analysis
 * @param {Object} data.style_patterns
 * @param {string[]} data.brand_voice_keywords
 * @param {string} [data.ai_model_used]
 * @param {number} [data.analysis_duration_ms]
 */
export async function persistSocialVoiceAnalysis(organizationId, data) {
  await db.query(
    `UPDATE social_voice_analysis SET is_current = FALSE WHERE organization_id = $1`,
    [organizationId]
  );
  await db.query(
    `INSERT INTO social_voice_analysis (
      organization_id, platforms_used, corpus_word_count,
      tone_analysis, style_patterns, brand_voice_keywords,
      ai_model_used, analysis_duration_ms, is_current
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)`,
    [
      organizationId,
      (data.platforms_used || []).filter(Boolean),
      data.corpus_word_count ?? 0,
      JSON.stringify(data.tone_analysis || {}),
      JSON.stringify(data.style_patterns || {}),
      JSON.stringify(data.brand_voice_keywords || []),
      data.ai_model_used || null,
      data.analysis_duration_ms ?? null
    ]
  );
}
