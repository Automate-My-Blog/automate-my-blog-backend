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
{ "type": "progress-update", "data": {
  "progress": 50,
  "currentStep": "Analyzing website",
  "phase": "Fetching page content",
  "detail": "5 audiences",
  "estimatedTimeRemaining": 30
} }
{ "type": "scrape-phase", "data": { "phase": "navigate", "message": "Navigating to page", "url": "https://..." } }
{ "type": "step-change", "data": { "progress": 0, "currentStep": null, "estimatedTimeRemaining": null } }
{ "type": "complete", "data": { "result": { ... } } }
{ "type": "failed", "data": { "error": "...", "errorCode": "..." } }
```

- **connected** — First event: `{ connectionId, jobId }`.
- **progress-update** — Progress percentage, current step, estimated time remaining. Optional **phase** (granular sub-step for Thinking UX) and **detail** (e.g. "5 audiences").
- **scrape-phase** — Granular website-scraping “thoughts”: one event per sub-step (validate, browser-launch, navigate, extract, ctas, fallbacks). Use for a step-by-step scraping log. **phase** = machine key, **message** = human-readable text, **url** only on first event.
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

## Website analysis granular phases (Thinking UX)

For `website_analysis` jobs, **progress-update** events include a **phase** field with sub-steps. In addition, the **scrape-phase** event streams granular scraping steps so the UI can show a “thoughts” log during the “Fetching page content” step.

### Scraping sub-steps (scrape-phase events)

| phase | message (example) |
|-------|-------------------|
| start | Starting website scrape |
| validate | Validating URL |
| method-puppeteer | Trying Puppeteer (dynamic content) |
| config | Getting Puppeteer config |
| browser-launch | Launching browser |
| navigate | Navigating to page |
| wait-content | Waiting for content to load |
| extract | Extracting text and structure |
| ctas | Extracting CTAs |
| fallback-playwright | Puppeteer failed, trying Playwright |
| fallback-browserless | Playwright failed, trying Browserless.io |
| fallback-cheerio | Trying Cheerio (static HTML) |
| api-request | Requesting page from Browserless.io |
| parse-html | Parsing HTML |
| fetch | Fetching page with HTTP |

### Main step phases (progress-update.phase)

| Step | Phases |
|------|--------|
| Analyzing website | Fetching page content (with scrape-phase thoughts above) → Researching business context → Analyzing customer psychology → Saving analysis & CTAs → Generating narrative summary |
| Generating audiences | Checking existing audiences → Identifying audience opportunities → Creating customer scenarios |
| Generating pitches | Calculating revenue projections → Generating conversion pitches |
| Generating images | Creating audience visuals → Saving strategies |

The **detail** field may include context like `"5 audiences"` when processing multiple items. Use **phase** for the granular "thinking" text and **currentStep** for the main step label.

## Files

- `routes/jobs.js` — GET `/:jobId/stream`, auth, stream-manager.subscribeToJob, 10 min maxAgeMs
- `services/stream-manager.js` — subscribeToJob, unsubscribeFromJob, jobs:*:events handler, publishJobEvent
- `utils/job-stream-channels.js` — getJobEventsChannel(jobId), JOB_EVENTS_PATTERN
- `jobs/job-worker.js` — publishJobStreamEvent(connection, jobId, event, data) on progress, complete, failed
