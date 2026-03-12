# Content Calendar — Backend Handoff

**Purpose:** Handoff for backend support of the 30-day content calendar: existing contracts the frontend uses, job stream semantics, and **requested** support so that calendar generation can be triggered for an audience (e.g. testbed-created audiences or "Regenerate calendar") and the frontend can show progress via the job stream.

**Frontend references:** [CONTENT_CALENDAR_GENERATION_PROGRESS_STREAMING.md](./CONTENT_CALENDAR_GENERATION_PROGRESS_STREAMING.md) (stream events, phases), [CONTENT_CALENDAR_FRONTEND_WORKFLOW.md](./CONTENT_CALENDAR_FRONTEND_WORKFLOW.md) (polling behavior), [CONTENT_CALENDAR_FRONTEND_HANDOFF.md](./CONTENT_CALENDAR_FRONTEND_HANDOFF.md) (endpoints, shapes). [backend-queue-system-specification.md](./backend-queue-system-specification.md) (generic job API).

---

## 1. What the frontend does today

| Context | Behavior |
|--------|----------|
| **Dashboard / StrategyDetailsView** | User selects a subscribed strategy (audience) → `ContentCalendarSection` loads that audience and shows the 30-day list or "generating" + polling. |
| **Calendar testbed** (`/calendar-testbed`) | User can create a test audience, pick an audience (or paste ID), and "Load calendar". Same `ContentCalendarSection`; supports `?testbed=1` on requests. |
| **When calendar is ready** | `GET /api/v1/audiences/:id` returns `content_ideas.length > 0` or `content_calendar_generated_at` set → frontend shows the list and stops polling. |
| **When calendar is not ready** | Frontend treats as "generating": shows spinner + "Your 30-day content calendar is being generated…", polls `GET /api/v1/audiences/:id` every **7 seconds** (configurable), up to **2 minutes** before showing "taking longer than expected". Polling stops when ideas/generated_at appear. |
| **When frontend has a `jobId`** | It opens `GET /api/v1/jobs/:jobId/stream?token=...` and shows a progress bar, step label, optional ETA, phase steps, and "Strategy X of Y". On `complete` or `failed`, it refetches audience/calendar or shows error + Retry. If the stream is unavailable, it falls back to polling `GET /api/v1/jobs/:jobId/status`. |

Today, **content_calendar jobs are created by the backend only when a user subscribes** (e.g. Stripe webhook). The frontend typically **does not** receive a `jobId` in that flow, so it only polls the audience endpoint until the calendar is ready. Testbed-created audiences never trigger a subscription, so they never get a calendar unless the backend supports an explicit "trigger generation" API.

---

## 2. Existing contracts (what the frontend calls)

All calendar/audience endpoints require **JWT**: `Authorization: Bearer <accessToken>`. For EventSource (no custom headers), the frontend uses `?token=<accessToken>` on the stream URL.

| Purpose | Method | Endpoint | Notes |
|--------|--------|----------|--------|
| Single audience (calendar data) | GET | `/api/v1/audiences/:id` | Optional `?testbed=1` from testbed. Response must include `content_ideas` (array) and `content_calendar_generated_at` (ISO string or null). |
| All strategies + calendars | GET | `/api/v1/strategies/content-calendar` | Optional query: `?testbed=1`, `?startDate=`, `?endDate=`. Returns strategies with `contentIdeas` and `contentCalendarGeneratedAt`. |
| List audiences | GET | `/api/v1/audiences` | Optional `?testbed=1`, `?limit=`, `?offset=`. Response: `audiences[]` with `has_content_calendar`, `content_calendar_generated_at`. |
| Job stream (SSE) | GET | `/api/v1/jobs/:jobId/stream` | Auth via query: `?token=<accessToken>`. Events: `connected`, `progress-update`, `complete`, `failed`. |
| Job status (polling) | GET | `/api/v1/jobs/:jobId/status` | Same progress/step/ETA semantics as `progress-update`. Frontend uses when stream is unavailable. |
| Retry failed job | POST | `/api/v1/jobs/:jobId/retry` | Optional; frontend offers "Retry" when job has failed and response indicates retryable. |

---

## 3. Audience / calendar response shapes

### 3.1 GET /api/v1/audiences/:id

The frontend considers the calendar **ready** when either:

- `content_ideas` (or `contentIdeas`) has length > 0, or  
- `content_calendar_generated_at` (or `contentCalendarGeneratedAt`) is set (non-null).

Otherwise it shows "generating" and polls. Both snake_case and camelCase are accepted.

| Field | Type | Required for "ready" | Notes |
|-------|------|------------------------|--------|
| `content_ideas` / `contentIdeas` | array | Or `content_calendar_generated_at` set | Array of 30-day ideas (e.g. `{ dayNumber, title, format, keywords, searchIntent }`). |
| `content_calendar_generated_at` / `contentCalendarGeneratedAt` | string \| null | Or `content_ideas.length > 0` | ISO timestamp when calendar was generated. |
| `content_calendar_job_id` | string \| null | Optional | When calendar not ready but a content_calendar job exists (queued/running), so frontend can open the stream. |

### 3.2 GET /api/v1/strategies/content-calendar

Returns `{ strategies: [...] }`. Each strategy/audience should include the same fields as above so the frontend can show "Calendar ready" or "generating" per strategy.

---

## 4. Job stream contract (content_calendar)

When the frontend has a `jobId` for a `content_calendar` job, it connects to `GET /api/v1/jobs/:jobId/stream?token=...` and expects:

| Event | When | Payload (minimal) |
|-------|------|--------------------|
| `connected` | On connect | `{ connectionId?, jobId }` |
| `progress-update` | During run | See §4.1 |
| `complete` | Success | `{ result?: { strategyCount?, succeeded?, failed?, results? } }` |
| `failed` | Failure | `{ error?, errorCode?, retryable? }` |

### 4.1 progress-update payload (content_calendar)

| Field | Type | Description |
|-------|------|-------------|
| `progress` | number | 0–100 for progress bar. |
| `currentStep` | string | Human-readable step, e.g. `"Strategy 2 of 3: Generating 30-day ideas with AI..."`. |
| `estimatedTimeRemaining` | number \| null | Seconds left (or null). |
| `phase` | string | One of: `audience` \| `organization` \| `keywords` \| `generating` \| `saving`. |
| `strategyIndex` | number | 0-based current strategy index (when multiple). |
| `strategyTotal` | number | Total strategies in this job. |
| `strategyId` | string \| null | Current audience/strategy ID (optional). |

For multiple strategies, `currentStep` should be prefixed with `"Strategy X of Y: "`. Progress typically goes 5% → 95% across phases, then 100% with `currentStep: "Complete"` before the `complete` event.

Full event and phase details: [content-calendar-generation-progress-frontend-handoff.md](./content-calendar-generation-progress-frontend-handoff.md).

### 4.2 GET /api/v1/jobs/:jobId/status (polling fallback)

Response should include the same fields as `progress-update` (`progress`, `currentStep`, `estimatedTimeRemaining`, and optionally `phase`, `strategyIndex`, `strategyTotal`), plus `status` (`queued` | `running` | `succeeded` | `failed`), `error` when failed, and `result` when succeeded.

---

## 5. Trigger content calendar generation (implemented)

**Endpoint:** `POST /api/v1/audiences/:audienceId/request-content-calendar`

| Method | Endpoint | Auth | Body | Response |
|--------|----------|------|------|----------|
| POST | `/api/v1/audiences/:audienceId/request-content-calendar` | JWT | `{}` | `201` `{ success, jobId }` (new job) or `200` `{ success, jobId, message }` (existing job in progress) |

- **Authorization:** Caller must own the audience (same user). Returns 401 if not authenticated, 404 if audience not found or not owned.
- **Idempotency:** If a content_calendar job is already queued or running for this audience, returns that job's `jobId` with 200.
- **503** if Redis/job queue is unavailable.

---

## 6. Optional: content_calendar_job_id in audience response (implemented)

In `GET /api/v1/audiences/:id`, when the calendar is not yet ready and an authenticated user has a content_calendar job (queued or running) for this audience, the response includes:

```json
"content_calendar_job_id": "uuid-of-running-or-queued-job"
```

Frontend can use this as `jobId` to open the stream without calling the trigger endpoint first.

---

## 7. Summary checklist for backend

- [x] **Existing:** `GET /api/v1/audiences/:id` returns `content_ideas` and `content_calendar_generated_at`; when both indicate "not ready", frontend polls every 7s.
- [x] **Existing:** `GET /api/v1/jobs/:jobId/stream` supports content_calendar jobs and emits `connected`, `progress-update` (with progress, currentStep, phase, strategyIndex/Total), `complete`, `failed`.
- [x] **Existing:** `GET /api/v1/jobs/:jobId/status` returns progress/step/ETA and status; `POST /api/v1/jobs/:jobId/retry` retries failed jobs.
- [x] **Requested:** New endpoint to trigger content calendar generation and return `jobId`: `POST /api/v1/audiences/:id/request-content-calendar`.
- [x] **Optional:** When an audience has no calendar yet but a content_calendar job exists, return `content_calendar_job_id` in the audience payload.

---

## 8. Related docs

- [content-calendar-generation-progress-frontend-handoff.md](./content-calendar-generation-progress-frontend-handoff.md) — Frontend progress UI and stream event details.
- [content-calendar-frontend-handoff-pasteable.md](./content-calendar-frontend-handoff-pasteable.md) — Endpoints and response shapes for the calendar UI.
- [job-stream-sse.md](./job-stream-sse.md) — Job stream event schema.
