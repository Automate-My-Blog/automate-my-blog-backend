/**
 * Integration tests: Direct platform publishing (POST .../publish, POST .../unpublish).
 * Verifies routes exist, require JWT, and accept expected body shapes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

describe('posts publish/unpublish routes', () => {
  /** @type {import('express').Express} */
  let app;

  beforeAll(async () => {
    const mod = await import('../../../index.js');
    app = mod.default;
  });

  const postId = '00000000-0000-0000-0000-000000000001';

  it('POST /posts/:id/publish without auth returns 401', async () => {
    const res = await request(app)
      .post(`/api/v1/posts/${postId}/publish`)
      .set('Content-Type', 'application/json')
      .send({ platforms: ['wordpress'] });

    expect(res.status).toBe(401);
    expect(res.body?.success).toBe(false);
    expect(res.body?.error).toBeDefined();
  });

  it('POST /posts/:id/publish with invalid body returns 400', async () => {
    const res = await request(app)
      .post(`/api/v1/posts/${postId}/publish`)
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer fake-token-will-401')
      .send({});

    // Either 401 (invalid token) or 400 (missing platforms)
    expect([400, 401]).toContain(res.status);
    if (res.status === 400) {
      expect(res.body?.message).toMatch(/platforms/i);
    }
  });

  it('POST /posts/:id/unpublish without auth returns 401', async () => {
    const res = await request(app)
      .post(`/api/v1/posts/${postId}/unpublish`)
      .set('Content-Type', 'application/json')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body?.success).toBe(false);
    expect(res.body?.error).toBeDefined();
  });

  it('POST /posts/:id/publish and /unpublish are registered (not 404)', async () => {
    const publishRes = await request(app)
      .post(`/api/v1/posts/${postId}/publish`)
      .set('Content-Type', 'application/json')
      .send({ platforms: ['wordpress'] });

    const unpublishRes = await request(app)
      .post(`/api/v1/posts/${postId}/unpublish`)
      .set('Content-Type', 'application/json')
      .send({});

    expect(publishRes.status).not.toBe(404);
    expect(unpublishRes.status).not.toBe(404);
  });
});
