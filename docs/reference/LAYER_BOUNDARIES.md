# Layer Boundaries

This document describes the intended module and layer boundaries for the backend.

## Layer Stack

```
Routes (API / HTTP)  →  Services (Business Logic)  →  Database (Data Access)
```

- **Routes**: Parse requests, validate input, call services, format responses. Must NOT import `db` or execute SQL.
- **Services**: Implement business logic, call `db` for persistence. Export minimal, intentional APIs.
- **Database**: `services/database.js` exports `db` with `query()` and `getClient()` (for transactions). The raw pool is not exported.

## Data Access

- Use `db.query(text, params)` for single queries.
- Use `db.getClient()` for transactions (call `client.release()` when done).
- Do NOT reach into `db.pool` or expect a `pool` export.

## Current State

### Routes That Still Use db Directly

Many route files still call `db.query()` directly. This is a known boundary violation. Ideal state: routes call service methods only. Refactors should move SQL into services incrementally.

| Route File | Status |
|------------|--------|
| founderEmails.js | ✅ Uses founder-emails service |
| leads.js | Uses auth only (no db) |
| jobs.js | Uses auth only (no db) |
| analytics.js, audiences.js, posts.js, etc. | ⚠️ Still use db directly |

### Service Exports

- Services should export a default (instance or facade) and only named exports that consumers need.
- `job-queue.js` exports many functions; consider a single facade if usage patterns allow.

## Practices

1. **New route handlers**: Call service methods; avoid `db` imports in routes.
2. **New features**: Put data access and business logic in services.
3. **Refactoring**: When touching a route that uses `db`, consider extracting to a service.
