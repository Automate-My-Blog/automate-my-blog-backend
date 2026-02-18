# Backend Logic Cleanup — Refactor Notes

Refactor focused on business logic clarity, safety, and testability without changing API contract or behavior.

## Chunk 1: Logic map and refactor status

**What changed**
- Updated `docs/logic-map.md` with a new section **7. Refactor Status** summarizing where domain errors, auth validation, blog post validation, job error mapping, and job state transitions live after this refactor.

**Why**
- Single place to see current state of “where rules live” for future refactors and onboarding.

**Verification**
- No code behavior change; docs only.

---

## Chunk 2: Job queue — domain errors and exported state constants

**What changed**
- `services/job-queue.js`:
  - Import and throw `InvariantViolation` for retry (when status !== 'failed') and cancel (when status not in 'queued'|'running') instead of ad-hoc `Error` with `statusCode = 400`.
  - Throw `ServiceUnavailableError` from `ensureRedis()` when REDIS_URL is missing or invalid instead of generic `Error`.
  - Exported `RETRIABLE_STATUS` and `CANCELLABLE_STATUSES` (already had `JOB_STATUSES`).
  - Added JSDoc describing allowed state transitions (retry only from failed; cancel only from queued/running).

**Why**
- Retry/cancel failures are invariant violations; Redis missing is a service availability issue. Using domain errors makes intent explicit and allows consistent mapping in one place.
- Exporting state constants makes allowed transitions visible and testable.

**Verification**
- `npm test -- tests/unit/job-queue.test.js` — all tests pass. Tests updated to expect `InvariantViolation` and `ServiceUnavailableError` by name where applicable; new test for exported state constants.

---

## Chunk 3: Jobs route — central error mapping for domain errors

**What changed**
- `routes/jobs.js`:
  - Import `InvariantViolation` and `ServiceUnavailableError` from `lib/errors.js`.
  - `sendJobError(res, e, defaultMessage)` now handles `e instanceof ServiceUnavailableError` (503) and `e instanceof InvariantViolation` (400 or `e.statusCode`), in addition to existing `UserNotFoundError`, REDIS_URL message, and legacy `e.statusCode === 400`.
  - Response shape unchanged: `{ success: false, error, message }`.

**Why**
- Job API keeps its own response shape; mapping domain errors in one function keeps behavior consistent and avoids scattered conditionals.

**Verification**
- Existing job route behavior unchanged (same status codes and messages). Unit tests for job-queue cover thrown types; jobs API tests (`tests/unit/jobs-api.test.js`) exercise routes with mocks.

---

## Chunk 4: Blog post validation — domain layer

**What changed**
- New `lib/blog-post-validation.js`:
  - `validateCreateBlogPostBody(body)` — requires `title` and `content` (non-empty), returns normalized object; throws `ValidationError` otherwise.
  - `validateUpdateBlogPostBody(body)` — requires at least one of `title`, `content`, `status`; returns updates object; throws `ValidationError` when empty.
- `index.js` blog-posts handlers:
  - POST create: call `validateCreateBlogPostBody(req.body)`, then `contentService.saveBlogPost` with parsed fields.
  - PUT update: call `validateUpdateBlogPostBody(req.body)`, then `contentService.updateBlogPost` with returned updates.
- Removed inline validation branches from handlers.

**Why**
- Named validation rules in one place: easier to test, reuse, and map to 400 via global error handler (ValidationError → 400).

**Verification**
- `npm test -- tests/unit/blog-post-validation.test.js` — new tests for create/update validation and error types.
- Existing blog-posts behavior: same 400 messages and 201/200 responses; global error handler already maps ValidationError to 400.

---

## Chunk 5: Content service — NotFoundError tests

**What changed**
- `services/content.js`: no code change (already throws `NotFoundError` for get/update/delete when post missing or wrong owner).
- `tests/unit/content.test.js`:
  - getBlogPost: assert thrown error is `NotFoundError` with `resource: 'blog_post'` for both “not found” and “wrong owner”.
  - updateBlogPost: new test that updating non-existent or wrong-owner post throws `NotFoundError`.
  - deleteBlogPost: new test that deleting non-existent or wrong-owner post throws `NotFoundError`.

**Why**
- Ensures content layer keeps using typed errors so the global handler can return 404 consistently; tests guard against regressions.

**Verification**
- `npm test -- tests/unit/content.test.js` — all tests pass.

---

## Chunk 6: Job queue unit tests — domain errors and constants

**What changed**
- `tests/unit/job-queue.test.js`:
  - New describe “state constants”: assert `JOB_STATUSES`, `RETRIABLE_STATUS`, `CANCELLABLE_STATUSES` values.
  - retry “not failed” and cancel “not cancellable”: expect `InvariantViolation` with `name`, `message`, `statusCode`.
  - createJob “REDIS_URL missing”: expect `ServiceUnavailableError` and message containing `REDIS_URL`.

**Why**
- Table-driven coverage of state transition rules and dependency-unavailable case; documents expected error types.

**Verification**
- `npm test -- tests/unit/job-queue.test.js` — all tests pass.

---

## Summary

| Area              | Change                                                                 | Behavior preserved |
|-------------------|------------------------------------------------------------------------|--------------------|
| Logic map         | Documented refactor status                                             | Yes                |
| Job queue         | InvariantViolation / ServiceUnavailableError; export state constants   | Yes                |
| Jobs route        | sendJobError handles domain errors                                     | Yes (same status/body) |
| Blog posts        | Validation in lib/blog-post-validation.js; handlers call validators  | Yes                |
| Content           | Tests for NotFoundError                                                | Yes                |
| Tests             | blog-post-validation.test.js; job/content error and constant tests     | N/A                |

**How behavior was verified**
- `npm test` (unit tests).
- No API contract or response shape changes; only internal error types and centralization of validation and error mapping.

**NOTE (ambiguous intent)**
- Analyze-website (index.js): large block with org/intelligence/CTA logic was not extracted to a service in this refactor to keep the change set small and avoid risk. Logic map and LAYER_BOUNDARIES already call this out as a future extraction target.

---

## Chunk 7: Analyze-website persistence service and thin handler

**What changed**
- New `services/website-analysis-persistence.js`:
  - `resolveOrganization(db, { userId, sessionId, url })` — priority-based org lookup (user_owned → anonymous_adoption → new_for_user; anonymous_session → new_anonymous). No DB writes.
  - `buildOrganizationAndIntelligenceData(analysis, url)` — builds organizationData and intelligenceData from analysis (pure).
  - `saveOrganizationAndIntelligence(db, ...)` — update or create org, mark previous intelligence not current, insert new intelligence row.
  - `storeCTAs(db, organizationId, pageUrl, ctas)` — clear old CTAs, insert normalized CTAs, update has_cta_data flag.
  - `getStoredCTAs(db, organizationId, limit)` — fetch CTAs for response.
  - `saveAnalysisResult(db, { userId, sessionId, url, analysis, ctas })` — single entry point: no-op when !userId && !sessionId; otherwise resolve → save org+intelligence → store CTAs → return { organizationId, storedCTAs, ctaStoredCount }.
- `index.js` analyze-website handler:
  - URL validation now throws `ValidationError` (message/details) so global error handler can return 400.
  - Handler uses `(req, res, next)` and in catch calls `next(error)` so domain errors are mapped centrally.
  - Replaced ~450 lines of inline org/intelligence/CTA logic with: extract userId/sessionId from JWT and x-session-id → `saveAnalysisResult(db, { userId, sessionId, url, analysis, ctas: scrapedContent.ctas || [] })` → use returned organizationId, storedCTAs, ctaStoredCount for narrative job and response. Persistence errors are logged and do not fail the request (same as before).

**Why**
- Business rules (org resolution, intelligence and CTA persistence) live in one service with named functions; handler only parses input, calls service, and forwards errors.
- ValidationError for URL gives consistent 400 via toHttpResponse; single catch with next(error) avoids ad-hoc status codes in this handler.

**Verification**
- `npm test` — all tests pass, including new `tests/unit/website-analysis-persistence.test.js` (resolveOrganization sources, buildOrganizationAndIntelligenceData, saveAnalysisResult no-op when no user/session, storeCTAs, getStoredCTAs).
- No API contract or response shape change for POST /api/analyze-website; same success response and 400/500 semantics.

---

## Chunk 8: Logic map and remaining hotspots

**What changed**
- `docs/logic-map.md`: Added **§7** bullet for analyze-website persistence service and handler flow; added **§8. Remaining Hotspots** (handlers that don’t use next(error), Stripe/other routes).

**Why**
- Single place to see where persistence and remaining ad-hoc error handling live for future refactors.

**Verification**
- Docs only; no behavior change.
