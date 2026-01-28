/**
 * Integration tests: Database (multi-tenant, FKs, session adoption).
 * Require DATABASE_URL + test DB.
 *
 * @see docs/testing-strategy.md — Must Have (Week 1–2)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('integration database', () => {
  /** @type {import('express').Express} */
  let app;

  beforeAll(async () => {
    const mod = await import('../../index.js');
    app = mod.default;
  });

  const unique = () => `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = () => `${unique()}@example.com`;

  it('register creates user, org, and org_member link', async () => {
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

    expect(me.body.user?.organizationId).toBeDefined();
    expect(me.body.user?.organizationName ?? me.body.user?.organization_name).toBeDefined();
  });

  it('session adoption: anonymous org + intelligence adopted after login', async () => {
    const { createAnonymousSessionData } = await import('../utils/session-adoption-helpers.js');
    const sessionId = `adopt-${unique()}`;
    await createAnonymousSessionData(sessionId);

    const e = email();
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: e,
        password: 'password123',
        firstName: 'Adopt',
        lastName: 'User',
        organizationName: 'My Org',
      })
      .expect(201);

    const adopt = await request(app)
      .post('/api/v1/analysis/adopt-session')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ session_id: sessionId })
      .expect(200);

    expect(adopt.body.success).toBe(true);
    expect(adopt.body.adopted).toBeDefined();
    expect(adopt.body.adopted.organizations).toBeGreaterThanOrEqual(1);
    expect(adopt.body.adopted.intelligence).toBeGreaterThanOrEqual(1);

    const recent = await request(app)
      .get('/api/v1/analysis/recent')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(200);

    expect(recent.body.success).toBe(true);
    expect(recent.body.analysis).toBeDefined();
    expect(recent.body.analysis.businessName).toBe('Anonymous Test Org');
  });
});
