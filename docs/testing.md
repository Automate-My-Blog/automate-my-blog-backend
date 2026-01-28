# Testing Guide

This project uses **Vitest** for unit tests. Tests are fast, deterministic, and run without real external services (DB, APIs, etc.). The overall priorities and roadmap come from [Testing Strategy](./testing-strategy.md).

## Strategy alignment

**Full alignment with [Testing Strategy](./testing-strategy.md)?** **No.** Must-haves are largely covered; several should-haves and extras are still missing. See the checklist below.

### Checklist (strategy → implementation)

| Strategy requirement | Status | Implementation |
|----------------------|--------|----------------|
| **Framework** | ✅ | Vitest (strategy allows; Jest recommended). |
| **Structure** | ✅ | `tests/unit/`, `tests/integration/`, `tests/e2e/` per strategy. |
| **Scripts** | ✅ | `test`, `test:watch`, `test:coverage`, `setup-test-db`; `NODE_ENV=test`. |
| **CI** | ✅ | GitHub Actions on push/PR to `main`; Postgres, `setup-test-db`, unit + integration + coverage. |
| **Test DB** | ✅ | `setup-test-db`; `.env.test.example`; CI migrations. |
| **Reset/transactions** | ⚠️ | No global reset or transactional rollback between tests; we create unique data per test. |
| **Must Have 1 – Auth** | | |
| → Registration creates user and organization | ✅ | `auth.test.js`: register → 201, user + org. |
| → Login returns valid JWT | ✅ | login → 200, `accessToken`, `refreshToken`. |
| → Protected routes require auth | ✅ | `GET /auth/me` without token → 401. |
| → Users only access own data | ✅ | `/me` returns own user; multi-tenant: B cannot access A’s org context → 403. |
| → Session management | ❌ | Refresh, logout, etc. not explicitly tested. |
| **Must Have 2 – Content generation** | | |
| → Accepts valid input, returns blog structure | ✅ | `generation.test.js`: valid → 200, `blogPost`, `generatedAt`. |
| → Saves to database correctly | ✅ | `generation.test.js`: auth + generate → `GET /blog-posts` → post found (billing mocked). |
| → Handles errors gracefully | ✅ | 400 on missing topic/businessInfo, invalid topic. |
| **Must Have 3 – Database** | | |
| → Multi-tenant isolation | ✅ | Org context 403 when accessing other org. |
| → Foreign keys prevent orphaned records | ❌ | No explicit tests (e.g. delete org with users). |
| → Session adoption doesn’t break data | ✅ | `database.test.js`: adopt anonymous org+intel → `/analysis/recent`. |
| **Should Have 4 – API contracts** | | |
| → All endpoints return expected structure | ⚠️ | Health, auth validation covered; many endpoints untested. |
| → Error responses consistent, required fields validated | ✅ | 400/401 shapes for auth. |
| → Rate limiting | ❌ | Not tested. |
| **Should Have 5 – Integration** | | |
| → Stripe webhooks process correctly | ✅ | `stripe-webhook.test.js`: invalid sig → 400; signed `checkout.session.completed` → 200. |
| → Database connection handling | ❌ | No tests for connection failures / retries. |
| → External API retries | ❌ | Retry logic not tested. |
| **Coverage goals** | ⚠️ | Strategy: 60%+ critical paths, 40%+ overall. We remain below. |
| **What NOT to test (yet)** | ✅ | No E2E, visual, performance, load. |
| **Best practices** | ✅ | Behavior-focused, mocks for external services, error cases, fast unit tests. |

**Practices we follow:** Mock external services (OpenAI, Stripe, DB, HTTP) in unit tests; test behavior and error cases; keep unit tests fast; no real API keys in unit runs. Integration tests use a real test DB when `DATABASE_URL` is set.

## Running Tests

```bash
# Run all tests (unit + integration when DATABASE_URL set)
npm test

# Watch mode (re-run on file changes)
npm run test:watch

# Run with coverage report
npm run test:coverage

# Set up test database (run migrations). Requires DATABASE_URL and psql.
npm run setup-test-db
```

- **Unit tests:** No DB or network. Use `NODE_ENV=test`; credentials not required.
- **Integration tests:** Skipped unless `DATABASE_URL` is set. Use a **separate test database** (see `.env.test.example`). Run `npm run setup-test-db` before first run.

### Running integration tests locally

**Run these steps in your system terminal** (not in a restricted IDE/sandbox environment). The test runner binds to a port; some environments block that.

1. **Start Postgres** (Docker example):

   ```bash
   docker run -d --name amb-test-db \
     -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \
     -p 5433:5432 postgres:16
   ```

2. **Run migrations.** Either:
   - With `psql` on your machine:  
     `DATABASE_URL='postgresql://postgres:postgres@localhost:5433/postgres' npm run setup-test-db`
   - Without `psql`: copy `database/` into the container and run each migration via `docker exec` (see `scripts/setup-test-db.sh` for the migration list).

   Migrations include `24_billing_accounts_and_referrals.sql`, which creates `billing_accounts` and `referrals`. Auth and referrals services require these tables.

3. **Run integration tests:**

   ```bash
   DATABASE_URL='postgresql://postgres:postgres@localhost:5433/postgres' ./scripts/run-integration-tests.sh
   ```

   Or with `npm run test:integration` after setting `DATABASE_URL`, `OPENAI_API_KEY` (dummy, e.g. `sk-dummy-for-tests`), and the other vars in `run-integration-tests.sh`.

## Viewing Coverage

- **Terminal:** `npm run test:coverage` prints a text summary.
- **HTML report:** Coverage writes to `coverage/` (when using the `html` reporter). Open `coverage/index.html` in a browser.

Coverage is collected for `utils/`, `services/`, and `jobs/`. Config, `database.js`, `auth-database.js`, and `index.js` are excluded.

## Adding New Tests

1. **Place tests** under `tests/`: `tests/unit/` for unit tests, `tests/integration/` for API/DB tests (see [Strategy alignment](#strategy-alignment)), e.g. `tests/unit/<module>.test.js`.
2. **Use Vitest** APIs: `describe`, `it`, `expect`, `vi` (for mocks).
3. **Import from repo root** (e.g. `../../services/foo.js`).

### Example

```js
import { describe, it, expect } from 'vitest';
import { myUtil } from '../../utils/my-util.js';

describe('my-util', () => {
  it('returns expected value', () => {
    expect(myUtil('input')).toBe('expected');
  });
});
```

### Conventions

- **One test file per module** (or per group of related helpers).
- **Behavior-focused assertions:** given inputs → expected outputs or side effects.
- **Mock I/O:** use `vi.mock()` / `vi.spyOn()` for `axios`, `fetch`, DB, etc. See `tests/unit/blog-analyzer.test.js` and `tests/unit/link-validator.test.js`.
- **Fixtures:** shared data lives in `tests/utils/fixtures.js`. Use `tests/utils/factories.js` for entity builders.
- **Time / randomness:** use `tests/utils/mocks.js` (`withFrozenTime`, etc.) when logic depends on dates or random values.

### Mocking

- **HTTP:** mock `axios` (or your HTTP client) with `vi.spyOn(axios, 'get')` / `vi.spyOn(axios, 'head')` and `.mockResolvedValue()` / `.mockRejectedValue()`. Restore in `finally` or `afterEach`.
- **Modules:** `vi.mock('module-name', () => ({ ... }))` before importing code that uses them. Mocks are hoisted.
- **Console:** use `withMockedConsole()` from `tests/utils/mocks.js` to silence `console.log` / `console.error` in tests.

## CI (GitHub Actions)

Tests run on **push** to `main` and **pull requests** targeting `main`.

Workflow: `.github/workflows/test.yml`. It:

1. Starts a Postgres 16 service.
2. Installs `postgresql-client`, runs `npm run setup-test-db` to apply migrations.
3. Runs `npm run test:coverage` with `DATABASE_URL`, `USE_DATABASE`, test JWT secrets, and `STRIPE_WEBHOOK_SECRET` set.

Unit and integration tests run in CI; no external APIs or production DB.

## What’s Covered

| Area | Location | Notes |
|------|----------|--------|
| **Unit** | `tests/unit/` | CTA normalizer, lead source, content validator, link validator, blog-analyzer helpers, projects `isAnalysisFresh`, auth JWT round-trip, **billing** (`getUserCredits`, `hasCredits`). |
| **Integration – Auth** | `tests/integration/api/auth.test.js` | Register, login, JWT, protected routes, own-data, multi-tenant (org context 403). |
| **Integration – Generation** | `tests/integration/api/generation.test.js` | Generation endpoint (valid input → structure, 400 on invalid). **With auth: saves to DB**, then `GET /blog-posts` verifies. OpenAI + billing mocked. |
| **Integration – Database** | `tests/integration/database.test.js` | Register→org link; **session adoption** (anonymous org + intelligence adopted, then visible via `/analysis/recent`). |
| **Integration – Contracts** | `tests/integration/api/contract.test.js` | Health, auth validation and error shapes. |
| **Integration – Stripe webhook** | `tests/integration/api/stripe-webhook.test.js` | Invalid signature → 400; signed `checkout.session.completed` (one_time) → 200. |

## Remaining gaps (vs. full strategy alignment)

To be **fully** aligned with [Testing Strategy](./testing-strategy.md), the following are still missing:

- **Auth – session management:** Explicit tests for refresh token, logout, etc.
- **Billing – subscription events:** Stripe `customer.subscription.created/updated/deleted` webhook handling (we cover `checkout.session.completed` only).
- **Database – FKs:** Tests that foreign keys prevent orphaned records (e.g. delete org with users).
- **API contracts:** Broader coverage of “all endpoints” and rate limiting.
- **Integration:** Database connection failure handling, external API retry behavior.
- **Setup:** Optional “reset between tests” or transactional rollback; currently we use unique data per test.
- **Coverage:** 60%+ critical paths, 40%+ overall (strategy targets).

## Next steps

- Run integration tests with `DATABASE_URL` and `STRIPE_WEBHOOK_SECRET` to exercise full flows.
- Add billing unit tests for `useCredit`, `getBillingHistory`; expand API contract and integration coverage as needed.
