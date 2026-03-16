# Scripts Inventory

## npm Scripts (package.json)

| Script | Description |
|--------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start with watch mode |
| `npm test` | Run unit + integration tests |
| `npm run test:integration` | Run integration tests only |
| `npm run setup-db` | Initialize database |
| `npm run verify-db` | Test database connection |
| `npm run setup-test-db` | Prepare test database |
| `npm run worker` | Start BullMQ job worker |

## Root and archived one-off scripts

**In root (used by npm):** `verify-connection.js` (`npm run verify-db`), `setup-database.js` (`npm run setup-db`).

**Archived:** Former root one-off scripts (debug, check, fix, run-migration-*, test-*, validate-*, etc.) have been moved to **`scripts/archive/root-one-off/`**. Run with:
```bash
node scripts/archive/root-one-off/<script-name>.js
```
See `scripts/archive/root-one-off/README.md` for the full list and categories.

## scripts/ (staging & real-world flows)

| Script | Description |
|--------|-------------|
| `scripts/vercel-staging-logs.js` | Fetch and analyze Vercel staging logs (see docs/setup/VERCEL_STAGING_LOGS.md). |
| `scripts/test-content-calendar-staging.js` | Full API test of content calendar against staging (BACKEND_URL, TEST_JWT). |
| `scripts/publish-test-post-wordpress.js` | **Real-world flow:** generate blog via stream → create post → publish to WordPress. Uses same API sequence as frontend (POST blog/generate-stream, SSE, POST /posts, POST /posts/:id/publish). Requires TEST_JWT for a user with WordPress connected and credits. |
| `scripts/verify-wordpress-content-transform.js` | **Proof script:** runs the same markdown→HTML + placeholder conversion used when publishing to WordPress. Asserts `[Image: ...]` → `<figure><img>`, `[TWEET:0]`/`[VIDEO:3]` removed. Run with `node scripts/verify-wordpress-content-transform.js`; exit 0 = transformation works. |

## Module Surface Area Notes

- **link-validator**, **content-validator**: Used in tests and root `test-cta-simple.js` only; not wired into production routes.
- **checkStrategyAccess** (middleware): Not imported by any route; add to route if strategy access checks are needed.
