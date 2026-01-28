# Integration Tests

Reserved for **API endpoint and database** tests, per [Testing Strategy](../../docs/testing-strategy.md).

**Priority (Strategy “Must Have”):**

1. **Auth** – `tests/integration/api/auth.test.js`: registration, login, JWT validation, protected routes, own-data access.
2. **Content generation** – Generation endpoint, blog structure, DB persistence, error handling.
3. **Database** – Multi-tenant isolation, foreign keys, session adoption.

**Requirements:** Test database (separate from prod), app bootstrap, and optionally `supertest` (or similar) for HTTP. See [docs/testing-strategy.md](../../docs/testing-strategy.md) Implementation Plan.

**Current status:** Implemented. See `api/auth.test.js`, `api/generation.test.js`, `api/contract.test.js`, `api/stripe-webhook.test.js`, and `database.test.js`. Run with `DATABASE_URL` set (and `STRIPE_WEBHOOK_SECRET` for Stripe tests) and `npm run setup-test-db` first.
