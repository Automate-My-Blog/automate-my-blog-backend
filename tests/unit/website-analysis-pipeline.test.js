/**
 * Unit tests: Website analysis pipeline (validation, progress, cancel).
 * Mocks db, webscraper, openai, normalizeCTA.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

vi.mock('../../services/database.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../services/webscraper.js', () => ({
  default: {
    isValidUrl: vi.fn(() => true),
    scrapeWebsite: vi.fn().mockResolvedValue({
      title: 'Test',
      metaDescription: '',
      headings: [],
      content: 'Content',
      scrapedAt: new Date().toISOString(),
      ctas: [],
    }),
  },
}));
vi.mock('../../services/openai.js', () => ({
  default: {
    analyzeWebsite: vi.fn().mockResolvedValue({
      businessName: 'Test',
      businessType: 'B2B',
      targetAudience: 'Everyone',
      brandVoice: 'Professional',
    }),
    generateScrapingObservation: vi.fn().mockResolvedValue('Ok, B2B company...'),
    generateCTAObservation: vi.fn().mockResolvedValue('Found 0 CTAs.'),
    generateWebsiteAnalysisNarrative: vi.fn().mockResolvedValue({
      narrative: "Oh, you're in B2B. Test serves Everyone—good space.\n\nYour customers are searching when they're evaluating solutions. Good moment to show up.",
      confidence: 0.8,
      keyInsights: [],
    }),
    generateAudienceScenarios: vi.fn().mockResolvedValue([
      {
        targetSegment: { demographics: 'd', psychographics: 'p', searchBehavior: 's' },
        customerProblem: 'cp',
        businessValue: { searchVolume: '1k', conversionPotential: 'High', priority: 1 },
        customerLanguage: [],
        seoKeywords: ['k1'],
        conversionPath: 'path',
        contentIdeas: [],
      },
    ]),
    generatePitches: vi.fn().mockImplementation((s) => Promise.resolve(s.map((x) => ({ ...x, pitch: 'pitch' })))),
    generateAudienceImages: vi.fn().mockImplementation((s) =>
      Promise.resolve(s.map((x) => ({ ...x, imageUrl: 'https://example.com/img.png' })))
    ),
  },
}));
vi.mock('../../utils/cta-normalizer.js', () => ({
  normalizeCTA: vi.fn((c) => ({
    cta_text: c.text || 'cta',
    cta_type: 'button',
    placement: 'main_content',
    href: '',
    context: '',
    class_name: '',
    tag_name: 'a',
    conversion_potential: 70,
    visibility_score: 70,
  })),
}));

const db = (await import('../../services/database.js')).default;

beforeAll(async () => {});

afterEach(() => {
  vi.mocked(db.query).mockReset();
});

describe('website-analysis-pipeline', () => {
  describe('runWebsiteAnalysisPipeline', () => {
    it('throws when url missing', async () => {
      const { runWebsiteAnalysisPipeline } = await import('../../services/website-analysis-pipeline.js');
      await expect(
        runWebsiteAnalysisPipeline({}, { userId: 'u1' })
      ).rejects.toThrow('url is required');
    });

    it('throws when neither userId nor sessionId', async () => {
      const { runWebsiteAnalysisPipeline } = await import('../../services/website-analysis-pipeline.js');
      await expect(
        runWebsiteAnalysisPipeline({ url: 'https://example.com' }, {})
      ).rejects.toThrow('Either userId or sessionId is required');
    });

    it('throws when invalid URL', async () => {
      const webscraper = (await import('../../services/webscraper.js')).default;
      vi.mocked(webscraper.isValidUrl).mockReturnValue(false);
      const { runWebsiteAnalysisPipeline } = await import('../../services/website-analysis-pipeline.js');
      await expect(
        runWebsiteAnalysisPipeline({ url: 'not-a-url' }, { sessionId: 's1' })
      ).rejects.toThrow('Invalid URL');
      vi.mocked(webscraper.isValidUrl).mockReturnValue(true);
    });

    it('throws when cancelled early', async () => {
      const { runWebsiteAnalysisPipeline } = await import('../../services/website-analysis-pipeline.js');
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      let callCount = 0;
      vi.mocked(db.query).mockImplementation(() => {
        callCount++;
        if (callCount <= 3) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [], rowCount: 1 });
      });
      await expect(
        runWebsiteAnalysisPipeline(
          { url: 'https://example.com' },
          { sessionId: 's1' },
          { isCancelled: () => true }
        )
      ).rejects.toThrow('Cancelled');
    });

    it('calls onProgress with step labels and returns result shape', async () => {
      const { runWebsiteAnalysisPipeline } = await import('../../services/website-analysis-pipeline.js');
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      let progressCalls = 0;
      vi.mocked(db.query).mockImplementation((sql) => {
        if (String(sql).includes('INSERT INTO organizations')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (String(sql).includes('INSERT INTO organization_intelligence')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (String(sql).includes('DELETE FROM cta_analysis')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (String(sql).includes('SELECT') && String(sql).includes('cta_analysis')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      const steps = [];
      const result = await runWebsiteAnalysisPipeline(
        { url: 'https://example.com' },
        { sessionId: 's1' },
        {
          onProgress: (idx, label) => {
            steps.push({ idx, label });
          },
        }
      );
      expect(result.success).toBe(true);
      expect(result.url).toBe('https://example.com');
      expect(result.analysis).toBeDefined();
      expect(Array.isArray(result.scenarios)).toBe(true);
      expect(result.scenarios.length).toBeGreaterThan(0);
      expect(result.scenarios[0]).toHaveProperty('imageUrl');
      expect(result.scenarios[0]).toHaveProperty('pitch');
      expect(result.organizationId).toBeDefined();
      expect(steps.some((s) => s.label?.includes('Analyzing'))).toBe(true);
      expect(steps.some((s) => s.label?.includes('audiences'))).toBe(true);
      expect(steps.some((s) => s.label?.includes('pitches'))).toBe(true);
      expect(steps.some((s) => s.label?.includes('images'))).toBe(true);
    });
  });

  describe('PROGRESS_STEPS', () => {
    it('exports four steps', async () => {
      const { PROGRESS_STEPS } = await import('../../services/website-analysis-pipeline.js');
      expect(PROGRESS_STEPS).toHaveLength(4);
      expect(PROGRESS_STEPS[0]).toMatch(/Analyzing/);
      expect(PROGRESS_STEPS[1]).toMatch(/audiences/);
      expect(PROGRESS_STEPS[2]).toMatch(/pitches/);
      expect(PROGRESS_STEPS[3]).toMatch(/images/);
    });
  });
});
