# Content Calendar — Backend Return Handoff (for Frontend)

**Purpose:** Return handoff from backend to frontend. The backend has implemented the requested content calendar trigger and optional `jobId` in the audience response. Use this doc to integrate.

---

## 1. What the backend implemented

| Item | Status | Description |
|------|--------|-------------|
| **Trigger endpoint** | Done | `POST /api/v1/audiences/:audienceId/request-content-calendar` — enqueue a content calendar job for an audience and get `jobId`. |
| **Idempotency** | Done | If a job is already queued or running for that audience, returns that job’s `jobId` (200) instead of creating a duplicate. |
| **content_calendar_job_id on audience** | Done | `GET /api/v1/audiences/:id` now includes `content_calendar_job_id` when the calendar is not ready but a content_calendar job exists (queued or running). |
| **Job stream (existing)** | Unchanged | `GET /api/v1/jobs/:jobId/stream?token=...` — `progress-update` events include granular fields: `progress`, `currentStep`, `phase`, `strategyIndex`, `strategyTotal`, `estimatedTimeRemaining`. |

---

## 2. Trigger: request content calendar

**Endpoint:** `POST /api/v1/audiences/:audienceId/request-content-calendar`

**Auth:** JWT required. `Authorization: Bearer <accessToken>`.

**Body:** Empty `{}` or no body.

**Responses**

| Status | Body | When |
|--------|------|------|
| **201** | `{ "success": true, "jobId": "uuid" }` | New job enqueued. |
| **200** | `{ "success": true, "jobId": "uuid", "message": "Content calendar job already in progress" }` | A job for this audience is already queued or running; use this `jobId` for stream/status. |
| **401** | `{ "success": false, "error": "Unauthorized", "message": "..." }` | Not authenticated. |
| **404** | `{ "success": false, "error": "Audience not found", "message": "..." }` | Audience does not exist or caller does not own it. |
| **503** | `{ "success": false, "error": "Service unavailable", "message": "Job queue is temporarily unavailable..." }` | Redis/queue down. |

**Frontend usage**

- **Calendar testbed:** After creating a test audience (or when user picks an audience and taps “Load calendar”), call this with the audience ID. Use the returned `jobId` to open the job stream and show progress; on `complete`, refetch the audience to show the 30-day list.
- **Regenerate calendar:** “Regenerate” button calls this with the current audience ID, then opens the stream with the returned `jobId`.

---

## 3. GET audience: optional content_calendar_job_id

**Endpoint:** `GET /api/v1/audiences/:id` (unchanged; optional query `?testbed=1`).

**New optional field in `audience`:**

| Field | Type | When present |
|-------|------|-----------------------------|
| `content_calendar_job_id` | string (UUID) | Calendar not ready and an authenticated user has a content_calendar job (queued or running) for this audience. |

If present, the frontend can use it as `jobId` and connect to `GET /api/v1/jobs/:jobId/stream?token=...` (or poll `GET /api/v1/jobs/:jobId/status`) to show progress without calling the trigger endpoint first. If absent, keep current behavior (e.g. polling audience every 7s until `content_ideas` or `content_calendar_generated_at` is set).

---

## 4. Job stream (reference)

- **URL:** `GET /api/v1/jobs/:jobId/stream?token=<accessToken>`
- **Events:** `connected` → `progress-update` (repeated) → `complete` or `failed`.
- **progress-update.data:** `progress` (0–100), `currentStep` (e.g. `"Strategy 2 of 3: Generating 30-day ideas with AI..."`), `estimatedTimeRemaining`, `phase` (`audience` | `organization` | `keywords` | `generating` | `saving`), `strategyIndex`, `strategyTotal`, `strategyId`.
- **complete:** Refetch audience; calendar will be ready.
- **failed:** Show `data.error`; optionally offer `POST /api/v1/jobs/:jobId/retry`.

Full event details: [content-calendar-generation-progress-frontend-handoff.md](./content-calendar-generation-progress-frontend-handoff.md).

---

## 5. Integration checklist (frontend)

- [ ] **Testbed / “Load calendar”:** After user has an audience ID, call `POST /api/v1/audiences/:id/request-content-calendar`. On 200/201, open stream with returned `jobId` and show progress; on `complete`, refetch audience and render calendar.
- [ ] **Regenerate:** “Regenerate calendar” calls same POST endpoint with audience ID, then uses returned `jobId` for stream (or status polling).
- [ ] **When loading audience:** If `GET /api/v1/audiences/:id` returns `content_calendar_job_id`, use it as `jobId` to open the stream (or poll job status) instead of only polling the audience.
- [ ] **Fallback:** If stream is unavailable or closes early, poll `GET /api/v1/jobs/:jobId/status` until `status` is `succeeded` or `failed`; then refetch audience or show error.
- [ ] **Errors:** Handle 401 (re-auth), 404 (audience not found / no access), 503 (retry later).

---

## 6. Backend docs (for reference)

- [content-calendar-generation-progress-frontend-handoff.md](./content-calendar-generation-progress-frontend-handoff.md) — Stream events and progress UI.
- [content-calendar-frontend-handoff-pasteable.md](./content-calendar-frontend-handoff-pasteable.md) — Endpoints and response shapes.
- [CONTENT_CALENDAR_BACKEND_HANDOFF.md](./CONTENT_CALENDAR_BACKEND_HANDOFF.md) — Full backend handoff (contracts and checklist).
