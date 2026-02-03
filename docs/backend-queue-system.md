# Backend Queue System

**Date:** January 2026  
**Spec:** High-level spec for async job queue (see project docs).  
**Status:** Implemented.

---

## Overview

- **Queue:** BullMQ + Redis. Queue name: `amb-jobs`.
- **Job types:** `website_analysis`, `content_generation`.
- **Storage:** Job metadata in PostgreSQL `jobs` table; Redis holds the queue.
- **Worker:** Separate Node process (`npm run worker`). Run alongside the API (e.g. same host or separate container).

---

## Dependencies

- **Redis:** Required for job create, retry, and worker. Set `REDIS_URL` (e.g. `redis://localhost:6379`).
- **PostgreSQL:** `jobs` table and CTA unique constraint. Apply:

  - `database/26_jobs_table.sql` – creates the `jobs` table.
  - `database/27_cta_analysis_unique_constraint.sql` – CTA constraint (if needed).

  With Neon: use the [Neon SQL Editor](https://console.neon.tech) and paste/run each file, or run `psql "$DATABASE_URL" -f database/26_jobs_table.sql` (and 27) locally with your Neon connection string. See **docs/redis-setup.md** for Neon-specific steps.

- **Env:** Add to `.env`:

  ```
  REDIS_URL=redis://localhost:6379
  ```

---

## API (base: `/api/v1/jobs`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/website-analysis` | Start async website analysis. Body: `{ url }`. Optional `x-session-id` or auth. Returns `201 { jobId }`. |
| `POST` | `/content-generation` | Start async content generation. Body: same as `POST /api/v1/enhanced-blog-generation/generate`. Auth required. Returns `201 { jobId }`. |
| `GET` | `/:jobId/status` | Get status, progress, `result` when succeeded, `error` when failed. |
| `POST` | `/:jobId/retry` | Re-enqueue a failed job. Returns `200 { jobId }`. |
| `POST` | `/:jobId/cancel` | Request cancel for queued/running job. Returns `200 { cancelled: true }`. |

All require **auth or** `x-session-id` (for anonymous website-analysis). Jobs are scoped by `user_id` or `session_id`.

---

## Running the worker

```bash
# Ensure REDIS_URL and DATABASE_URL are set (e.g. in .env)
npm run worker
```

Or:

```bash
node jobs/job-worker.js
```

Run the worker as a long-lived process (systemd, Docker, Railway, etc.). The API enqueues jobs; the worker processes them and updates the `jobs` table.

---

## Job lifecycle

1. **Create:** API inserts a row into `jobs` (status `queued`), adds a BullMQ job with `jobId`, returns `jobId`.
2. **Process:** Worker picks the job, sets status `running`, runs the pipeline (website-analysis or content-generation), updates `progress` / `current_step` as it goes.
3. **Complete:** Worker sets status `succeeded` or `failed`, writes `result` or `error`, and sets `finished_at`.
4. **Cancel:** Client calls `POST /:jobId/cancel`. API sets `cancelled_at`. Worker checks at step boundaries and stops, then marks the job `failed` with `error: "Cancelled"`.

---

## Website analysis pipeline

Single job runs: **analyze → audiences → pitches → audience images**.

- **Input:** `{ url }`. Uses `userId` or `sessionId` for org persistence.
- **Output:** Same shape as the combined sync flow (analysis, scenarios with pitches and `imageUrl`, CTAs, `organizationId`).
- **Progress:** Four steps: “Analyzing website…”, “Generating audiences…”, “Generating pitches…”, “Generating images…”.

---

## Content generation

- **Input:** Same as `POST /api/v1/enhanced-blog-generation/generate` (e.g. `topic`, `businessInfo`, `organizationId`, `additionalInstructions`, `options`).
- **Output:** Same shape as the generate API (`data`, `savedPost`, `metadata`, `imageGeneration`, etc.).
- **Credits:** Checked before run; deducted on successful save.

---

## Rollout

1. Run migration 26, add `REDIS_URL`, start Redis.
2. Deploy API. Job endpoints are available; create always enqueues and returns `jobId`.
3. Run the worker (same or separate host). Ensure it can reach Redis and the DB.
4. Frontend switches to async: call `POST /api/v1/jobs/website-analysis` or `POST /api/v1/jobs/content-generation`, then poll `GET /api/v1/jobs/:jobId/status` until `succeeded` or `failed`.
5. Optionally deprecate or redirect existing sync endpoints once frontend is fully migrated.

---

## Checklist (from spec)

- [x] Job queue and worker for `website_analysis` and `content_generation`.
- [x] Create-job API returns `jobId` immediately; status and result stored in DB.
- [x] `GET /api/v1/jobs/:jobId/status` returns status model with `result` on success.
- [x] `POST /api/v1/jobs/:jobId/retry` and `POST /api/v1/jobs/:jobId/cancel`, tenant/user scoped.
- [x] Progress/step updates for website analysis (4 steps); content generation uses a simple “running” step.
- [x] Tenant/user isolation; 404 when job not owned.
- [x] Result shape matches current sync API for each job type.

---

## Frontend handoff

See **`docs/frontend-job-queue-handoff.md`** for passback instructions for the frontend team (API usage, polling, progress, retry/cancel, resumption).
