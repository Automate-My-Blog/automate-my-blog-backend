/**
 * Voice & Style Analyzer Service
 * Analyzes writing samples via OpenAI and maintains aggregated voice profiles.
 *
 * @see GitHub issue #247
 */
import OpenAI from 'openai';
import db from './database.js';

const ANALYSIS_MODEL = 'gpt-4o';
const ANALYSIS_TEMPERATURE = 0.2;

const VOICE_ANALYSIS_SYSTEM = `You are an expert writing analyst. Analyze the given text and extract voice and style patterns in a structured way.

Respond with a single JSON object (no markdown, no code block) with these exact keys:
- style_analysis: object with sentence_length_distribution (short/medium/long ratio or description), paragraph_length_preference, voice_perspective (first/second/third), active_vs_passive_ratio (description), question_frequency, list_usage
- vocabulary_analysis: object with complexity_score (Flesch-Kincaid level or description), formality_level (casual to academic), industry_terms (array or description), signature_phrases (array if any), metaphor_humor_style (e.g. celebratory, warm, enthusiastic, dry, none)
- structural_patterns: object with opening_hook_type, section_organization, transition_phrases (array or description), evidence_style (how facts/claims are presented: e.g. "concrete milestones", "numbers", "statistics", "achievements"), conclusion_type (e.g. "personal sign-off", "summary", "CTA"), personal_sign_off (boolean or description if author signs with name)
- formatting_preferences: object with heading_frequency, bullet_vs_numbered, emphasis_style (bold/italic patterns), blockquote_usage
- quality_score: number 0-100 indicating how representative and analyzable the sample is (length, clarity, consistency).`;

function buildVoiceAnalysisUserMessage(content) {
  const preview = content.length > 12000 ? content.slice(0, 12000) + '\n\n[Content truncated for analysis.]' : content;
  return `Analyze the following writing sample and extract voice and style patterns.\n\n---\n\n${preview}`;
}

export class VoiceAnalyzerService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Run OpenAI voice analysis on raw text. Returns structured analysis + quality_score.
   * @param {string} content - Raw text to analyze
   * @returns {Promise<{ style_analysis: object, vocabulary_analysis: object, structural_patterns: object, formatting_preferences: object, quality_score: number }>}
   */
  async runVoiceAnalysis(content) {
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('Content is required and must be non-empty');
    }

    const response = await this.openai.chat.completions.create({
      model: ANALYSIS_MODEL,
      temperature: ANALYSIS_TEMPERATURE,
      messages: [
        { role: 'system', content: VOICE_ANALYSIS_SYSTEM },
        { role: 'user', content: buildVoiceAnalysisUserMessage(content) },
      ],
      response_format: { type: 'json_object' },
    });

    const raw = response.choices?.[0]?.message?.content;
    if (!raw) throw new Error('Empty analysis response from OpenAI');

    let parsed;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      throw new Error(`Invalid JSON from voice analysis: ${e.message}`);
    }

    const style_analysis = normalizeObject(parsed.style_analysis);
    const vocabulary_analysis = normalizeObject(parsed.vocabulary_analysis);
    const structural_patterns = normalizeObject(parsed.structural_patterns);
    const formatting_preferences = normalizeObject(parsed.formatting_preferences);
    let quality_score = Number(parsed.quality_score);
    if (Number.isNaN(quality_score) || quality_score < 0) quality_score = 50;
    if (quality_score > 100) quality_score = 100;

    return {
      style_analysis,
      vocabulary_analysis,
      structural_patterns,
      formatting_preferences,
      quality_score: Math.round(quality_score),
    };
  }

  /**
   * Load one voice sample, run analysis, store results, then trigger aggregation.
   * @param {string} voiceSampleId - UUID of voice_samples row
   */
  async analyzeVoiceSample(voiceSampleId) {
    const get = await db.query(
      'SELECT id, organization_id, raw_content, title FROM voice_samples WHERE id = $1 AND is_active = TRUE',
      [voiceSampleId]
    );
    if (get.rows.length === 0) {
      throw new Error('Voice sample not found or inactive');
    }
    const row = get.rows[0];
    const organizationId = row.organization_id;

    await db.query(
      "UPDATE voice_samples SET processing_status = 'processing', error_message = NULL, updated_at = NOW() WHERE id = $1",
      [voiceSampleId]
    );

    try {
      const result = await this.runVoiceAnalysis(row.raw_content || '');

      await db.query(
        `UPDATE voice_samples SET
          style_analysis = $2, vocabulary_analysis = $3, structural_patterns = $4, formatting_preferences = $5,
          quality_score = $6, processing_status = 'completed', error_message = NULL, updated_at = NOW()
         WHERE id = $1`,
        [
          voiceSampleId,
          JSON.stringify(result.style_analysis),
          JSON.stringify(result.vocabulary_analysis),
          JSON.stringify(result.structural_patterns),
          JSON.stringify(result.formatting_preferences),
          result.quality_score,
        ]
      );

      await this.updateAggregatedProfile(organizationId);
    } catch (err) {
      const message = err?.message || String(err);
      await db.query(
        "UPDATE voice_samples SET processing_status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1",
        [voiceSampleId, message.slice(0, 2000)]
      );
      throw err;
    }
  }

  /**
   * Recompute aggregated voice profile from all active completed samples and upsert.
   * Calls update_organization_data_availability(organizationId) after upsert.
   * @param {string} organizationId - UUID of organization
   */
  async updateAggregatedProfile(organizationId) {
    const samples = await db.query(
      `SELECT style_analysis, vocabulary_analysis, structural_patterns, formatting_preferences, weight, word_count
       FROM voice_samples
       WHERE organization_id = $1 AND is_active = TRUE AND processing_status = 'completed'
         AND style_analysis IS NOT NULL AND style_analysis != '{}'::jsonb
       ORDER BY created_at DESC`,
      [organizationId]
    );

    const rows = samples.rows;
    const sample_count = rows.length;
    const total_word_count = rows.reduce((sum, r) => sum + (Number(r.word_count) || 0), 0);

    let style = {};
    let vocabulary = {};
    let structure = {};
    let formatting = {};

    if (rows.length > 0) {
      const totalWeight = rows.reduce((s, r) => s + (Number(r.weight) || 1), 0);
      for (const r of rows) {
        const w = (Number(r.weight) || 1) / totalWeight;
        style = mergeWeighted(style, r.style_analysis || {}, w);
        vocabulary = mergeWeighted(vocabulary, r.vocabulary_analysis || {}, w);
        structure = mergeWeighted(structure, r.structural_patterns || {}, w);
        formatting = mergeWeighted(formatting, r.formatting_preferences || {}, w);
      }
    }

    const confidence_score = computeConfidenceScore(sample_count, total_word_count, rows);

    await db.query(
      `INSERT INTO aggregated_voice_profiles (
         organization_id, style, vocabulary, structure, formatting,
         sample_count, total_word_count, confidence_score, updated_at
       ) VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8, NOW())
       ON CONFLICT (organization_id) DO UPDATE SET
         style = EXCLUDED.style, vocabulary = EXCLUDED.vocabulary,
         structure = EXCLUDED.structure, formatting = EXCLUDED.formatting,
         sample_count = EXCLUDED.sample_count, total_word_count = EXCLUDED.total_word_count,
         confidence_score = EXCLUDED.confidence_score, updated_at = NOW()`,
      [
        organizationId,
        JSON.stringify(style),
        JSON.stringify(vocabulary),
        JSON.stringify(structure),
        JSON.stringify(formatting),
        sample_count,
        total_word_count,
        confidence_score,
      ]
    );

    await db.query('SELECT update_organization_data_availability($1)', [organizationId]);
  }
}

function normalizeObject(v) {
  if (v != null && typeof v === 'object' && !Array.isArray(v)) return v;
  return {};
}

function mergeWeighted(acc, obj, weight) {
  const out = { ...acc };
  for (const [k, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      out[k] = out[k] === undefined ? val : out[k];
    } else if (Array.isArray(val)) {
      if (!Array.isArray(out[k])) out[k] = [];
      out[k] = [...new Set([...out[k], ...val])];
    } else if (typeof val === 'object') {
      out[k] = mergeWeighted(out[k] || {}, val, weight);
    }
  }
  return out;
}

function computeConfidenceScore(sampleCount, totalWordCount, rows) {
  let score = 0;
  if (sampleCount >= 1) score += 25;
  if (sampleCount >= 3) score += 25;
  if (sampleCount >= 5) score += 15;
  if (totalWordCount >= 500) score += 15;
  if (totalWordCount >= 2000) score += 10;
  if (totalWordCount >= 5000) score += 10;
  const withQuality = rows.filter((r) => r.style_analysis && Object.keys(r.style_analysis).length > 0).length;
  if (withQuality === sampleCount && sampleCount > 0) score += 10;
  return Math.min(100, score);
}

const voiceAnalyzerService = new VoiceAnalyzerService();
export default voiceAnalyzerService;
