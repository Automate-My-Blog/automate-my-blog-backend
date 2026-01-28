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
import webscraper from '../../services/webscraper.js';

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

    it('returns fewer recs when 3+ types, header present, effectiveness not low', () => {
      const ctas = [
        { type: 'button', placement: 'header' },
        { type: 'link', placement: 'footer' },
        { type: 'form', placement: 'sidebar' },
      ];
      const recs = blogAnalyzer.generateCTARecommendations(ctas, { effectiveness: 'high' });
      expect(recs).toBeDefined();
      expect(Array.isArray(recs)).toBe(true);
      expect(recs.some((r) => r.toLowerCase().includes('diversif'))).toBe(false);
      expect(recs.some((r) => r.toLowerCase().includes('header'))).toBe(false);
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

    it('returns empty recs when links >= 10, density not low, blog >= 3', () => {
      const categories = { blog: [{}, {}, {}], navigation: [], content: [], footer: [], sidebar: [], product: [], about: [], contact: [] };
      const strategy = { totalInternalLinks: 12, linkingDensity: 'medium' };
      const recs = blogAnalyzer.generateLinkingRecommendations(categories, strategy);
      expect(recs).toEqual([]);
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

    it('scores excellent at exact boundaries (3 posts, 5 CTAs, 10 links)', () => {
      const posts = [{}, {}, {}];
      const ctas = { totalCTAs: 5 };
      const linking = { totalLinks: 10 };
      const out = blogAnalyzer.assessAnalysisQuality(posts, ctas, linking);
      expect(out.quality).toBe('excellent');
      expect(out.score).toBeGreaterThanOrEqual(80);
    });

    it('scores good at exact boundaries (2 posts, 4 CTAs, 11 links)', () => {
      const posts = [{}, {}];
      const ctas = { totalCTAs: 4 };
      const linking = { totalLinks: 11 };
      const out = blogAnalyzer.assessAnalysisQuality(posts, ctas, linking);
      expect(out.quality).toBe('good');
      expect(out.score).toBeGreaterThanOrEqual(60);
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

  describe('analyzeBlogContent', () => {
    it('returns createBasicAnalysis when no blog posts discovered', async () => {
      vi.mocked(webscraper.discoverBlogPages).mockResolvedValueOnce({
        blogPosts: [],
        totalPostsFound: 0,
        blogSections: [],
      });
      const out = await blogAnalyzer.analyzeBlogContent('org-1', 'https://example.com');
      expect(out.success).toBe(true);
      expect(out.blogContentFound).toBe(0);
      expect(out.totalPostsDiscovered).toBe(0);
      expect(out.ctaStrategy.totalCTAs).toBe(0);
      expect(out.linkingStrategy.totalLinks).toBe(0);
      expect(out.analysisQuality.quality).toBe('limited');
    });
  });

  describe('analyzeContentPatterns', () => {
    it('returns default structure when no blog posts', async () => {
      const out = await blogAnalyzer.analyzeContentPatterns([]);
      expect(out.toneAnalysis).toEqual({ tone: 'unknown', confidence: 0 });
      expect(out.stylePatterns).toEqual({});
      expect(out.contentThemes).toEqual([]);
      expect(out.writingStyle).toBe('unknown');
    });

    it('returns default structure when null or undefined', async () => {
      const outNull = await blogAnalyzer.analyzeContentPatterns(null);
      expect(outNull.toneAnalysis.tone).toBe('unknown');
      const outUndef = await blogAnalyzer.analyzeContentPatterns(undefined);
      expect(outUndef.writingStyle).toBe('unknown');
    });

    it('returns analysis_failed when AI errors', async () => {
      const out = await blogAnalyzer.analyzeContentPatterns([{ title: 'T', content: 'C', headings: [] }]);
      expect(out.toneAnalysis.tone).toBe('analysis_failed');
      expect(out.writingStyle).toBe('unknown');
      expect(out).toHaveProperty('error');
    });
  });

  describe('analyzeCtaPatterns', () => {
    it('returns minimal strategy when no CTAs', async () => {
      const out = await blogAnalyzer.analyzeCtaPatterns([]);
      expect(out.strategy).toBe('minimal');
      expect(out.primaryCTAType).toBe('unknown');
      expect(out.effectiveness).toBe('low');
    });

    it('returns minimal strategy when null or undefined', async () => {
      expect(await blogAnalyzer.analyzeCtaPatterns(null)).toMatchObject({ strategy: 'minimal' });
      expect(await blogAnalyzer.analyzeCtaPatterns(undefined)).toMatchObject({ strategy: 'minimal' });
    });
  });

  describe('analyzeCTAs', () => {
    it('returns structure with zero CTAs when extractCTAs returns empty for all pages', async () => {
      vi.mocked(webscraper.extractCTAs).mockResolvedValue([]);

      const out = await blogAnalyzer.analyzeCTAs('org-1', 'https://example.com', []);
      expect(out.totalCTAs).toBe(0);
      expect(out.blogCTAs).toBe(0);
      expect(out.staticPageCTAs).toBe(0);
      expect(out.ctasByPage).toEqual([]);
      expect(out.recommendations).toBeDefined();
      expect(out.strategy).toMatchObject({ strategy: 'minimal' });
    });

    it('skips page when extractCTAs throws and continues', async () => {
      vi.mocked(webscraper.extractCTAs)
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValue([]);

      const out = await blogAnalyzer.analyzeCTAs('org-1', 'https://example.com', []);
      expect(out.totalCTAs).toBe(0);
      expect(out.ctasByPage).toEqual([]);
    });

    it('includes CTAs from blog posts when provided', async () => {
      vi.mocked(webscraper.extractCTAs).mockResolvedValue([]);
      const blogPosts = [
        { url: 'https://example.com/p/1', title: 'Post 1', ctas: [{ type: 'button', text: 'Sign up', placement: 'footer', href: '/signup' }] },
      ];

      const out = await blogAnalyzer.analyzeCTAs('org-1', 'https://example.com', blogPosts);
      expect(out.totalCTAs).toBe(1);
      expect(out.blogCTAs).toBe(1);
      expect(out.staticPageCTAs).toBe(0);
      expect(out.ctasByPage.some((p) => p.pageType === 'blog_post')).toBe(true);
    });
  });

  describe('analyzeInternalLinking', () => {
    it('returns minimal when no links found', async () => {
      vi.mocked(webscraper.extractInternalLinks).mockResolvedValueOnce({ totalLinksFound: 0, internalLinks: [] });

      const out = await blogAnalyzer.analyzeInternalLinking('org-1', 'https://example.com');
      expect(out.totalLinks).toBe(0);
      expect(out.linkingStrategy).toBe('minimal');
      expect(out.recommendations).toContain('Add internal linking to improve SEO and user navigation');
    });

    it('returns categorized links and strategy when links found', async () => {
      vi.mocked(webscraper.extractInternalLinks).mockResolvedValueOnce({
        totalLinksFound: 3,
        internalLinks: [
          { context: 'nav', linkType: 'menu' },
          { context: 'footer', linkType: 'footer' },
          { context: 'nav', linkType: 'menu' },
        ],
      });

      const out = await blogAnalyzer.analyzeInternalLinking('org-1', 'https://example.com');
      expect(out.totalLinks).toBe(3);
      expect(out.linkCategories).toBeDefined();
      expect(out.linkingStrategy).toBeDefined();
      expect(out.linkingStrategy.totalInternalLinks).toBe(3);
      expect(out.recommendations).toBeDefined();
    });
  });
});
