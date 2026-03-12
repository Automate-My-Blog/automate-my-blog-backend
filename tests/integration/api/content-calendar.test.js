/**
 * Integration tests: Content calendar (Issue #270).
 * Tests API endpoints and job creation. Requires DATABASE_URL.
 * @see docs/issues/issue-270-content-calendar-comment.md
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('integration api content-calendar', () => {
  /** @type {import('express').Express} */
  let app;
  /** @type {import('pg').Pool} */
  let db;
  let accessToken;
  let userId;
  let audienceId;

  beforeAll(async () => {
    const mod = await import('../../../index.js');
    app = mod.default;
    db = (await import('../../../services/database.js')).default;
  });

  it('registers user and creates test audience + strategy purchase', async () => {
    const unique = `test-cc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `${unique}@example.com`;

    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'password123',
        firstName: 'Content',
        lastName: 'Calendar',
        organizationName: 'Test Org'
      })
      .expect(201);

    expect(reg.body.accessToken).toBeDefined();
    accessToken = reg.body.accessToken;
    userId = reg.body.user?.id;

    const ins = await db.query(
      `INSERT INTO audiences (user_id, target_segment, customer_problem, content_ideas, content_calendar_generated_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id`,
      [
        userId,
        JSON.stringify({ demographics: 'Test audience', psychographics: 'Testing', searchBehavior: 'Search' }),
        'Test customer problem',
        JSON.stringify([
          { dayNumber: 1, title: 'Test post 1', format: 'how-to' },
          { dayNumber: 2, title: 'Test post 2', format: 'listicle' }
        ])
      ]
    );
    audienceId = ins.rows[0].id;

    await db.query(
      `INSERT INTO strategy_purchases (user_id, strategy_id, billing_interval, amount_paid, is_bundle, posts_recommended, posts_maximum, posts_remaining, status, next_billing_date)
       VALUES ($1, $2, 'monthly', 39.99, false, 8, 40, 40, 'active', NOW() + INTERVAL '1 month')`,
      [userId, audienceId]
    );
  });

  it('GET /strategies/content-calendar returns 200 with strategies', async () => {
    const res = await request(app)
      .get('/api/v1/strategies/content-calendar')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.strategies)).toBe(true);
    expect(res.body.strategies.length).toBeGreaterThanOrEqual(1);
    const strat = res.body.strategies.find((s) => s.strategyId === audienceId);
    expect(strat).toBeDefined();
    expect(Array.isArray(strat.contentIdeas)).toBe(true);
    expect(strat.contentIdeas.length).toBe(2);
    expect(strat.contentIdeas[0].title).toBe('Test post 1');
  });

  it('GET /audiences/:id includes content_ideas and content_calendar_generated_at', async () => {
    const res = await request(app)
      .get(`/api/v1/audiences/${audienceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.audience.content_ideas).toBeDefined();
    expect(Array.isArray(res.body.audience.content_ideas)).toBe(true);
    expect(res.body.audience.content_ideas.length).toBe(2);
    expect(res.body.audience.content_calendar_generated_at).toBeDefined();
  });

  it('GET /audiences list includes has_content_calendar', async () => {
    const res = await request(app)
      .get('/api/v1/audiences')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const aud = res.body.audiences?.find((a) => a.id === audienceId);
    expect(aud).toBeDefined();
    expect(aud.has_content_calendar).toBe(true);
  });
});
