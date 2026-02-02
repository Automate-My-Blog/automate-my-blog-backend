/**
 * Integration tests: Stripe webhook (signature verification, checkout.session.completed).
 * Require DATABASE_URL, STRIPE_WEBHOOK_SECRET, test DB. Skip when not set.
 *
 * @see docs/testing-strategy.md — Should Have
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';

const hasDb = !!process.env.DATABASE_URL && process.env.__DB_CONNECTED === 'true';
const hasStripeSecret = !!process.env.STRIPE_WEBHOOK_SECRET;

describe.skipIf(!hasDb || !hasStripeSecret)('integration api stripe webhook', () => {
  /** @type {import('express').Express} */
  let app;
  /** @type {Stripe} */
  let stripe;

  beforeAll(async () => {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy');
    const mod = await import('../../../index.js');
    app = mod.default;
  });

  const unique = () => `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = () => `${unique()}@example.com`;

  it('rejects webhook when signature invalid', async () => {
    const payload = JSON.stringify({ id: 'evt_x', object: 'event' });
    await request(app)
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'invalid')
      .send(payload)
      .expect(400);
  });

  it('processes checkout.session.completed (one_time) and returns 200', async () => {
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
    const userId = reg.body.user?.id;

    const event = {
      id: `evt_${unique()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${unique()}`,
          object: 'checkout.session',
          metadata: {
            userId,
            priceId: 'price_test',
            planType: 'one_time',
          },
        },
      },
    };
    const payload = JSON.stringify(event);
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });

    const res = await request(app)
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(payload)
      .expect(200);

    expect(res.body).toEqual({ received: true });
  });
});
