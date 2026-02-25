/**
 * Integration test: POST /api/v1/strategies/:id/subscribe must not return 405.
 * Ensures the subscribe route is registered by the composite strategy router (route order fix).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

describe('strategies subscribe route', () => {
  /** @type {import('express').Express} */
  let app;

  beforeAll(async () => {
    const mod = await import('../../../index.js');
    app = mod.default;
  });

  it('POST /strategies/:id/subscribe is handled (not 405)', async () => {
    const strategyId = '6b1668f7-c20e-4080-965f-1536e8240f20';
    const res = await request(app)
      .post(`/api/v1/strategies/${strategyId}/subscribe`)
      .set('Content-Type', 'application/json')
      .send({ billingInterval: 'monthly' });

    // Route must be matched: we expect 401 (no auth) or 400 (invalid), never 405 Method Not Allowed
    expect(res.status).not.toBe(405);
    if (res.status === 401) {
      expect(res.body?.error || res.text).toBeDefined();
    }
  });
});
