/**
 * Integration tests: Enhanced blog generation — request CTAs passed and returned in result.
 * Mocks enhancedBlogGenerationService.generateCompleteEnhancedBlog and billing.
 * Requires DATABASE_URL for auth (register + token).
 *
 * @see docs/testing-strategy.md
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const mockGenerateCompleteEnhancedBlog = vi.fn();

vi.mock('../../../services/enhanced-blog-generation.js', () => ({
  default: {
    generateCompleteEnhancedBlog: (...args) => mockGenerateCompleteEnhancedBlog(...args),
  },
}));

vi.mock('../../../services/billing.js', () => ({
  default: {
    hasCredits: vi.fn().mockResolvedValue(true),
    useCredit: vi.fn().mockResolvedValue(undefined),
  },
}));

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('integration api enhanced-blog-ctas', () => {
  /** @type {import('express').Express} */
  let app;
  let accessToken;

  const topic = { title: `Test ${Date.now()}`, subheader: 'Test subheader' };
  const businessInfo = { businessType: 'B2B', targetAudience: 'SMB', brandVoice: 'professional' };
  const organizationId = '00000000-0000-0000-0000-000000000001';
  const requestCtas = [
    { text: 'Book a Demo', href: '/demo', type: 'demo_link', placement: 'end-of-post' },
    { text: 'Contact Us', href: '/contact' },
  ];

  beforeAll(async () => {
    const mod = await import('../../../index.js');
    app = mod.default;

    const email = `ctas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'password123',
        firstName: 'CTAs',
        lastName: 'Tester',
        organizationName: 'CTAs Org',
      })
      .expect(201);
    accessToken = reg.body.accessToken;
    expect(accessToken).toBeDefined();
  });

  beforeEach(() => {
    mockGenerateCompleteEnhancedBlog.mockReset();
    mockGenerateCompleteEnhancedBlog.mockResolvedValue({
      content: '# Test\n\nContent.',
      title: 'Test Post',
      metaDescription: 'Meta',
      seoKeywords: [],
      organizationContext: { dataCompleteness: 50 },
      ctas: requestCtas.map((c) => ({
        text: c.text,
        href: c.href,
        type: c.type ?? 'general',
        placement: c.placement ?? 'inline',
      })),
    });
  });

  it('passes body.ctas into options and returns data.ctas in response', async () => {
    const res = await request(app)
      .post('/api/v1/enhanced-blog-generation/generate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        topic,
        businessInfo,
        organizationId,
        ctas: requestCtas,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.ctas).toBeDefined();
    expect(Array.isArray(res.body.data.ctas)).toBe(true);
    expect(res.body.data.ctas).toHaveLength(2);
    expect(res.body.data.ctas[0]).toMatchObject({
      text: 'Book a Demo',
      href: '/demo',
      type: 'demo_link',
      placement: 'end-of-post',
    });
    expect(res.body.data.ctas[1]).toMatchObject({
      text: 'Contact Us',
      href: '/contact',
    });

    expect(mockGenerateCompleteEnhancedBlog).toHaveBeenCalledTimes(1);
    const call = mockGenerateCompleteEnhancedBlog.mock.calls[0];
    const options = call[3];
    expect(options).toBeDefined();
    expect(Array.isArray(options.ctas)).toBe(true);
    expect(options.ctas).toEqual(requestCtas);
  });

  it('returns result without ctas when body.ctas not sent and mock returns no ctas', async () => {
    mockGenerateCompleteEnhancedBlog.mockResolvedValue({
      content: '# No CTA\n\nContent.',
      title: 'No CTA Post',
      metaDescription: 'Meta',
      seoKeywords: [],
      organizationContext: { dataCompleteness: 50 },
    });

    const res = await request(app)
      .post('/api/v1/enhanced-blog-generation/generate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        topic,
        businessInfo,
        organizationId,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.ctas).toBeUndefined();

    const call = mockGenerateCompleteEnhancedBlog.mock.calls[0];
    const options = call[3];
    expect(options.ctas).toBeUndefined();
  });
});
