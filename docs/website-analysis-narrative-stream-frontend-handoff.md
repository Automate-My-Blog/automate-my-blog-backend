# Website analysis narrative stream — frontend handoff

Narrative-driven streaming UX for website analysis (Issue #157). A **separate** SSE stream that delivers conversational "thinking" observations and analysis text for a typing-effect experience. Use alongside the main job stream (`GET /jobs/:jobId/stream`) for progress and audiences.

**Related:** [job-stream-sse.md](./job-stream-sse.md), [website-analysis-stream-frontend-handoff.md](./website-analysis-stream-frontend-handoff.md), [frontend-job-queue-handoff.md](./frontend-job-queue-handoff.md).

**Auth:** Same as job stream — `?token=<JWT>` or `?sessionId=<sessionId>` (EventSource cannot send custom headers).

---

## 1. Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/jobs/:jobId/narrative-stream?token=...` | `?token=` or `?sessionId=` | Open SSE stream for narrative events. Website-analysis jobs only. |

- **404** if job not found, not owned, or not `website_analysis`.
- **503** if Redis unavailable.

---

## 2. Event types and payloads

All event `data` is JSON. Parse `event.data` and switch on the **event type**.

| Event type         | When                          | Use in UI |
|--------------------|-------------------------------|-----------|
| `connected`        | Right after opening           | Confirm connection; `data.jobId`. |
| `analysis-status-update` | Analysis status / scraping observation | Append to Moment 1 text; show typing cursor. |
| `transition`       | Move to analysis phase        | Fade scraping, show divider, prepare for Moment 2. |
| `analysis-chunk`   | Word/phrase of analysis       | Append to Moment 2 text; typing effect. |
| `narrative-complete` | Full analysis narrative done | Transition to Moment 3 (audiences from main stream). |
| `complete`         | Job succeeded or failed       | Close stream. |

### Payload shapes

**analysis-status-update**
```ts
{ content: string; progress?: number }
```

**transition**
```ts
{ content: string }  // e.g. "\n\n" for visual separator
```

**analysis-chunk**
```ts
{ content: string }  // Word or whitespace
```

**narrative-complete**
```ts
{ content: string }  // Empty
```

**complete**
```ts
{}
```

---

## 3. Three moments flow

1. **Moment 1 — Analysis status:** Receive `analysis-status-update` events. Append to a single "thinking" block with typing cursor.
2. **Moment 2 — Analysis narrative:** On `transition`, switch to analysis view. Append `analysis-chunk` events word-by-word.
3. **Moment 3 — Audiences:** On `narrative-complete`, transition to audience cards. Audiences come from the **main stream** (`GET /jobs/:jobId/stream`) — `audience-complete`, `audiences-result`, etc.

---

## 4. Reconnection and replay

On connect, the server first replays any stored `narrative_stream` events (from DB), then subscribes to Redis for live updates. Clients that reconnect mid-job will receive the full history before new events.

---

## 5. Example: useNarrativeStream

```js
const jobId = response.jobId; // from POST /jobs/website-analysis
const url = `${API_BASE}/api/v1/jobs/${jobId}/narrative-stream?token=${encodeURIComponent(accessToken)}`;
const es = new EventSource(url);

let scrapingNarrative = '';
let analysisNarrative = '';
let currentMoment = 'scraping'; // 'scraping' | 'transition' | 'analysis' | 'audiences'

es.addEventListener('connected', (e) => {
  const data = JSON.parse(e.data);
  setJobId(data.jobId);
});

es.addEventListener('analysis-status-update', (e) => {
  const data = JSON.parse(e.data);
  setScrapingNarrative((prev) => prev + (data.content || '') + ' ');
  setCurrentMoment('scraping');
});

es.addEventListener('transition', () => {
  setCurrentMoment('transition');
  setTimeout(() => setCurrentMoment('analysis'), 500);
});

es.addEventListener('analysis-chunk', (e) => {
  const data = JSON.parse(e.data);
  setAnalysisNarrative((prev) => prev + (data.content || ''));
  setCurrentMoment('analysis');
});

es.addEventListener('narrative-complete', () => {
  setCurrentMoment('audiences');
});

es.addEventListener('complete', () => {
  es.close();
});

es.addEventListener('error', () => {
  es.close();
  // Fallback: poll GET /jobs/:jobId/status
});
```

---

## 6. Graceful fallback

If `GET /jobs/:jobId/narrative-stream` returns **404** (e.g. job type is not `website_analysis`, or endpoint not yet deployed), fall back to the main stream only. The main stream still delivers `progress-update`, `analysis-result`, `audiences-result`, etc.; only the narrative typing effect is omitted.

---

## 7. Reference

- Backend: `routes/jobs.js` (GET `/:jobId/narrative-stream`), `jobs/job-worker.js` (streamNarrative), `services/website-analysis-pipeline.js` (onStreamNarrative)
- Database: `jobs.narrative_stream` JSONB (Migration 033)
- Redis channel: `jobs:{jobId}:narrative`
