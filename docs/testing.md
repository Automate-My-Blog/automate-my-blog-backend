# Testing Guide

This project uses **Vitest** for unit and integration tests. Unit tests are fast, deterministic, and run without real external services (DB, APIs). Integration tests use a real test PostgreSQL database when `DATABASE_URL` is set. Priorities and roadmap follow [Testing Strategy](./testing-strategy.md).

## Strategy alignment

**Full alignment with [Testing Strategy](./testing-strategy.md)?** **No.** Must-haves are largely covered; several should-haves and extras remain. See the checklist below.

### Checklist (strategy → implementation)

| Strategy requirement | Status | Implementation |
|----------------------|--------|----------------|
| **Framework** | ✅ | Vitest (strategy allows; Jest recommended). |
| **Structure** | ✅ | `tests/unit/`, `tests/integration/`, `tests/e2e/` per strategy. |
| **Scripts** | ✅ | `test`, `test:watch`, `test:coverage`, `test:integration`, `setup-test-db`; `NODE_ENV=test`. |
| **CI** | ✅ | GitHub Actions on push/PR to `main`; Postgres, `setup-test-db`, unit + integration + coverage. |
| **Test DB** | ✅ | `setup-test-db`; `.env.test.example`; `run-integration-tests.sh`, `local-db-and-integration.sh`. |
| **Reset/transactions** | ⚠️ | No global reset or transactional rollback; we create unique data per test. |
| **Must Have 1 – Auth** | | |
| → Registration creates user and organization | ✅ | `auth.test.js`: register → 201, user + org. |
| → Login returns valid JWT | ✅ | login → 200, `accessToken`, `refreshToken`. |
| → Protected routes require auth | ✅ | `GET /api/v1/auth/me` without token → 401. |
| → Users only access own data | ✅ | `/me` returns own user (`user.email`); multi-tenant: B cannot access A’s org context → 403. |
| → Session management | ❌ | Refresh, logout, etc. not explicitly tested. |
| **Must Have 2 – Content generation** | | |
| → Accepts valid input, returns blog structure | ✅ | `generation.test.js`: valid → 200, `blogPost`, `generatedAt`. |
| → Saves to database correctly | ✅ | Auth + generate → `GET /api/v1/blog-posts` → post found (OpenAI + billing mocked). |
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

**Practices we follow:** Mock external services (OpenAI, Stripe, DB, HTTP) in unit tests; test behavior and error cases; keep unit tests fast; no real API keys in unit runs. Integration tests use a real test DB when `DATABASE_URL` is set and a dummy `OPENAI_API_KEY` so the app loads (index imports OpenAI).

---

## Running tests

### Scripts

| Script | Purpose |
|--------|---------|
| `npm test` | Run all tests (unit + integration when `DATABASE_URL` set). |
| `npm run test:watch` | Watch mode; re-run on file changes. |
| `npm run test:coverage` | Run tests with coverage (text + HTML in `coverage/`). |
| `npm run test:integration` | Run only integration tests (`tests/integration/`). |
| `npm run setup-test-db` | Apply migrations to test DB. Requires `DATABASE_URL` and `psql`. |

- **Unit tests:** No DB or network. Use `NODE_ENV=test`; no credentials required.
- **Integration tests:** Skipped unless `DATABASE_URL` is set. Use a **separate test database** (see `.env.test.example`). Run `setup-test-db` before first run. Set `OPENAI_API_KEY` (e.g. `sk-dummy-for-tests`) so the app loads.

### Running integration tests locally

Run these steps in your **system terminal** (not a restricted IDE/sandbox). The test runner binds to a port; some environments block that.

**Option A – All-in-one (Docker + migrations + tests)**

```bash
./scripts/local-db-and-integration.sh
```

This script starts a fresh Postgres 16 container, runs migrations via `docker exec`, then runs `npm run test:integration` with the right env. Requires Docker. Uses `AMB_TEST_DB_CONTAINER` (default `amb-test-db`) and `AMB_TEST_DB_PORT` (default `5433`) if you need to override.

**Option B – DB already running**

1. Start Postgres (e.g. Docker):

   ```bash
   docker run -d --name amb-test-db \
     -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \
     -p 5433:5432 postgres:16
   ```

2. Run migrations:

   ```bash
   DATABASE_URL='postgresql://postgres:postgres@localhost:5433/postgres' npm run setup-test-db
   ```

   Without `psql`: copy `database/` into the container and run each migration via `docker exec` (see `scripts/setup-test-db.sh` for the list).

3. Run integration tests:

   ```bash
   DATABASE_URL='postgresql://postgres:postgres@localhost:5433/postgres' ./scripts/run-integration-tests.sh
   ```

   Or manually:

   ```bash
   DATABASE_URL='...' OPENAI_API_KEY=sk-dummy-for-tests npm run test:integration
   ```

   Ensure `USE_DATABASE`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` are set (see `run-integration-tests.sh` or `.env.test.example`).

**Migrations:** `setup-test-db` runs, among others, `24_billing_accounts_and_referrals.sql` (creates `billing_accounts` and `referrals`). Auth and referrals depend on these tables.

---

## Viewing coverage

- **Terminal:** `npm run test:coverage` prints a text summary.
- **HTML:** Coverage is written to `coverage/`. Open `coverage/index.html` in a browser.

Coverage includes `utils/`, `services/`, and `jobs/`. Excluded: `**/*.test.js`, `index.js`, `database.js`, `auth-database.js`, `tests/**`.

---

## What’s covered

### Unit tests (`tests/unit/`)

| File | Scope |
|------|--------|
| `cta-normalizer.test.js` | CTA normalizer: `normalizeCTAs`, `extractCTAs`, edge cases, invalid input. |
| `content-validator.test.js` | Content validator: URL extraction, placeholders, validation results. |
| `link-validator.test.js` | Link validator: relative/mailto/tel, HEAD checks, errors (axios mocked). |
| `blog-analyzer.test.js` | Blog analyzer helpers: `parseAIResponse`, `analyzeLinkingPatterns`, `assessAnalysisQuality` (openai, db, webscraper mocked). |
| `projects.test.js` | Projects: `isAnalysisFresh`, in-memory fallback. |
| `lead-source.test.js` | Lead source resolution and edge cases. |
| `auth-jwt.test.js` | JWT: generate + verify round-trip, expiry handling. |
| `billing.test.js` | Billing: `getUserCredits` (unlimited, limited, fallback), `hasCredits` (db mocked). |

### Integration tests (`tests/integration/`)

| File | Scope |
|------|--------|
| `api/auth.test.js` | Register → 201, login → JWT, protected routes (401 without token), `/me` returns own user (`user.email`), multi-tenant org context 403. |
| `api/generation.test.js` | `POST /api/generate-content`: valid input → structure; 400 on missing/invalid input; with auth, save → `GET /api/v1/blog-posts` verifies post (OpenAI + billing mocked). |
| `api/contract.test.js` | `GET /health`; auth validation and error shapes (register, login, `/me`). |
| `api/stripe-webhook.test.js` | Invalid signature → 400; signed `checkout.session.completed` (one_time) → 200. |
| `database.test.js` | Register → user, org, org_member; session adoption (anonymous org + intelligence) → `/analysis/recent`. |

### Test utilities (`tests/utils/`)

- `fixtures.js`, `factories.js` – shared data and entity builders.
- `mocks.js` – `withFrozenTime`, `withMockedConsole`, etc.
- `session-adoption-helpers.js` – `createAnonymousSessionData` for adoption tests.

---

## Implementation details (recent changes)

- **Migrations:** `08_organization_intelligence_tables.sql` uses `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` (Postgres does not support `CREATE TRIGGER IF NOT EXISTS`). `24_billing_accounts_and_referrals.sql` adds `billing_accounts` and `referrals` for auth and referrals.
- **Content service:** `getUserBlogPosts` / `getBlogPost` no longer assume `word_count` or `business_context` on `blog_posts`. They use `NULL` or computed values and restrict `ORDER BY` to allowed columns to avoid invalid SQL.
- **Auth:** `/api/v1/auth/me` returns `{ success, user }`; email is `user.email`. Tests assert `me.body.user?.email`.
- **Generation tests:** OpenAI is mocked via `vi.mock(..., async (importOriginal) => { ... })` so `OpenAIService` remains exported for `enhanced-blog-generation` (which extends it). Only `default` is overridden with a `generateBlogPost` mock.
- **App in test:** `index.js` skips `listen` when `NODE_ENV=test` so Supertest can drive the app without binding.

---

## CI (GitHub Actions)

Workflow: `.github/workflows/test.yml`. Runs on **push** and **pull requests** for `main` and `test/unit-tests`.

1. Postgres 16 service.
2. Install `postgresql-client`, run `./scripts/setup-test-db.sh` with `DATABASE_URL`.
3. `npm run test:coverage` with `NODE_ENV`, `DATABASE_URL`, `USE_DATABASE`, JWT secrets, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, and `OPENAI_API_KEY` (dummy) set.

Unit and **integration** tests run in CI (integration tests run because `DATABASE_URL` is set). No production DB or real external APIs. Migration `05_create_all_indexes` is run with `ON_ERROR_STOP=0` so known partial failures (e.g. index predicates using `CURRENT_TIMESTAMP`) do not fail the job.

---

## Adding new tests

1. Put tests under `tests/`: `tests/unit/` for unit, `tests/integration/` for API/DB (see [Strategy alignment](#strategy-alignment)). Use `*.test.js` naming.
2. Use Vitest: `describe`, `it`, `expect`, `vi` (mocks).
3. Import from repo root (e.g. `../../services/foo.js`).

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

- One test file per module (or related helpers).
- Behavior-focused assertions: given inputs → expected outputs or side effects.
- Mock I/O: `vi.mock()` / `vi.spyOn()` for axios, DB, OpenAI, etc. See `blog-analyzer.test.js`, `link-validator.test.js`, `generation.test.js`.
- Fixtures/factories: `tests/utils/fixtures.js`, `tests/utils/factories.js`.
- Time/randomness: `tests/utils/mocks.js` (`withFrozenTime`, etc.) when needed.

### Mocking

- **HTTP:** Mock `axios` (or your client) with `vi.spyOn(axios, 'get')` etc. and `.mockResolvedValue()` / `.mockRejectedValue()`.
- **Modules:** `vi.mock('module-name', () => ({ ... }))` before importing. Use `importOriginal` when you need to preserve exports (e.g. `OpenAIService`) and override only some.
- **Console:** `withMockedConsole()` from `tests/utils/mocks.js` to silence logs.

---

## Remaining gaps (vs. full strategy)

To be **fully** aligned with [Testing Strategy](./testing-strategy.md), the following are still missing:

| Gap | Notes |
|-----|--------|
| **Auth – session management** | Explicit tests for refresh token, logout, etc. |
| **Billing – subscription events** | Stripe `customer.subscription.created/updated/deleted` webhooks; we only cover `checkout.session.completed`. |
| **Database – FKs** | Tests that foreign keys prevent orphaned records (e.g. delete org with users). |
| **API contracts** | Broader “all endpoints” coverage and rate limiting. |
| **Integration** | Database connection failure handling, external API retry behavior. |
| **Setup** | Optional “reset between tests” or transactional rollback; currently unique data per test. |
| **Coverage** | 60%+ critical paths, 40%+ overall (strategy targets). |

---

## Next steps

- Run integration tests locally via `./scripts/run-integration-tests.sh` or `./scripts/local-db-and-integration.sh` to validate full flows.
- Add session-management tests (refresh, logout) and billing unit tests for `useCredit`, `getBillingHistory`.
- Expand API contract and integration coverage (endpoints, rate limiting, DB/API failure handling) as needed.
