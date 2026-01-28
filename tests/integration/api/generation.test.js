/**
 * Integration tests: Content generation (valid input, structure, error handling).
 * Mock OpenAI. Require DATABASE_URL for DB-dependent paths; basic flow works without.
 *
 * @see docs/testing-strategy.md — Must Have (Week 1)
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../../services/openai.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      generateBlogPost: vi.fn().mockResolvedValue({
        title: 'Test Post',
        content: 'Test content.',
        subheader: 'Test subheader',
        tokensUsed: 10,
      }),
    },
  };
});

vi.mock('../../../services/billing.js', () => ({
  default: {
    hasCredits: vi.fn().mockResolvedValue(true),
    useCredit: vi.fn().mockResolvedValue(undefined),
  },
}));

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('integration api generation', () => {
  /** @type {import('express').Express} */
  let app;

  beforeAll(async () => {
    const mod = await import('../../../index.js');
    app = mod.default;
  });

  const validTopic = () => ({
    title: `Test ${Date.now()}`,
    subheader: 'A test subheader',
  });
  const validBusiness = {
    businessType: 'B2B',
    targetAudience: 'SMB',
    brandVoice: 'professional',
  };

  it('generation accepts valid input and returns blog post structure', async () => {
    const res = await request(app)
      .post('/api/generate-content')
      .send({
        topic: validTopic(),
        businessInfo: validBusiness,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.blogPost).toBeDefined();
    expect(res.body.blogPost.title).toBeDefined();
    expect(res.body.blogPost.content).toBeDefined();
    expect(res.body.generatedAt).toBeDefined();
    expect(res.body.generationTimeMs).toBeDefined();
  });

  it('generation returns 400 when topic is missing', async () => {
    const res = await request(app)
      .post('/api/generate-content')
      .send({ businessInfo: validBusiness })
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(res.body.message).toMatch(/topic|required/i);
  });

  it('generation returns 400 when businessInfo is missing', async () => {
    const res = await request(app)
      .post('/api/generate-content')
      .send({ topic: validTopic() })
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(res.body.message).toMatch(/businessInfo|required/i);
  });

  it('generation returns 400 when topic missing title or subheader', async () => {
    await request(app)
      .post('/api/generate-content')
      .send({
        topic: { title: 'Only title' },
        businessInfo: validBusiness,
      })
      .expect(400);

    await request(app)
      .post('/api/generate-content')
      .send({
        topic: { subheader: 'Only subheader' },
        businessInfo: validBusiness,
      })
      .expect(400);
  });

  it('generation with auth saves to database and returns structure', async () => {
    const e = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: e,
        password: 'password123',
        firstName: 'Gen',
        lastName: 'User',
        organizationName: 'Gen Org',
      })
      .expect(201);

    const gen = await request(app)
      .post('/api/generate-content')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({
        topic: validTopic(),
        businessInfo: validBusiness,
      })
      .expect(200);

    expect(gen.body.success).toBe(true);
    expect(gen.body.blogPost?.title).toBeDefined();

    const posts = await request(app)
      .get('/api/v1/blog-posts')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(200);

    expect(posts.body.success).toBe(true);
    const list = posts.body.data?.posts ?? [];
    expect(list.length).toBeGreaterThanOrEqual(1);
    const saved = list.find((p) => p.title === gen.body.blogPost.title);
    expect(saved).toBeDefined();
  });
});
