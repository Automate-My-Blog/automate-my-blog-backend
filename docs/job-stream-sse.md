# Job Queue SSE (Phase 5)

Real-time job progress via SSE. Replaces polling `GET /api/v1/jobs/:jobId/status` with push-based updates. See [GitHub issue #94](https://github.com/Automate-My-Blog/automate-my-blog-backend/issues/94).

**Depends on:** Phase 1 (SSE infrastructure, issue #95).

## Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/jobs/:jobId/stream?token=JWT` | `?token=` or `Authorization` / `x-session-id` | Open SSE stream for job progress. EventSource-compatible. |

- **Auth:** Same as status endpoint. Validate user owns job (user or session). Support `?token=` for EventSource (no custom headers).
- **Connection lifecycle:** Closes on job complete/fail or after **10 min** timeout. Cleanup on client disconnect (no memory leaks).
- **Backwards compatibility:** `GET /api/v1/jobs/:jobId/status` unchanged (polling still supported).

## Event schema (frontend contract)

```json
{ "type": "progress-update", "data": { "progress": 50, "currentStep": "Writing...", "estimatedTimeRemaining": 30 } }
{ "type": "step-change", "data": { "progress": 0, "currentStep": null, "estimatedTimeRemaining": null } }
{ "type": "complete", "data": { "result": { ... } } }
{ "type": "failed", "data": { "error": "...", "errorCode": "..." } }
```

- **connected** — First event: `{ connectionId, jobId }`.
- **progress-update** — Progress percentage, current step, estimated time remaining.
- **step-change** — Job started or step changed.
- **complete** — Job succeeded; `data.result` is the job result.
- **failed** — Job failed or cancelled; `data.error`, `data.errorCode`.

## Redis

- **Channel:** `jobs:{jobId}:events` (see `utils/job-stream-channels.js`).
- **Publisher:** `jobs/job-worker.js` publishes progress, complete, failed via Redis.
- **Subscriber:** Stream manager (API) subscribes to `jobs:*:events` and forwards to connections subscribed to that job.

## Acceptance criteria (issue #94)

- [x] SSE connection delivers progress updates in real-time
- [x] Connection closes on job complete/fail or timeout (10 min)
- [x] No memory leaks from unclosed connections (cleanup on close/error, unsubscribeFromJob)
- [x] Unauthorized users cannot connect to another user's job stream (ownership via getJobStatus)

## Files

- `routes/jobs.js` — GET `/:jobId/stream`, auth, stream-manager.subscribeToJob, 10 min maxAgeMs
- `services/stream-manager.js` — subscribeToJob, unsubscribeFromJob, jobs:*:events handler, publishJobEvent
- `utils/job-stream-channels.js` — getJobEventsChannel(jobId), JOB_EVENTS_PATTERN
- `jobs/job-worker.js` — publishJobStreamEvent(connection, jobId, event, data) on progress, complete, failed
