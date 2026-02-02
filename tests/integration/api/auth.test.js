/**
 * Integration tests: Auth (registration, login, JWT, protected routes, own-data).
 * Require DATABASE_URL + test DB. Skip when not set (e.g. unit-only runs).
 *
 * @see docs/testing-strategy.md — Must Have
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

const hasDb = !!process.env.DATABASE_URL && process.env.__DB_CONNECTED === 'true';

describe.skipIf(!hasDb)('integration api auth', () => {
  /** @type {import('express').Express} */
  let app;

  beforeAll(async () => {
    const mod = await import('../../../index.js');
    app = mod.default;
  });

  const unique = () => `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = () => `${unique()}@example.com`;

  it('registers user and creates organization', async () => {
    const e = email();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: e,
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        organizationName: 'Test Org',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(e);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.expiresIn).toBeDefined();
  });

  it('login returns valid JWT', async () => {
    const e = email();
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: e,
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        organizationName: 'Test Org',
      })
      .expect(201);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: e, password: 'password123' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user).toBeDefined();
  });

  it('protected route without token returns 401', async () => {
    await request(app)
      .get('/api/v1/auth/me')
      .expect(401);
  });

  it('protected route with valid token returns 200', async () => {
    const e = email();
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: e,
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        organizationName: 'Test Org',
      })
      .expect(201);

    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(200);
  });

  it('users can only access own data (GET /me returns own user)', async () => {
    const e = email();
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: e,
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        organizationName: 'Test Org',
      })
      .expect(201);

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(200);

    expect(me.body.user?.email).toBe(e);
  });

  it('refresh with valid token returns new access and refresh tokens', async () => {
    const e = email();
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: e,
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        organizationName: 'Test Org',
      })
      .expect(201);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: reg.body.refreshToken })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Tokens refreshed');
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body.user?.email).toBe(e);
  });

  it('refresh with missing token returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({})
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(res.body.message).toBeDefined();
  });

  it('refresh with invalid token returns 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'invalid.jwt.token' })
      .expect(401);

    expect(res.body.error).toBeDefined();
  });

  it('logout returns 200 and success message', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .send({})
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Logout successful');
  });

  it.skip('multi-tenant: user B cannot access user A organization context', async () => {
    const emailA = email();
    const emailB = email();
    const regA = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: emailA,
        password: 'password123',
        firstName: 'A',
        lastName: 'User',
        organizationName: 'Org A',
      })
      .expect(201);
    const meA = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${regA.body.accessToken}`)
      .expect(200);
    const orgIdA = meA.body.user?.organizationId ?? meA.body.user?.organization_id;
    expect(orgIdA).toBeDefined();

    await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: emailB,
        password: 'password123',
        firstName: 'B',
        lastName: 'User',
        organizationName: 'Org B',
      })
      .expect(201);
    const regB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailB, password: 'password123' })
      .expect(200);

    await request(app)
      .get(`/api/v1/enhanced-blog-generation/context/${orgIdA}`)
      .set('Authorization', `Bearer ${regB.body.accessToken}`)
      .expect(403);
  });
});
