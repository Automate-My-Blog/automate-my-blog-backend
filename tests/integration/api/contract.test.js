/**
 * API contract tests: response shapes, error handling, required fields.
 * Require DATABASE_URL (app loads DB). Skip when not set.
 *
 * @see docs/testing-strategy.md — Should Have
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('integration api contract', () => {
  /** @type {import('express').Express} */
  let app;

  beforeAll(async () => {
    const mod = await import('../../../index.js');
    app = mod.default;
  });

  it('GET /health returns 200 and { status, service }', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('service');
  });

  it('POST /api/v1/auth/register missing required fields returns 400 with error, message', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({})
      .expect(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('message');
  });

  it('POST /api/v1/auth/login missing credentials returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({})
      .expect(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('message');
  });

  it('GET /api/v1/auth/me without token returns 401', async () => {
    const res = await request(app).get('/api/v1/auth/me').expect(401);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/v1/auth/refresh missing body returns 400 with error, message', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({})
      .expect(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('message');
  });

  it('POST /api/v1/auth/logout returns 200 with success, message', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .send({})
      .expect(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('message');
  });
});
