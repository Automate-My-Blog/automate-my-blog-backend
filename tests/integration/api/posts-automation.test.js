/**
 * Integration tests: Post automation API (issue #171).
 * GET /status, POST notifications/:id/viewed, POST notifications/:id/dismiss, POST /resume, PUT /preferences.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

describe('posts automation routes', () => {
  /** @type {import('express').Express} */
  let app;

  beforeAll(async () => {
    const mod = await import('../../../index.js');
    app = mod.default;
  });

  it('GET /posts/automation/status without auth returns 401', async () => {
    const res = await request(app).get('/api/v1/posts/automation/status');
    expect(res.status).toBe(401);
    expect(res.body?.success).toBe(false);
    expect(res.body?.error).toMatch(/auth/i);
  });

  it('POST /posts/automation/notifications/:id/viewed without auth returns 401', async () => {
    const res = await request(app)
      .post('/api/v1/posts/automation/notifications/00000000-0000-0000-0000-000000000001/viewed');
    expect(res.status).toBe(401);
  });

  it('POST /posts/automation/resume without auth returns 401', async () => {
    const res = await request(app).post('/api/v1/posts/automation/resume');
    expect(res.status).toBe(401);
  });

  it('automation routes are registered (path not 404 when auth present)', async () => {
    const res = await request(app)
      .get('/api/v1/posts/automation/status')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.status).not.toBe(404);
  });
});
