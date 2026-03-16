# Archived root one-off scripts

These were previously in the repo root. They are debug, migration, fix, or ad-hoc test scripts run manually and are not part of the main app or npm scripts.

**To run any script from repo root:**
```bash
node scripts/archive/root-one-off/<script-name>.js
```

**Categories:**
- **add-*** / **check-*** / **create-***: Schema and data checks, test user/org creation
- **debug-***: One-off debugging (adoption, CTA, storage, auth, etc.)
- **fix-***: One-time fixes (constraints, subscriptions, DB functions)
- **run-migration-***: Runners for specific migrations (replaced by `database/` + `scripts/run_migrations.sh` or deployment pipeline)
- **test-***: Standalone manual tests (not in `tests/`); some are referenced in archived docs under `docs/archive/`
- **verify-*** / **validate-***: Validation scripts

**Still in root (used by npm):** `verify-connection.js` (`npm run verify-db`), `setup-database.js` (`npm run setup-db`).
