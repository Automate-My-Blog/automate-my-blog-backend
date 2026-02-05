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

## Root-Level One-Off Scripts

These scripts in the project root are typically run manually for debugging, migrations, or one-off fixes. They are not part of the main application.

**Debug/diagnostic:** `debug_*.js`, `check_*.js`, `extract-recent-logs.js`, `diagnose-*.js`  
**Migrations/fixes:** `fix-*.js`, `run-migration-*.js`, `run-essential-migration.js`, `add-*.js`  
**Testing/validation:** `test-*.js` (standalone, not in `tests/`), `comprehensive-validation-test.js`, `validate-*.js`  
**Setup/utilities:** `create-test-user.js`, `create-org-intelligence.js`

If a script is no longer needed, consider moving it to `scripts/archive/` or removing it.
