# Recent updates: what was added and why guardrails matter

This doc summarizes recent additions: CI and deployment guardrails, job-stream partial results and auth fixes, and website-analysis/content-generation speed and caching. It also explains why these changes matter.

---

## Why guardrails matter

Without guardrails, broken code and config can land in main and only show up in production. Migrations with syntax errors, a server that no longer starts, or a PR blocked by a failing Vercel check that we don’t even want to run—all of that wastes time and blocks shipping.

Guardrails catch problems before merge. They don’t replace code review or testing; they add a safety net so we don’t merge things that are obviously broken. The goal is: fewer surprises in production, fewer “it worked on my machine” issues, and PRs that only fail when something actually needs fixing.

---

## What was added

### 1. Migration validation (CI)

**What**  
When a PR changes any file under `database/`, CI spins up a test Postgres instance and runs all migrations in order (`database/*.sql` and `database/migrations/*.sql`). If any SQL has a syntax error or fails to apply, the run fails and the PR is blocked.

**Why it matters**  
Broken migrations are painful to fix in production. Catching bad SQL at PR time means we never merge a migration that doesn’t apply. One workflow run can save hours of debugging later.

Details: [GitHub Actions Quick Wins](./github-actions-quick-wins.md) (Migration Validation).

---

### 2. Smoke test (CI)

**What**  
On every push and PR, CI starts the server (with a test DB) and calls `GET /health`. If the server doesn’t start or health returns an error, the run fails.

**Why it matters**  
Sometimes a change breaks server startup or the health endpoint. Without this, we might not notice until after merge. The smoke test is a cheap way to catch “the server won’t even start” before it hits main.

Details: [GitHub Actions Quick Wins](./github-actions-quick-wins.md) (API Endpoint Smoke Tests).

---

### 3. Vercel: only build production

**What**  
We only want Vercel to build and deploy when we push to `main`. PRs and other branches should not trigger a Vercel build. In the Vercel project, **Ignore Build Step** is set to an inline command so only production builds run. PRs and branches skip the build, so the Vercel check no longer blocks merge.

**Why it matters**  
We were seeing “Vercel — Deployment has failed” on PRs even though we don’t deploy from branches. That blocked merges for no good reason. Configuring the ignore step so only production builds run keeps PRs unblocked and matches how we actually deploy.

Details: [Vercel: Only Build Production](./vercel-preview-builds.md).

---

### 4. Documentation updates

**What**  
- **README** – CI/CD section updated to list migration validation and smoke test, plus links to the quick-wins doc, Vercel doc, and this doc.  
- **Vercel doc** – Rewritten to focus on the inline Ignore Build Step command and simple copy-paste setup.  
- **This doc** – Central place for “what was added and why guardrails matter.”

**Why it matters**  
If only one person knows how the guardrails work, they become fragile. Written docs let anyone check how migration validation, smoke test, and Vercel are set up, and why we have them. New contributors (or future us) can get up to speed without digging through history.

---

---

## 5. Job stream partial results (SSE)

**What**  
The job stream (`GET /api/v1/jobs/:jobId/stream`) now pushes **partial results** as each stage finishes, instead of only progress and a final `complete` event.

- **Content generation:** After you open the stream for a content-generation job, you get **context-result** (organization context loaded), **blog-result** (post body ready so the user can read while visuals/SEO run), **visuals-result**, **seo-result**, then **complete**. Existing clients that only listen for **progress-update** and **complete** keep working.
- **Website analysis:** You get **scrape-result** (page title, meta, headings), **analysis-result** (org summary, CTAs), then per-item events (**audience-complete**, **pitch-complete**, **scenario-image-complete**) and step-level results (**audiences-result**, **pitches-result**, **scenarios-result**) before **complete**. The UI can show each audience, pitch, or image as it lands. Progress events include a **phase** field and a **scrape-phase** event for granular “thinking” steps during scraping.

**Why it matters**  
Users see value sooner (e.g. blog body or analysis summary) instead of waiting for the full pipeline. Frontend can build incremental UIs (one card per audience, update as pitch/image arrives) or keep the simpler “wait for complete” flow.

**Docs**  
- [content-generation-stream-frontend-handoff.md](./content-generation-stream-frontend-handoff.md) — content-generation events and payloads.  
- [website-analysis-stream-frontend-handoff.md](./website-analysis-stream-frontend-handoff.md) — website-analysis events and payloads.  
- [job-stream-sse.md](./job-stream-sse.md) — full event schema and scrape/phase details.

---

## 6. Job stream and auth fixes

**What**  
- **Pacing:** Job SSE events are sent one per tick on the API so the frontend doesn’t get bursts of events; progress and partial results stream in real time.  
- **Auth:** If the job’s `user_id` is not in the `users` table (e.g. JWT user not yet synced), the API returns 401 for the job stream/status. When a JWT is present but the user isn’t in the DB, the job queue falls back to session-only (e.g. `sessionId`) so anonymous/session jobs still run and can be streamed with `?sessionId=`.

**Why it matters**  
Predictable event pacing avoids UI jank. Strict ownership (user must exist for JWT jobs) keeps streams secure; session fallback keeps anonymous flows working.

---

## 7. Website analysis: speed, caching, and research

**What**  
- **Faster research:** Website analysis uses a single batched research call (brand, competitors, keywords) instead of multiple sequential calls; progress phases are more granular so the UI can show “Researching business”, “Researching keywords & SEO”, etc.  
- **Caching:** Website analysis results are cached by URL for up to 30 days. Cache key is URL-only (no user/session) so repeat analyses of the same site are fast.  
- **Scraping “thoughts”:** The **scrape-phase** SSE event streams sub-steps (validating URL, launching browser, navigating, extracting, etc.) so the frontend can show a step-by-step log during “Fetching page content”.

**Why it matters**  
Faster analysis and cache reuse improve perceived speed; granular phases and scrape-phase events improve the “thinking” UX without changing the final result shape.

---

## 8. Content generation: parallel visuals and SEO

**What**  
Visual suggestions and SEO analysis for blog posts now run **in parallel** after the blog content is ready. The existing-audiences query is overlapped with the analyze step where possible. No change to API shape; **blog-result** still fires first, then **visuals-result** and **seo-result** (order may vary), then **complete**.

**Why it matters**  
Shorter time to **complete**; the user still sees the post body as soon as **blog-result** arrives.

---

## 9. YouTube video search stream

**What**  
Streaming YouTube video search for a selected topic. Same pattern as tweet search.

- **Start:** `POST /api/v1/youtube-videos/search-for-topic-stream` with `topic`, `businessInfo`, optionally `maxVideos` → returns `connectionId` and `streamUrl`.
- **Listen:** `GET /api/v1/stream/:connectionId?token=...` or `?sessionId=...`.
- **Events:** `queries-extracted`, `complete` (with `videos`), `error`.

**Why it matters**  
Enables content workflows to surface relevant YouTube videos alongside tweets. Requires `YOUTUBE_API_KEY`; if unset, returns empty results gracefully.

**Docs**  
- [youtube-videos-search-stream-frontend-handoff.md](./youtube-videos-search-stream-frontend-handoff.md)

---

## 10. News article search stream

**What**  
Streaming news article search for a selected topic. Same pattern as tweet and YouTube search.

- **Start:** `POST /api/v1/news-articles/search-for-topic-stream` with `topic`, `businessInfo`, optionally `maxArticles` → returns `connectionId` and `streamUrl`.
- **Listen:** `GET /api/v1/stream/:connectionId?token=...` or `?sessionId=...`.
- **Events:** `queries-extracted`, `complete` (with `articles`), `error`.

**Why it matters**  
Enables content workflows to surface relevant news coverage ("as seen in", "recent coverage"). Requires `NEWS_API_KEY`; if unset, returns empty results gracefully.

**Docs**  
- [news-articles-search-stream-frontend-handoff.md](./news-articles-search-stream-frontend-handoff.md)

---

## Quick reference

| Addition            | Where it lives                          | When it runs / what it does                    |
|---------------------|-----------------------------------------|-----------------------------------------------|
| Migration validation| `.github/workflows/migration-validation.yml` | When `database/**/*.sql` changes; runs all migrations. |
| Smoke test          | `.github/workflows/smoke-test.yml`      | Every push/PR; starts server, hits `/health`. |
| Vercel ignore step  | Vercel Dashboard → Git → Ignore Build Step | Only production builds; PRs/branches skip.     |
| Quick wins / CI list| [github-actions-quick-wins.md](./github-actions-quick-wins.md) | Full list of workflows and how they work.      |
| Vercel setup        | [vercel-preview-builds.md](./vercel-preview-builds.md) | Copy-paste command and one-time setup.         |
| Job stream partials | [content-generation-stream-frontend-handoff.md](./content-generation-stream-frontend-handoff.md), [website-analysis-stream-frontend-handoff.md](./website-analysis-stream-frontend-handoff.md) | SSE events and payloads for incremental UI.   |
| YouTube video search | [youtube-videos-search-stream-frontend-handoff.md](./youtube-videos-search-stream-frontend-handoff.md) | `POST /api/v1/youtube-videos/search-for-topic-stream` → SSE with `videos`. |
| News article search | [news-articles-search-stream-frontend-handoff.md](./news-articles-search-stream-frontend-handoff.md) | `POST /api/v1/news-articles/search-for-topic-stream` → SSE with `articles`. |