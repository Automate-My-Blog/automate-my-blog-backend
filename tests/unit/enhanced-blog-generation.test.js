/**
 * Unit tests: Enhanced blog generation — request CTAs normalization and prompt/result behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openai', () => ({
  default: class MockOpenAI {
    constructor() {}
  }
}));

vi.mock('../../services/database.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../services/stream-manager.js', () => ({ default: { publish: vi.fn() } }));
vi.mock('../../services/visual-content-generation.js', () => ({ default: {} }));
vi.mock('../../services/grok-tweet-search.js', () => ({ default: {} }));
vi.mock('../../services/youtube-video-search.js', () => ({ default: {} }));
vi.mock('../../services/news-article-search.js', () => ({ default: {} }));
vi.mock('../../services/email.js', () => ({ default: {} }));

vi.mock('../../services/openai.js', () => ({
  OpenAIService: class OpenAIService {
    constructor() {}
  }
}));

import enhancedBlogGenerationService from '../../services/enhanced-blog-generation.js';

describe('enhanced-blog-generation', () => {
  const service = enhancedBlogGenerationService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('normalizeRequestCtas', () => {
    it('returns empty array for non-array input', () => {
      expect(service.normalizeRequestCtas(null)).toEqual([]);
      expect(service.normalizeRequestCtas(undefined)).toEqual([]);
      expect(service.normalizeRequestCtas('')).toEqual([]);
      expect(service.normalizeRequestCtas({})).toEqual([]);
    });

    it('returns empty array for empty array', () => {
      expect(service.normalizeRequestCtas([])).toEqual([]);
    });

    it('filters out items without text property', () => {
      expect(service.normalizeRequestCtas([{ href: '/x' }])).toEqual([]);
      expect(service.normalizeRequestCtas([null, { text: 'OK' }, undefined])).toEqual([
        { cta_text: 'OK', href: '', cta_type: 'general', placement: 'inline', context: null }
      ]);
    });

    it('keeps items with empty string text (normalizes to internal shape)', () => {
      const out = service.normalizeRequestCtas([{ text: '' }]);
      expect(out).toHaveLength(1);
      expect(out[0].cta_text).toBe('');
    });

    it('normalizes minimal request CTA to internal shape', () => {
      const out = service.normalizeRequestCtas([{ text: 'Sign Up' }]);
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual({
        cta_text: 'Sign Up',
        href: '',
        cta_type: 'general',
        placement: 'inline',
        context: null
      });
    });

    it('normalizes full request CTA with href, type, placement', () => {
      const out = service.normalizeRequestCtas([
        { text: 'Book a Demo', href: '/demo', type: 'demo_link', placement: 'end-of-post' }
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual({
        cta_text: 'Book a Demo',
        href: '/demo',
        cta_type: 'demo_link',
        placement: 'end-of-post',
        context: null
      });
    });

    it('uses defaults for missing type and placement', () => {
      const out = service.normalizeRequestCtas([{ text: 'Contact', href: '/contact' }]);
      expect(out[0].cta_type).toBe('general');
      expect(out[0].placement).toBe('inline');
      expect(out[0].href).toBe('/contact');
    });

    it('normalizes multiple CTAs and keeps order', () => {
      const out = service.normalizeRequestCtas([
        { text: 'First', href: '/a' },
        { text: 'Second', type: 'button', placement: 'footer' }
      ]);
      expect(out).toHaveLength(2);
      expect(out[0].cta_text).toBe('First');
      expect(out[0].href).toBe('/a');
      expect(out[1].cta_text).toBe('Second');
      expect(out[1].cta_type).toBe('button');
      expect(out[1].placement).toBe('footer');
    });
  });

  describe('buildEnhancedPrompt with request CTAs', () => {
    const minimalContext = {
      availability: { has_cta_data: false, has_blog_content: false, has_internal_links: false },
      settings: {},
      manualData: {},
      websiteData: {},
      completenessScore: 0
    };
    const topic = { title: 'Test', subheader: '' };
    const businessInfo = { businessType: 'B2B', targetAudience: 'SMB', brandVoice: 'pro' };

    it('includes AVAILABLE CTAS section when request CTAs are provided', () => {
      const requestCtas = [{ text: 'Book a Demo', href: '/demo', type: 'demo_link', placement: 'end-of-post' }];
      const prompt = service.buildEnhancedPrompt(
        topic,
        businessInfo,
        minimalContext,
        '',
        [],
        [],
        requestCtas
      );
      expect(prompt).toContain('AVAILABLE CTAS');
      expect(prompt).toContain('Book a Demo');
      expect(prompt).toContain('/demo');
      expect(prompt).toContain('demo_link');
      expect(prompt).toContain('end-of-post');
    });

    it('does not include AVAILABLE CTAS when request CTAs are empty', () => {
      const prompt = service.buildEnhancedPrompt(topic, businessInfo, minimalContext, '', [], [], []);
      expect(prompt).not.toContain('AVAILABLE CTAS');
    });
  });

  describe('buildEnhancedPrompt with voice profile', () => {
    const minimalContext = {
      availability: { has_cta_data: false, has_blog_content: false, has_internal_links: false },
      settings: {},
      manualData: {},
      websiteData: {},
      completenessScore: 0
    };
    const topic = { title: 'Test', subheader: '' };
    const businessInfo = { businessType: 'B2B', targetAudience: 'SMB', brandVoice: 'pro' };

    it('includes VOICE & STYLE section before BRAND VOICE when voiceProfile and confidence >= 50', () => {
      const contextWithVoice = {
        ...minimalContext,
        voiceProfile: {
          style: { voice_perspective: 'first', sentence_length: 'medium' },
          vocabulary: { formality_level: 'professional' },
          structure: {},
          formatting: {},
          confidence_score: 60
        }
      };
      const prompt = service.buildEnhancedPrompt(topic, businessInfo, contextWithVoice, '', [], [], []);
      expect(prompt).toContain('VOICE & STYLE (from your uploaded samples');
      expect(prompt).toContain('Match this writing style PRECISELY');
      expect(prompt).toContain('BRAND VOICE');
      const voicePos = prompt.indexOf('VOICE & STYLE');
      const brandPos = prompt.indexOf('BRAND VOICE');
      expect(voicePos).toBeLessThan(brandPos);
    });

    it('omits VOICE & STYLE section when confidence_score < 50', () => {
      const contextLowConfidence = {
        ...minimalContext,
        voiceProfile: {
          style: {},
          vocabulary: {},
          structure: {},
          formatting: {},
          confidence_score: 40
        }
      };
      const prompt = service.buildEnhancedPrompt(topic, businessInfo, contextLowConfidence, '', [], [], []);
      expect(prompt).not.toContain('VOICE & STYLE (from your uploaded samples');
    });

    it('omits VOICE & STYLE section when voiceProfile is null', () => {
      const prompt = service.buildEnhancedPrompt(topic, businessInfo, minimalContext, '', [], [], []);
      expect(prompt).not.toContain('VOICE & STYLE (from your uploaded samples');
    });
  });

  describe('deriveVoiceDirectives', () => {
    it('returns empty string when profile has no matching traits', () => {
      const compact = { style: {}, vocabulary: {}, structure: {}, formatting: {} };
      const out = service.deriveVoiceDirectives(compact);
      expect(out).toBe('');
    });

    it('adds first-person rule when voice_perspective or formality suggests it', () => {
      const compact = {
        style: { voice_perspective: 'first' },
        vocabulary: {},
        structure: {},
        formatting: {},
      };
      const out = service.deriveVoiceDirectives(compact);
      expect(out).toContain('MANDATORY voice rules');
      expect(out).toContain('first-person');
      expect(out).toContain('we, I');
    });

    it('adds bullet rule when list_usage or bullet_vs_numbered present', () => {
      const compact = {
        style: {},
        vocabulary: {},
        structure: {},
        formatting: { bullet_vs_numbered: 'bullet' },
      };
      const out = service.deriveVoiceDirectives(compact);
      expect(out).toContain('bullet lists');
    });

    it('adds sign-off rule when conclusion_type or personal_sign_off present', () => {
      const compact = {
        style: {},
        vocabulary: {},
        structure: { conclusion_type: 'personal sign-off' },
        formatting: {},
      };
      const out = service.deriveVoiceDirectives(compact);
      expect(out).toContain('personal sign-off');
    });

    it('adds celebratory rule when evidence_style or metaphor_humor_style suggests it', () => {
      const compact = {
        style: {},
        vocabulary: { metaphor_humor_style: 'celebratory and warm' },
        structure: { evidence_style: 'concrete milestones and numbers' },
        formatting: {},
      };
      const out = service.deriveVoiceDirectives(compact);
      expect(out).toContain('celebratory');
      expect(out).toContain('milestones');
    });
  });

  describe('voice comparison (your voice vs generic)', () => {
    it('buildEnhancedPrompt with voiceProfile null produces generic-style prompt', () => {
      const contextWithVoice = {
        availability: {},
        settings: {},
        manualData: {},
        websiteData: {},
        voiceProfile: { style: {}, vocabulary: {}, structure: {}, formatting: {}, confidence_score: 80 },
        completenessScore: 50
      };
      const genericContext = { ...contextWithVoice, voiceProfile: null };
      const withVoice = service.buildEnhancedPrompt(
        { title: 'T', subheader: '' },
        { businessType: 'B2B', targetAudience: 'SMB', brandVoice: 'pro' },
        contextWithVoice,
        '',
        [],
        [],
        []
      );
      const generic = service.buildEnhancedPrompt(
        { title: 'T', subheader: '' },
        { businessType: 'B2B', targetAudience: 'SMB', brandVoice: 'pro' },
        genericContext,
        '',
        [],
        [],
        []
      );
      expect(withVoice).toContain('VOICE & STYLE (from your uploaded samples');
      expect(generic).not.toContain('VOICE & STYLE (from your uploaded samples');
    });
  });
});
