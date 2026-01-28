# Testing Guide

This project uses **Vitest** for unit tests. Tests are fast, deterministic, and run without real external services (DB, APIs, etc.).

## Running Tests

```bash
# Run all unit tests
npm test

# Watch mode (re-run on file changes)
npm run test:watch

# Run with coverage report
npm run test:coverage
```

Tests use `NODE_ENV=test`. No `.env` credentials, database, or network are required.

## Viewing Coverage

- **Terminal:** `npm run test:coverage` prints a text summary.
- **HTML report:** Coverage writes to `coverage/` (when using the `html` reporter). Open `coverage/index.html` in a browser.

Coverage is collected for `utils/`, `services/`, and `jobs/`. Config, `database.js`, `auth-database.js`, and `index.js` are excluded.

## Adding New Tests

1. **Place tests** under `tests/`, e.g. `tests/unit/<module>.test.js`.
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

Unit tests and coverage run on:

- **Push** to `main`
- **Pull requests** targeting `main`

Workflow file: `.github/workflows/test.yml`. No secrets or external services are used.

### YAML snippet (if adding CI manually)

```yaml
name: Test
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:coverage
        env:
          NODE_ENV: test
```

## What’s Covered

| Module | Path | Notes |
|--------|------|--------|
| CTA normalizer | `utils/cta-normalizer.js` | Normalize, validate, type/placement mapping |
| Lead source | `utils/lead-source.js` | Derive lead source from referrer |
| Content validator | `services/content-validator.js` | URL extraction, placeholders, validation, summary |
| Link validator | `services/link-validator.js` | Status message, `validateLinks` (axios mocked) |
| Blog analyzer | `services/blog-analyzer.js` | Pure helpers: parse AI, linking, CTA/linking recommendations, quality, basic analysis |
| Projects | `services/projects.js` | `isAnalysisFresh` |

## Gaps and Next Steps

- **Billing, referrals, leads (full flow):** heavy DB usage; add unit tests for extracted pure logic or use integrated tests with a test DB.
- **Auth flows:** JWT validation, session checks; add route-level or service-level tests with mocked DB.
- **Stripe webhooks, OpenAI, webscraper:** currently mocked or untested; add focused unit tests for parsing and error handling where possible.
