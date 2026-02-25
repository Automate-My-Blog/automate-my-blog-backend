# Dead code / surface-area reduction (this PR)

**Goal:** Fewer files, fewer concepts, same behavior. Preserve behavior; prefer deletion; when uncertain, comment instead of guessing.

## Removed

| Item | Reason |
|------|--------|
| `JOB_STATUSES` export (job-queue.js) | Not referenced anywhere in app or tests. |
| `stopEmailScheduler` (jobs/scheduler.js) | Never called; only exported. Can be re-added if graceful shutdown is needed. |
| `normalizeCTAs`, `isValidCTAType`, `isValidPlacement`, `getValidCTATypes`, `getValidPlacements` (cta-normalizer.js) | Only used in tests; production uses only `normalizeCTA`. Arrays can use `(arr \|\| []).map(normalizeCTA)`. |
| `prompts/index.js` (barrel) | Single consumer (openai.js). Openai now imports from `prompts/website-analysis.js` directly. |

## Unchanged (uncertainty)

- Root-level scripts (e.g. `debug-*.js`, `check-*.js`) are left as-is; they may be run manually or by ops. Not imported by the app.
- `formatSSE` in streaming-helpers is used by `writeSSE` and by tests; kept.

## Verification

- `npm test`: 362 passed (1 pre-existing failure: file-extractors missing `pdf-parse`).
- No production code paths changed; only unused exports and one barrel file removed.
