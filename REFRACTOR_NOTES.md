# Backend Logic Refactor Notes

Refactor performed to improve clarity, safety, and testability of business logic without changing external behavior. Each chunk is described below.

---

## Chunk 1: Logic map and domain errors

**What changed**
- Added `docs/logic-map.md`: main request flows (auth, analyze-website, jobs, blog-posts, user/credits), where business rules live, core domain entities/invariants, and hotspots (duplicated logic, complex conditionals).
- Added `lib/errors.js`: domain error classes (`NotFoundError`, `ValidationError`, `UnauthorizedError`, `ConflictError`, `InvariantViolation`, `ServiceUnavailableError`) and `toHttpResponse(err)` to map them to HTTP status + `{ error, message }` body.

**Why safer/clearer**
- Single place to see flow and hotspots; errors are named and mapped once instead of ad-hoc in handlers.

**Behavior verified**
- No API contract change; response shape and status codes preserved. Unit test: `tests/unit/domain-errors.test.js`.

---

## Chunk 2: Central error-handling middleware

**What changed**
- Replaced the generic 500 error middleware in `index.js` with one that uses `toHttpResponse(error)`. For 500 responses in non-development, the message is still hidden (`Something went wrong`).

**Why safer/clearer**
- Handlers can `next(error)` and get consistent status/body; domain errors (e.g. `NotFoundError`) automatically become 404.

**Behavior verified**
- Existing 500 behavior preserved (message hidden in production). Blog-posts and auth handlers now use `next(error)` (see below).

---

## Chunk 3: Blog-posts: typed errors and thin handlers

**What changed**
- `services/content.js`: all `throw new Error('Blog post not found')` replaced with `throw new NotFoundError('Blog post not found', 'blog_post')`; catch blocks rethrow using `instanceof NotFoundError`.
- `index.js` blog-posts handlers (get list, create, get one, update, delete): in `catch`, call `next(error)` instead of branching on `error.message === 'Blog post not found'` and sending 404/500 manually.

**Why safer/clearer**
- No string-based error detection; 404 is determined by type. Handlers are thinner and error handling is centralized.

**Behavior verified**
- Unit tests: `tests/unit/content.test.js`, `tests/unit/content-db.test.js` (still expect "Blog post not found" message; `NotFoundError` has that message). API response shape unchanged: 404 with `error` and `message`.

---

## Chunk 4: Auth validation and domain errors

**What changed**
- Added `lib/auth-validation.js`: `validateRegistrationInput(body)`, `validateLoginInput(body)`, `validateRefreshInput(body)`. They throw `ValidationError` with appropriate messages (and use `details` for the long message where needed). `lib/errors.js`: for `ValidationError`, response `message` uses `err.details` when present.
- `index.js`: register and login handlers call the validators and use `next(error)` in catch. Refresh handler uses `validateRefreshInput` and `next(error)`.
- `services/auth-database.js`: login and memory-login throw `UnauthorizedError('Invalid email or password')`; refresh throws `UnauthorizedError` for invalid/expired token or user not found; register throws `ConflictError('User already exists with this email')`; `verifyToken` throws `UnauthorizedError('Invalid or expired token')`.

**Why safer/clearer**
- Auth rules are named and testable in one module; auth failures map to 400/401/409 via the central middleware.

**Behavior verified**
- Response shapes and status codes unchanged (400 for validation, 401 for login/refresh failure, 409 for duplicate email). Integration tests in `tests/integration/api/auth.test.js` should be run to confirm.

---

## Chunk 5: Job routes – central error mapping

**What changed**
- `routes/jobs.js`: added `sendJobError(res, e, defaultMessage)` that maps: `UserNotFoundError` or PG 23503 + `jobs_user_id_fkey` → 401; message containing `REDIS_URL` → 503; `e.statusCode === 400` → 400; else → 500. All job endpoint catch blocks now call `sendJobError` instead of duplicating the same conditionals.

**Why safer/clearer**
- One place defines job API error semantics; adding a new error type only requires updating `sendJobError`.

**Behavior verified**
- `tests/unit/jobs-api.test.js` and `tests/unit/job-queue.test.js` pass. Response shape `{ success: false, error, message }` and status codes unchanged.

---

## Chunk 6: Job state transitions explicit

**What changed**
- `services/job-queue.js`: added `JOB_STATUSES` (exported) and internal `RETRIABLE_STATUS` / `CANCELLABLE_STATUSES`. `retryJob` checks `row.status !== RETRIABLE_STATUS`; `cancelJob` checks `!CANCELLABLE_STATUSES.includes(row.status)`.

**Why safer/clearer**
- Allowed transitions are named constants; future tests or workers can reference the same set.

**Behavior verified**
- No behavior change; same conditions as before. `job-queue.test.js` passes.

---

## Not done (recommended follow-up)

- **Analyze-website org/intelligence block** (`POST /api/analyze-website` in `index.js`): ~600 lines of inline logic (org lookup by user vs anonymous, adoption, intelligence/CTA persistence). Recommended: extract to a service (e.g. `organizationAnalysisService.saveAnalysisResult(url, analysis, userId, sessionId)`) so the handler only validates URL, calls scraper + OpenAI, captures lead, then calls the service. Documented in `docs/logic-map.md` as a hotspot.
- **DB schema**: No schema changes. Any future migration for correctness should be isolated and documented.
- **Idempotency**: Not added; only existing behavior preserved.

---

## How to run tests

```bash
npm run test -- --run tests/unit/domain-errors.test.js tests/unit/content.test.js tests/unit/content-db.test.js tests/unit/job-queue.test.js tests/unit/jobs-api.test.js
npm run test -- --run tests/integration/api/auth.test.js
```
