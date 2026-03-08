/**
 * Integration tests: Third-party publishing platform connections.
 * GET /connections, POST /connect, DELETE /:platform/disconnect.
 * Requires DATABASE_URL. Skip when not set.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('publishing-platforms routes', () => {
  /** @type {import('express').Express} */
  let app;
  /** @type {string} */
  let accessToken;

  beforeAll(async () => {
    const mod = await import('../../../index.js');
    app = mod.default;
    const email = `pub-${Date.now()}@example.com`;
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        organizationName: 'Test Org'
      })
      .expect(201);
    accessToken = reg.body.accessToken;
  });

  it('GET /publishing-platforms/connections without auth returns 401', async () => {
    const res = await request(app)
      .get('/api/v1/publishing-platforms/connections');
    expect(res.status).toBe(401);
    expect(res.body?.success).toBe(false);
    expect(res.body?.error).toMatch(/auth/i);
  });

  it('GET /publishing-platforms/connections with auth returns 200 and connections array', async () => {
    const res = await request(app)
      .get('/api/v1/publishing-platforms/connections')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('connections');
    expect(Array.isArray(res.body.connections)).toBe(true);
  });

  it('DELETE /publishing-platforms/:platform/disconnect without auth returns 401', async () => {
    const res = await request(app)
      .delete('/api/v1/publishing-platforms/wordpress/disconnect');
    expect(res.status).toBe(401);
  });

  it('DELETE /publishing-platforms/invalid/disconnect with auth returns 400', async () => {
    const res = await request(app)
      .delete('/api/v1/publishing-platforms/invalid/disconnect')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
    expect(res.body?.error).toBeDefined();
    expect(res.body?.message).toMatch(/unknown|supported/i);
  });

  it('DELETE /publishing-platforms/wordpress/disconnect when not connected returns 404', async () => {
    const res = await request(app)
      .delete('/api/v1/publishing-platforms/wordpress/disconnect')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body?.error).toBeDefined();
  });

  it('POST /publishing-platforms/connect with invalid platform returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/publishing-platforms/connect')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/json')
      .send({ platform: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body?.message).toMatch(/unknown|supported/i);
  });

  it('POST /publishing-platforms/connect WordPress without credentials returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/publishing-platforms/connect')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/json')
      .send({ platform: 'wordpress' });
    expect(res.status).toBe(400);
    expect(res.body?.message).toMatch(/site_url|application_password/i);
  });

  it('POST /publishing-platforms/connect Medium returns authorization_url or 503', async () => {
    const res = await request(app)
      .post('/api/v1/publishing-platforms/connect')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/json')
      .send({ platform: 'medium' });
    if (res.status === 200) {
      expect(res.body?.success).toBe(true);
      expect(res.body?.authorization_url).toBeDefined();
      expect(res.body.authorization_url).toMatch(/medium\.com\/m\/oauth\/authorize/);
    } else {
      expect(res.status).toBe(503);
      expect(res.body?.message).toMatch(/not configured|redirect/i);
    }
  });

  it('POST /publishing-platforms/connect Substack without api_key returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/publishing-platforms/connect')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/json')
      .send({ platform: 'substack' });
    expect(res.status).toBe(400);
    expect(res.body?.message).toMatch(/api_key/i);
  });

  it('POST /publishing-platforms/connect Substack with api_key returns 200 or 503', async () => {
    const res = await request(app)
      .post('/api/v1/publishing-platforms/connect')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/json')
      .send({
        platform: 'substack',
        api_key: 'sk_test_fake_key_for_test',
        publication_url: 'https://example.substack.com'
      });
    if (res.status === 200) {
      expect(res.body?.success).toBe(true);
      expect(res.body?.platform).toBe('substack');
    } else {
      expect(res.status).toBe(503);
      expect(res.body?.message).toMatch(/Encryption|OAUTH_ENCRYPTION_KEY/i);
    }
  });

  it('GET /publishing-platforms/medium/callback without code redirects to frontend with error', async () => {
    const res = await request(app)
      .get('/api/v1/publishing-platforms/medium/callback')
      .query({ state: 'invalid' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/publishing=error|message=/);
  });

  it('POST /posts/:id/publish with unconnected platform returns 400', async () => {
    const createRes = await request(app)
      .post('/api/v1/posts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/json')
      .send({ title: 'Test Post', content: 'Body' })
      .expect(201);
    const postId = createRes.body.post.id;

    const res = await request(app)
      .post(`/api/v1/posts/${postId}/publish`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/json')
      .send({ platforms: ['wordpress'] });

    expect(res.status).toBe(400);
    expect(res.body?.success).toBe(false);
    expect(res.body?.error).toMatch(/not connected|connect/i);
    expect(res.body?.message).toMatch(/not connected|Connect them/i);
  });
});
