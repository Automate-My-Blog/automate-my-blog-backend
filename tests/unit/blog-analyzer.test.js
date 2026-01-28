import { describe, it, expect, vi } from 'vitest';

vi.mock('openai', () => ({
  default: class MockOpenAI {
    constructor() {}
  },
}));

// Avoid DB connection when loading blog-analyzer (it imports database)
vi.mock('../../services/database.js', () => ({
  default: {
    query: vi.fn(),
    transaction: vi.fn((fn) => fn({ query: vi.fn() })),
    testConnection: vi.fn().mockRejectedValue(new Error('mock')),
  },
}));

vi.mock('../../services/webscraper.js', () => ({
  default: {
    discoverBlogPages: vi.fn(),
    scrapeBlogPosts: vi.fn(),
    extractCTAs: vi.fn(),
    extractInternalLinks: vi.fn(),
    urlsMatch: vi.fn((a, b) => a === b),
  },
}));

import blogAnalyzer from '../../services/blog-analyzer.js';

describe('blog-analyzer', () => {
  describe('parseAIResponse', () => {
    it('parses valid JSON', () => {
      const json = '{"tone": "professional", "confidence": 0.9}';
      expect(blogAnalyzer.parseAIResponse(json)).toEqual({ tone: 'professional', confidence: 0.9 });
    });

    it('strips ```json wrapper', () => {
      const wrapped = '```json\n{"a": 1}\n```';
      expect(blogAnalyzer.parseAIResponse(wrapped)).toEqual({ a: 1 });
    });

    it('strips plain ``` wrapper', () => {
      const wrapped = '```\n{"b": 2}\n```';
      expect(blogAnalyzer.parseAIResponse(wrapped)).toEqual({ b: 2 });
    });

    it('returns error object on invalid JSON', () => {
      const out = blogAnalyzer.parseAIResponse('not json at all');
      expect(out).toHaveProperty('error', 'Failed to parse AI analysis');
    });

    it('handles empty string', () => {
      const out = blogAnalyzer.parseAIResponse('');
      expect(out).toHaveProperty('error', 'Failed to parse AI analysis');
    });

    it('trims whitespace', () => {
      expect(blogAnalyzer.parseAIResponse('  \n  {"x": 1}  \n  ')).toEqual({ x: 1 });
    });
  });

  describe('analyzeLinkingPatterns', () => {
    it('returns context and type distribution for links', async () => {
      const links = [
        { context: 'nav', linkType: 'menu' },
        { context: 'nav', linkType: 'menu' },
        { context: 'footer', linkType: 'footer' },
      ];
      const out = await blogAnalyzer.analyzeLinkingPatterns(links);
      expect(out.contextDistribution).toEqual({ nav: 2, footer: 1 });
      expect(out.typeDistribution).toEqual({ menu: 2, footer: 1 });
      expect(out.totalInternalLinks).toBe(3);
    });

    it('classifies density: low (<=10), medium (11–20), high (>20)', async () => {
      const low = await blogAnalyzer.analyzeLinkingPatterns(Array(5).fill({ context: 'x', linkType: 'y' }));
      const medium = await blogAnalyzer.analyzeLinkingPatterns(Array(15).fill({ context: 'x', linkType: 'y' }));
      const high = await blogAnalyzer.analyzeLinkingPatterns(Array(25).fill({ context: 'x', linkType: 'y' }));
      expect(low.linkingDensity).toBe('low');
      expect(medium.linkingDensity).toBe('medium');
      expect(high.linkingDensity).toBe('high');
    });

    it('handles empty links', async () => {
      const out = await blogAnalyzer.analyzeLinkingPatterns([]);
      expect(out.contextDistribution).toEqual({});
      expect(out.typeDistribution).toEqual({});
      expect(out.totalInternalLinks).toBe(0);
      expect(out.linkingDensity).toBe('low');
    });
  });

  describe('categorizeLinks', () => {
    it('puts links in context and linkType buckets', () => {
      const links = [
        { context: 'navigation', linkType: 'blog' },
        { context: 'sidebar', linkType: 'blog' },
      ];
      const out = blogAnalyzer.categorizeLinks(links);
      expect(out.navigation).toHaveLength(1);
      expect(out.sidebar).toHaveLength(1);
      expect(out.blog).toHaveLength(2);
    });

    it('handles unknown context/linkType gracefully', () => {
      const links = [{ context: 'unknown_ctx', linkType: 'unknown_type' }];
      const out = blogAnalyzer.categorizeLinks(links);
      expect(out.navigation).toHaveLength(0);
      expect(out.content).toHaveLength(0);
    });
  });

  describe('generateCTARecommendations', () => {
    it('recommends adding CTAs when none exist', () => {
      const recs = blogAnalyzer.generateCTARecommendations([], {});
      expect(recs.length).toBeGreaterThan(0);
      expect(recs.some((r) => r.toLowerCase().includes('call-to-action') || r.toLowerCase().includes('cta'))).toBe(true);
    });

    it('recommends diversifying when fewer than 3 CTA types', () => {
      const ctas = [
        { type: 'button', placement: 'header' },
        { type: 'button', placement: 'footer' },
      ];
      const recs = blogAnalyzer.generateCTARecommendations(ctas, {});
      expect(recs.some((r) => r.toLowerCase().includes('diversif'))).toBe(true);
    });

    it('recommends header CTA when missing', () => {
      const ctas = [{ type: 'button', placement: 'footer' }];
      const recs = blogAnalyzer.generateCTARecommendations(ctas, {});
      expect(recs.some((r) => r.toLowerCase().includes('header'))).toBe(true);
    });

    it('adds effectiveness tips when strategy.effectiveness is low', () => {
      const ctas = [{ type: 'button', placement: 'header' }];
      const strategy = { effectiveness: 'low' };
      const recs = blogAnalyzer.generateCTARecommendations(ctas, strategy);
      expect(recs.some((r) => r.toLowerCase().includes('action') || r.toLowerCase().includes('visibility'))).toBe(true);
    });
  });

  describe('generateLinkingRecommendations', () => {
    it('recommends more internal links when totalInternalLinks < 10', () => {
      const categories = { blog: [], navigation: [], content: [], footer: [], sidebar: [], product: [], about: [], contact: [] };
      const strategy = { totalInternalLinks: 5, linkingDensity: 'low' };
      const recs = blogAnalyzer.generateLinkingRecommendations(categories, strategy);
      expect(recs.length).toBeGreaterThan(0);
      expect(recs.some((r) => r.toLowerCase().includes('internal link') || r.toLowerCase().includes('linking'))).toBe(true);
    });

    it('recommends more blog cross-links when blog category has few', () => {
      const categories = { blog: [{}, {}], navigation: [], content: [], footer: [], sidebar: [], product: [], about: [], contact: [] };
      const strategy = { totalInternalLinks: 15, linkingDensity: 'medium' };
      const recs = blogAnalyzer.generateLinkingRecommendations(categories, strategy);
      expect(recs.some((r) => r.toLowerCase().includes('blog'))).toBe(true);
    });
  });

  describe('assessAnalysisQuality', () => {
    it('scores excellent (80+) with enough posts, CTAs, and links', () => {
      const posts = [{}, {}, {}];
      const ctas = { totalCTAs: 6 };
      const linking = { totalLinks: 12 };
      const out = blogAnalyzer.assessAnalysisQuality(posts, ctas, linking);
      expect(out.score).toBeGreaterThanOrEqual(80);
      expect(out.quality).toBe('excellent');
    });

    it('scores good (60–79) with moderate data', () => {
      const posts = [{}, {}];
      const ctas = { totalCTAs: 4 };
      const linking = { totalLinks: 11 };
      const out = blogAnalyzer.assessAnalysisQuality(posts, ctas, linking);
      expect(out.score).toBeGreaterThanOrEqual(60);
      expect(out.quality).toBe('good');
    });

    it('scores fair (40–59) with limited data', () => {
      const posts = [{}];
      const ctas = { totalCTAs: 1 };
      const linking = { totalLinks: 3 };
      const out = blogAnalyzer.assessAnalysisQuality(posts, ctas, linking);
      expect(out.score).toBeGreaterThanOrEqual(40);
      expect(out.quality).toBe('fair');
    });

    it('scores limited with no posts or CTAs or links', () => {
      const out = blogAnalyzer.assessAnalysisQuality([], { totalCTAs: 0 }, { totalLinks: 0 });
      expect(out.quality).toBe('limited');
      expect(out.factors.length).toBeGreaterThan(0);
    });

    it('caps score at 100', () => {
      const posts = Array(10).fill({});
      const ctas = { totalCTAs: 20 };
      const linking = { totalLinks: 30 };
      const out = blogAnalyzer.assessAnalysisQuality(posts, ctas, linking);
      expect(out.score).toBeLessThanOrEqual(100);
    });
  });

  describe('createBasicAnalysis', () => {
    it('returns structure for sites with no blog content', () => {
      const out = blogAnalyzer.createBasicAnalysis('https://example.com');
      expect(out.success).toBe(true);
      expect(out.blogContentFound).toBe(0);
      expect(out.totalPostsDiscovered).toBe(0);
      expect(out.blogSections).toEqual([]);
      expect(out.contentPatterns).toBeDefined();
      expect(out.contentPatterns.toneAnalysis.tone).toBe('unknown');
      expect(out.ctaStrategy.totalCTAs).toBe(0);
      expect(out.linkingStrategy.totalLinks).toBe(0);
      expect(out.analysisQuality.quality).toBe('limited');
      expect(out.recommendations.immediate).toBeDefined();
      expect(out.recommendations.strategic).toBeDefined();
    });
  });
});
