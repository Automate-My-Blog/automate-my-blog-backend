/**
 * Build display-ready voice profile data for the API response.
 * Surfaces all voice properties and derived directives for frontend display.
 */
import enhancedBlogGenerationService from '../services/enhanced-blog-generation.js';

/** Human-readable labels for voice profile keys. Use for display in UI. */
export const VOICE_PROPERTY_LABELS = {
  style: {
    voice_perspective: 'Voice perspective',
    sentence_length_distribution: 'Sentence length',
    paragraph_length_preference: 'Paragraph length',
    active_vs_passive_ratio: 'Active vs passive voice',
    question_frequency: 'Question usage',
    list_usage: 'List usage',
  },
  vocabulary: {
    formality_level: 'Formality level',
    complexity_score: 'Vocabulary complexity',
    industry_terms: 'Industry terms',
    signature_phrases: 'Signature phrases',
    metaphor_humor_style: 'Tone and style',
  },
  structure: {
    opening_hook_type: 'Opening style',
    section_organization: 'Section organization',
    transition_phrases: 'Transition phrases',
    evidence_style: 'Evidence and facts style',
    conclusion_type: 'Conclusion type',
    personal_sign_off: 'Personal sign-off',
  },
  formatting: {
    heading_frequency: 'Heading frequency',
    bullet_vs_numbered: 'List style',
    emphasis_style: 'Emphasis (bold/italic)',
    blockquote_usage: 'Blockquote usage',
  },
};

/**
 * Build display sections from raw profile for frontend rendering.
 * @param {object} profile - Raw aggregated_voice_profiles row
 * @returns {{ sections: Array<{ section: string, items: Array<{ key: string, label: string, value: unknown }> }>, derivedDirectives: string[] }}
 */
export function buildVoiceProfileDisplay(profile) {
  if (!profile) return { sections: [], derivedDirectives: [] };

  const compact = enhancedBlogGenerationService.compactVoiceProfileForPrompt(profile);
  const directivesStr = enhancedBlogGenerationService.deriveVoiceDirectives(compact);
  const derivedDirectives = parseDirectives(directivesStr);

  const sections = [];
  const categories = [
    { key: 'style', label: 'Writing style', data: profile.style || {} },
    { key: 'vocabulary', label: 'Vocabulary & tone', data: profile.vocabulary || {} },
    { key: 'structure', label: 'Structure', data: profile.structure || {} },
    { key: 'formatting', label: 'Formatting', data: profile.formatting || {} },
  ];

  for (const { key, label, data } of categories) {
    const labels = VOICE_PROPERTY_LABELS[key] || {};
    const items = [];
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || v === null) continue;
      items.push({
        key: k,
        label: labels[k] || k,
        value: formatValue(v),
      });
    }
    if (items.length > 0) {
      sections.push({ section: label, items });
    }
  }

  return { sections, derivedDirectives };
}

function parseDirectives(str) {
  if (!str || typeof str !== 'string') return [];
  const match = str.match(/- (.+)/g);
  return match ? match.map((m) => m.replace(/^-\s+/, '').trim()) : [];
}

function formatValue(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'object' && v !== null) return v;
  return v;
}
