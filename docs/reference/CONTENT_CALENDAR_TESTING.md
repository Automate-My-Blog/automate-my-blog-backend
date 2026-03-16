# Content Calendar Testing (Issue #270)

How to fully test the 30-day content calendar system after merging to staging.

## Prerequisites

- Migrations 039 and 040 applied to your database
- Staging backend deployed (from `staging` branch)
- Staging worker running (for background job processing)

## 1. Unit tests (always run)

```bash
npm test
```

Includes `createContentCalendarJob` unit test. All integration tests skip when `DATABASE_URL` is not set.

## 2. Integration tests (CI or local with test DB)

In CI (GitHub Actions), integration tests run with:

- Postgres service
- `setup-test-db.sh` (runs all migrations including 039, 040)
- Full env: `DATABASE_URL`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `OPENAI_API_KEY`, etc.

To run locally with a test database:

```bash
# Start Postgres (e.g. Docker: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres bash scripts/setup-test-db.sh

# Run integration tests
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
OPENAI_API_KEY=sk-dummy \
JWT_SECRET=test-secret \
JWT_REFRESH_SECRET=test-refresh \
STRIPE_SECRET_KEY=sk_test_dummy \
npm test -- tests/integration/api/content-calendar.test.js
```

## 3. Standalone system test script

```bash
node scripts/test-content-calendar-system.js [--staging]
```

**Local mode** (default): Requires `DATABASE_URL`, `REDIS_URL`, `OPENAI_API_KEY` to exercise:

- Schema check (content_ideas, content_calendar columns; jobs content_calendar type)
- Job creation via `createContentCalendarJob`
- Content calendar service (generateAndSaveContentCalendar)
- Worker status (if jobs exist)

**Staging mode** (`--staging`): Tests the deployed API. Requires:

```bash
BACKEND_URL=https://your-staging-backend.vercel.app \
TEST_JWT=<valid-jwt-for-staging-user> \
node scripts/test-content-calendar-system.js --staging
```

To get `TEST_JWT`: log in to staging (or register) and copy the access token from the auth response.

## 4. Real content calendar E2E (staging + Render worker)

Tests the full flow without Stripe: inserts strategy_purchase, enqueues job, Render worker processes, real content_ideas appear.

Requires `DATABASE_URL` and `REDIS_URL` for **staging** (same as Render worker). Copy these from Render Dashboard → your worker service → Environment.

```bash
BACKEND_URL=https://automate-my-blog-backend-env-staging-automate-my-blog.vercel.app \
DATABASE_URL=postgresql://...  \
REDIS_URL=rediss://...         \
node scripts/test-content-calendar-real-flow.js
```

Optionally `TEST_JWT` for a user who already has audiences; otherwise the script registers a new user and creates a minimal audience.

## 5. Manual end-to-end test (staging + Stripe)

1. **Ensure worker is running** for staging (same `REDIS_URL` and `DATABASE_URL` as staging backend).
2. **Trigger a strategy purchase** via Stripe Checkout (test mode) on staging.
3. **Verify webhook** creates `strategy_purchases` and enqueues `content_calendar` job.
4. **Check job completes**: Query `jobs` table for `type = 'content_calendar'`, `status = 'succeeded'`.
5. **Verify audience has content_ideas**: `SELECT content_ideas, content_calendar_generated_at FROM audiences WHERE id = '<strategy_id>'`.
6. **Call API**:
   - `GET /api/v1/strategies/content-calendar` (with Bearer token) → returns strategies with contentIdeas
   - `GET /api/v1/audiences/:id` (with Bearer token) → includes content_ideas, content_calendar_generated_at

## 6. SQL sanity checks (after migrations)

```sql
-- Verify migrations applied
SELECT column_name FROM information_schema.columns
WHERE table_name = 'audiences' AND column_name IN ('content_ideas', 'content_calendar_generated_at');

-- Should return 2 rows: content_ideas, content_calendar_generated_at

-- Verify jobs type includes content_calendar
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'jobs'::regclass AND conname LIKE '%type%';
-- Should include 'content_calendar' in the CHECK
```

## Quick staging API check

```bash
# Replace with your staging URL and a valid JWT
curl -s -H "Authorization: Bearer YOUR_JWT" \
  https://your-staging-backend.vercel.app/api/v1/strategies/content-calendar | jq .
```

Expected: `{ "success": true, "strategies": [...], "totalStrategies": N }`
