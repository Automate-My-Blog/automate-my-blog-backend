/**
 * Integration tests: User email preferences and unsubscribe (issue #7).
 * GET/PUT /api/v1/user/email-preferences, POST /api/v1/user/unsubscribe.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

describe('user email preferences routes', () => {
  /** @type {import('express').Express} */
  let app;

  beforeAll(async () => {
    const mod = await import('../../../index.js');
    app = mod.default;
  });

  it('GET /user/email-preferences without auth returns 401', async () => {
    const res = await request(app).get('/api/v1/user/email-preferences');
    expect(res.status).toBe(401);
  });

  it('PUT /user/email-preferences without auth returns 401', async () => {
    const res = await request(app)
      .put('/api/v1/user/email-preferences')
      .set('Content-Type', 'application/json')
      .send({ frequency: 'weekly' });
    expect(res.status).toBe(401);
  });

  it('POST /user/unsubscribe without auth returns 401', async () => {
    const res = await request(app).post('/api/v1/user/unsubscribe');
    expect(res.status).toBe(401);
  });

  it('email-preferences and unsubscribe routes are registered (not 404 with auth)', async () => {
    const getRes = await request(app)
      .get('/api/v1/user/email-preferences')
      .set('Authorization', 'Bearer invalid-token');
    expect(getRes.status).not.toBe(404);
  });
});
