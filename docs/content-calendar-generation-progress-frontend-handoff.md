# Content Calendar Generation — Progress & Streaming (Frontend Handoff)

Handoff for showing **granular progress** when a 30-day content calendar is being generated. Use this when the frontend has a **job ID** for a `content_calendar` job and wants to show step-by-step progress (and optional “Strategy X of Y”) instead of a generic spinner.

**Related:** [Content Calendar Frontend Handoff (pasteable)](./content-calendar-frontend-handoff-pasteable.md) (endpoints, polling, testbed), [Job stream SSE](./job-stream-sse.md) (general event schema).

---

## 1. When you have a job ID

Content calendar jobs are created by the backend when a user subscribes (Stripe webhook). Today the frontend usually **does not** receive the `jobId` in that flow; it polls `GET /api/v1/strategies/content-calendar` or `GET /api/v1/audiences/:id` until `contentIdeas` is populated.

**Use this handoff when:**

- The backend starts returning a **jobId** for “calendar generating” (e.g. from a new status endpoint or from a “Regenerate calendar” action that returns `{ jobId }`), or
- You already have a jobId from some other flow (e.g. manual trigger or future API).

**If you don’t have a jobId:** Keep using polling as in the [pasteable handoff](./content-calendar-frontend-handoff-pasteable.md) (§ Polling). The backend’s granular progress runs either way; the frontend only sees it if it opens the job stream.

---

## 2. Open the job stream

**Endpoint:** `GET /api/v1/jobs/:jobId/stream`

**Auth:** Same as other job APIs. Send the JWT via query for EventSource (no custom headers):

```
GET /api/v1/jobs/{jobId}/stream?token={accessToken}
```

Or with `Authorization: Bearer {accessToken}` if your client supports headers.

**First event:** `connected` with `{ connectionId, jobId }`.  
Then you receive **progress-update** events (and finally **complete** or **failed**).

---

## 3. progress-update events (content_calendar)

Each **progress-update** event has a `data` object you can use for a progress bar and step label.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `progress` | number | 0–100. Use for progress bar width. |
| `currentStep` | string | Human-readable step, e.g. `"Strategy 2 of 3: Generating 30-day ideas with AI..."`. |
| `estimatedTimeRemaining` | number \| null | Seconds left (or `null` when done). |
| `phase` | string | Machine-readable phase: `audience` \| `organization` \| `keywords` \| `generating` \| `saving`. |
| `strategyIndex` | number | 0-based index of current strategy (when multiple). |
| `strategyTotal` | number | Total strategies in this job. |
| `strategyId` | string \| null | Current audience/strategy ID (optional, for deep links or debugging). |

### Phases (per strategy)

| phase | Typical `currentStep` (single strategy) |
|-------|----------------------------------------|
| audience | Loading audience... |
| organization | Loading organization context... |
| keywords | Loading SEO keywords... |
| generating | Generating 30-day ideas with AI... |
| saving | Saving calendar... |

For **multiple strategies**, `currentStep` is prefixed with `"Strategy X of Y: "` (e.g. `"Strategy 2 of 3: Generating 30-day ideas with AI..."`). Progress goes from 5% (start) through 95% (last phase of last strategy), then 100% with `currentStep: "Complete"` before the **complete** event.

---

## 4. Other events

| Event | When | Use |
|-------|------|-----|
| **complete** | Job finished successfully | `data.result` has `strategyCount`, `succeeded`, `failed`, `results`. Hide progress UI and refresh calendar data (e.g. refetch content-calendar or audiences). |
| **failed** | Job failed or cancelled | `data.error`, `data.errorCode`. Show error and optionally offer retry. |

---

## 5. Example: progress UI

```ts
// Open stream (e.g. EventSource or fetch with ReadableStream)
const url = `${API_BASE}/api/v1/jobs/${jobId}/stream?token=${accessToken}`;
const es = new EventSource(url);

es.addEventListener('connected', (e) => {
  const { jobId } = JSON.parse(e.data);
  setJobId(jobId);
});

es.addEventListener('progress-update', (e) => {
  const d = JSON.parse(e.data);
  setProgress(d.progress);           // 0–100
  setStepLabel(d.currentStep);       // e.g. "Strategy 2 of 3: Generating 30-day ideas with AI..."
  setEta(d.estimatedTimeRemaining);   // seconds or null
  // Optional: use d.phase for icons, d.strategyIndex/d.strategyTotal for "Strategy X of Y" badge
});

es.addEventListener('complete', (e) => {
  const { result } = JSON.parse(e.data);
  es.close();
  setProgress(100);
  setStepLabel('Complete');
  // Refetch calendar data
  refetchContentCalendar();
});

es.addEventListener('failed', (e) => {
  const { error, errorCode } = JSON.parse(e.data);
  es.close();
  setError(error);
});
```

---

## 6. Example: minimal progress bar + label

- **Progress bar:** Use `data.progress` (0–100) for width/percentage.
- **Label:** Use `data.currentStep` as-is (it already includes “Strategy X of Y” when applicable).
- **ETA (optional):** Show “About Xs remaining” when `data.estimatedTimeRemaining` is a number.

No need to parse `phase` or `strategyIndex` unless you want extra UI (e.g. phase icons or a separate “Strategy 2 of 3” badge).

---

## 7. Polling fallback

If you open the stream but it closes (e.g. network or serverless timeout), fall back to polling:

- **Status:** `GET /api/v1/jobs/:jobId/status`  
  Response includes `progress`, `currentStep`, `estimatedTimeRemaining` (same semantics as progress-update).
- When `status === 'succeeded'`, refetch calendar. When `status === 'failed'`, show `error`.

---

## 8. Checklist

- [ ] Use `GET /api/v1/jobs/:jobId/stream?token=...` when you have a content_calendar `jobId`.
- [ ] On **progress-update**, set progress bar from `data.progress` and label from `data.currentStep`.
- [ ] On **complete**, close the stream and refetch calendar (e.g. `GET /api/v1/strategies/content-calendar`).
- [ ] On **failed**, show `data.error` and optionally offer retry (`POST /api/v1/jobs/:jobId/retry`).
- [ ] Optional: show ETA when `data.estimatedTimeRemaining` is a number.
- [ ] Optional: use `data.phase` or `data.strategyIndex` / `data.strategyTotal` for richer UI.
- [ ] If stream closes before complete/failed, poll `GET /api/v1/jobs/:jobId/status` until done.
