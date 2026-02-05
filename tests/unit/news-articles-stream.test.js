/**
 * Unit tests: News article search stream route POST /api/v1/news-articles/search-for-topic-stream.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock enhanced-blog-generation before importing the route
vi.mock('../../services/enhanced-blog-generation.js', () => ({
  default: {
    searchForTopicStreamNews: vi.fn().mockResolvedValue(undefined)
  }
}));

import newsArticlesRoutes from '../../routes/news-articles.js';

describe('news-articles search-for-topic-stream', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const auth = req.headers.authorization;
      if (auth && /^Bearer\s+/i.test(auth)) {
        req.user = { userId: 'user-123' };
      }
      next();
    });
    app.use('/api/v1/news-articles', newsArticlesRoutes);
  });

  it('returns 401 when no auth (no JWT, no x-session-id)', async () => {
    const res = await request(app)
      .post('/api/v1/news-articles/search-for-topic-stream')
      .send({
        topic: { title: 'Test', subheader: '', trend: '', seoBenefit: '' },
        businessInfo: { businessType: 'Healthcare', targetAudience: 'General' }
      })
      .expect(401);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Unauthorized',
      message: expect.stringContaining('authentication or session')
    });
  });

  it('returns 400 when topic is missing', async () => {
    const res = await request(app)
      .post('/api/v1/news-articles/search-for-topic-stream')
      .set('x-session-id', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
      .send({ businessInfo: { businessType: 'x', targetAudience: 'y' } })
      .expect(400);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Missing required parameters',
      message: expect.stringContaining('topic and businessInfo')
    });
  });

  it('returns 400 when businessInfo is missing', async () => {
    const res = await request(app)
      .post('/api/v1/news-articles/search-for-topic-stream')
      .set('x-session-id', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
      .send({ topic: { title: 'Test' } })
      .expect(400);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Missing required parameters'
    });
  });

  it('returns 200 with connectionId and streamUrl when session auth and valid body', async () => {
    const res = await request(app)
      .post('/api/v1/news-articles/search-for-topic-stream')
      .set('x-session-id', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
      .send({
        topic: { title: 'Test Topic', subheader: 'Sub', trend: 'x', seoBenefit: 'y' },
        businessInfo: { businessType: 'Healthcare', targetAudience: 'General' }
      })
      .expect(200);
    expect(res.body).toHaveProperty('connectionId');
    expect(res.body).toHaveProperty('streamUrl');
    expect(typeof res.body.connectionId).toBe('string');
    expect(res.body.streamUrl).toContain('/api/v1/stream/');
    expect(res.body.streamUrl).toContain('sessionId=');
  });

  it('returns 200 with token in streamUrl when Bearer auth', async () => {
    const res = await request(app)
      .post('/api/v1/news-articles/search-for-topic-stream')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1LTEyMyJ9.x')
      .send({
        topic: { title: 'Test', subheader: '', trend: '', seoBenefit: '' },
        businessInfo: { businessType: 'X', targetAudience: 'Y' }
      })
      .expect(200);
    expect(res.body.streamUrl).toContain('token=');
  });

  it('passes maxArticles to service when provided', async () => {
    const { default: enhancedBlogGenerationService } = await import(
      '../../services/enhanced-blog-generation.js'
    );
    await request(app)
      .post('/api/v1/news-articles/search-for-topic-stream')
      .set('x-session-id', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
      .send({
        topic: { title: 'Test' },
        businessInfo: { businessType: 'X', targetAudience: 'Y' },
        maxArticles: 8
      })
      .expect(200);

    expect(enhancedBlogGenerationService.searchForTopicStreamNews).toHaveBeenCalledWith(
      { title: 'Test' },
      { businessType: 'X', targetAudience: 'Y' },
      8,
      expect.any(String)
    );
  });

  it('uses default maxArticles 5 when not provided', async () => {
    const { default: enhancedBlogGenerationService } = await import(
      '../../services/enhanced-blog-generation.js'
    );
    await request(app)
      .post('/api/v1/news-articles/search-for-topic-stream')
      .set('x-session-id', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
      .send({
        topic: { title: 'Test' },
        businessInfo: { businessType: 'X', targetAudience: 'Y' }
      })
      .expect(200);

    expect(enhancedBlogGenerationService.searchForTopicStreamNews).toHaveBeenCalledWith(
      { title: 'Test' },
      { businessType: 'X', targetAudience: 'Y' },
      5,
      expect.any(String)
    );
  });
});
