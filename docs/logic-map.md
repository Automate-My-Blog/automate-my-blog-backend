# Backend Logic Map

High-level map of request flows, where business rules live, core domain, and complexity hotspots. Used for refactoring and onboarding.

## 1. Main Request Flows (Top 5)

| Flow | Entrypoint | Auth | Main logic location | Notes |
|------|------------|------|---------------------|--------|
| **Auth (register/login/refresh)** | `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh` | None (public) | `index.js` (handlers) + `services/auth-database.js` | Validation (email, password length) in handlers; register/login delegate to authService. |
| **Website analysis (sync)** | `POST /api/analyze-website` | Optional (JWT/session) | `index.js` (~600 lines inline) | Scrape → OpenAI → lead capture → org/intelligence/CTA save. Org resolution (user vs anonymous, adoption) and DB writes are in this single block. |
| **Jobs (async analysis/content)** | `POST /api/v1/jobs/website-analysis`, `POST /api/v1/jobs/content-generation`, `GET /api/v1/jobs/:id/status`, retry, cancel | Optional auth or session | `routes/jobs.js` + `services/job-queue.js` | Handlers thin; job-queue has createJob, getJobStatus, retryJob, cancelJob. Ownership: user_id XOR session_id. |
| **Blog posts CRUD** | `GET/POST/PUT/DELETE /api/v1/blog-posts`, `GET/POST /api/v1/blog-posts/:id` | Required | `index.js` (handlers) + `services/content.js` | Handlers parse input and call contentService; 404 inferred from `error.message === 'Blog post not found'`. |
| **User profile / credits / referrals** | `PUT /api/v1/user/profile`, `GET /api/v1/user/credits`, `POST /api/v1/user/apply-rewards`, referrals | Required | `index.js` (handlers) + `services/billing.js`, `services/referrals.js`, etc. | Handlers call services; some validation in handlers. |

## 2. Where Business Rules Live Today

- **Controllers / Routes**
  - **index.js**: Auth body validation (required fields, email regex, password length); blog-posts required fields and 404 handling; analyze-website URL check and **all** org/intelligence/CTA persistence logic.
  - **routes/jobs.js**: Input validation (url, topic/businessInfo/organizationId); job context (user/session); error mapping (UserNotFoundError, 23503, REDIS_URL) repeated in each handler.
- **Services**
  - **auth-database.js**: register/login/refresh, user lookup, JWT creation; “user already exists” and DB fallback to memory.
  - **job-queue.js**: createJob (user existence check, Redis required), getJobForAccess (ownership), retryJob (only if status === 'failed'), cancelJob (only if queued/running); job state transitions.
  - **content.js**: getUserBlogPosts, getBlogPost, updateBlogPost, deleteBlogPost; ownership by userId; throws `Error('Blog post not found')` for missing/forbidden.
  - **organizations.js**: createOrUpdateOrganization (URL/domain lookup, update or create); **not** used by the main analyze-website flow, which has its own priority-based org logic in index.js.
- **Models / Data**
  - **database.js**: Generic query interface; no domain rules.
  - Tables: users, organizations, organization_intelligence, jobs, blog_posts, leads, etc.

## 3. Core Domain (Entities + Invariants)

- **Users**: id, email, password hash; owned org via `organizations.owner_user_id`.
- **Organizations**: id, owner_user_id | session_id, website_url, slug; one “current” intelligence record per org (is_current).
- **Organization intelligence**: Attached to organization_id (or session_id for anonymous); analysis JSON fields; is_current flag.
- **Jobs**: id, type (website_analysis | content_generation), status (queued | running | succeeded | failed), user_id | session_id, tenant_id; cancelled_at for soft cancel.
  - **Invariants**: At least one of user_id or session_id; retry only when status === 'failed'; cancel only when status in ('queued', 'running').
- **Blog posts**: user_id owner; CRUD scoped by userId; “not found” when missing or wrong owner.
- **Leads**: Captured from anonymous website analysis; admin-only access.

## 4. Hotspots (Duplication, Complex Conditionals, Inconsistent State)

1. **POST /api/analyze-website (index.js)**
   - Large block (~600 lines) with: JWT extraction duplicated (main block + CTA fallback), priority-based org lookup (user-owned → adopt anonymous by URL → new; anonymous by URL → new), dynamic UPDATE/INSERT building, intelligence and CTA storage. Same ownership rules reappear in CTA fallback. Hard to unit-test and easy to drift from organizationService.
2. **Auth handlers (index.js)**
   - Validation (required fields, email format, password length) in handlers; could be named rules in a small domain layer for reuse and tests.
3. **Blog-posts error handling (index.js)**
   - Repeated `if (error.message === 'Blog post not found') res.status(404)...` in get/update/delete; fragile (string match). Prefer typed errors (e.g. NotFoundError).
4. **Job routes (routes/jobs.js)**
   - Same catch blocks for UserNotFoundError, 23503, REDIS_URL, and generic 500 repeated in multiple endpoints; should be a single “job error → HTTP” mapper.
5. **Job state transitions**
   - Allowed transitions live in job-queue.js (retry: failed → queued; cancel: queued|running → cancelled_at set). No single “allowed transitions” constant or table; worker and API share implicit contract.

## 5. Error Handling Today

- No shared domain error types; services throw `Error` with message or ad-hoc properties (e.g. `err.statusCode = 400` in job-queue).
- Handlers map errors to HTTP by: `error.message` string checks, `error.code` (e.g. 23503), `error.name` (UserNotFoundError). Response shape is consistent (`error`, `message`) but mapping is scattered.

## 6. Refactor Direction (from this map)

- **Domain errors**: Introduce a small set (e.g. NotFoundError, ValidationError, ConflictError, UnauthorizedError, InvariantViolation) and map once to HTTP in a central handler or helper.
- **Thin handlers**: Auth and blog-posts: parse input → call domain/service → send response; validation and “not found” as domain rules or typed errors.
- **Analyze-website**: Extract org resolution and intelligence/CTA persistence into a service (or extend organizationService) so index.js only: validate URL → call scraper + OpenAI → call lead capture → call org/intelligence/CTA service → return analysis.
- **Jobs**: Keep routes thin; centralize “job API error → HTTP” in one place; optionally add JOB_STATUS_TRANSITIONS or allowed states in job-queue for clarity.
- **State transitions**: Document and enforce job transitions in job-queue only; ensure worker and API agree on when retry/cancel are allowed.

## 7. Refactor Status (logic cleanup)

- **Domain errors** (`lib/errors.js`): NotFoundError, ValidationError, UnauthorizedError, ConflictError, InvariantViolation, ServiceUnavailableError; `toHttpResponse(err)` used by global error middleware in index.js.
- **Auth**: `lib/auth-validation.js` — validateRegistrationInput, validateLoginInput, validateRefreshInput (throw ValidationError); handlers are thin.
- **Blog posts**: content service throws NotFoundError; handlers call next(error); global handler maps to 404. Blog post create/update validation extracted to `lib/blog-post-validation.js`.
- **Jobs**: `routes/jobs.js` — single `sendJobError(res, e)` maps UserNotFoundError → 401, REDIS_URL → 503, statusCode 400 → 400, InvariantViolation/ServiceUnavailableError → same semantics; job-queue throws InvariantViolation for retry/cancel rules, ServiceUnavailableError for missing Redis.
- **Job state transitions**: job-queue.js exports JOB_STATUSES, RETRIABLE_STATUS, CANCELLABLE_STATUSES; retry only when status === 'failed'; cancel only when status in ('queued', 'running').
