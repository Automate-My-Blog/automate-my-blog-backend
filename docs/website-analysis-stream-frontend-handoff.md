# Website analysis job stream — frontend hand-off

Streaming website analysis so the UI can show **partial results as soon as each step finishes** instead of waiting for the full pipeline. Uses the existing job stream: create a website-analysis job, then open `GET /api/v1/jobs/:jobId/stream` and listen for **progress-update** plus **analysis-result**, **audiences-result**, **pitches-result**, **scenarios-result**, and **complete**.

**Related:** [job-stream-sse.md](./job-stream-sse.md) (event schema), [frontend-job-queue-handoff.md](./frontend-job-queue-handoff.md) (job create/poll/cancel).

---

## 1. Start the job and open the stream

### 1.1 Create the job

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/jobs/website-analysis`
- **Auth:** Either:
  - `Authorization: Bearer <JWT>`, or
  - `x-session-id: <sessionId>` (anonymous/session)
- **Body (JSON):**

```json
{
  "url": "https://example.com"
}
```

**Response**

- **201 Created**

```json
{
  "jobId": "uuid"
}
```

**Errors:** `400` (missing/invalid `url`), `401` (no auth), `503` (queue unavailable).

### 1.2 Open the SSE stream

`EventSource` does not send custom headers, so auth is via **query**: `?token=<JWT>` (logged-in) or `?sessionId=<sessionId>` (anonymous).

**Request**

- **Method:** `GET`
- **URL:** `${API_BASE}/api/v1/jobs/${jobId}/stream?token=${encodeURIComponent(accessToken)}`  
  or `${API_BASE}/api/v1/jobs/${jobId}/stream?sessionId=${encodeURIComponent(sessionId)}`

**Response**

- **200 OK** — `Content-Type: text/event-stream`. Connection stays open until job completes, fails, or ~10 min timeout.

First event you get is **connected** with `{ connectionId, jobId }`. Then you receive **progress-update** and partial-result events (see below).

**Errors:** `404` (job not found or not owned by user/session), `401` (invalid/missing auth).

---

## 2. Event types and payloads (frontend contract)

All event `data` is JSON. Parse `event.data` and switch on the **event type** (e.g. `event.type` or the event name your SSE client exposes).

| Event type          | When                         | Use in UI |
|---------------------|------------------------------|-----------|
| `connected`         | Right after opening stream   | Optional: confirm connection; `data.connectionId`, `data.jobId`. |
| `progress-update`   | Progress / step changes      | Progress bar: `data.progress`, `data.currentStep`, `data.phase`, `data.estimatedTimeRemaining`. |
| `scrape-phase`      | Granular scrape steps        | Optional: “thoughts” log during “Analyzing website” (e.g. “Navigating to page”). |
| `analysis-result`   | Analysis step finished       | **Show org summary, CTAs, metadata immediately** — no need to wait for audiences. |
| `audiences-result`  | Audiences step finished      | **Show audience cards** (targetSegment, customerProblem, etc.; no pitch/image yet). |
| `pitches-result`    | Pitches step finished        | **Show pitches on each audience** (still no image). |
| `scenarios-result`  | Images step finished         | **Show full scenarios with imageUrl**; then persist happens; you can replace with `complete` if you prefer. |
| `complete`          | Full job done                | `data.result` = full result (same shape as sync API). Close stream. |
| `failed`            | Job failed or cancelled      | `data.error`, `data.errorCode`. Close stream. |
| `stream-timeout`    | ~10 min warning              | Stream will close soon; fall back to polling `GET /jobs/:jobId/status` if needed. |

---

## 3. Partial result payload shapes

### 3.1 `analysis-result`

Emitted when the “Analyzing website” step (scrape + analysis + narrative) is done. Use it to render org summary, CTAs, and metadata right away.

```ts
{
  url: string;
  scrapedAt: string;  // ISO date
  analysis: {
    businessName?: string;
    companyName?: string;
    businessType?: string;
    industryCategory?: string;
    description?: string;
    targetAudience?: string;
    brandVoice?: string;
    websiteGoals?: string;
    blogStrategy?: string;
    // ... other analysis fields
    organizationId: string;
  };
  metadata: {
    title: string;
    headings: string[];
  };
  ctas: Array<{ text: string; type?: string; href?: string; placement?: string; conversion_potential?: number; ... }>;
  ctaCount: number;
  hasSufficientCTAs: boolean;
  organizationId: string;
}
```

### 3.2 `audiences-result`

Emitted when the “Generating audiences” step is done. Scenarios have **no** `pitch` or `imageUrl` yet.

```ts
{
  scenarios: Array<{
    targetSegment: { demographics?: string; psychographics?: string; searchBehavior?: string };
    customerProblem?: string;
    businessValue?: { searchVolume?: string; conversionPotential?: string; priority?: number; ... };
    customerLanguage?: string[];
    seoKeywords?: string[];
    conversionPath?: string;
    contentIdeas?: Array<{ title?: string; searchIntent?: string; ... }>;
    // no pitch, no imageUrl
  }>;
}
```

### 3.3 `pitches-result`

Emitted when the “Generating pitches” step is done. Same as `audiences-result` but each scenario now has **pitch**; still **no imageUrl**.

```ts
{
  scenarios: Array<{
    ...same as audiences-result,
    pitch: string;
    // no imageUrl yet
  }>;
}
```

### 3.4 `scenarios-result`

Emitted when the “Generating images” step is done. Scenarios include **imageUrl**. This is the full list before the final DB persist; **complete** will then deliver the same (plus url, analysis, ctas, etc.) in `data.result`.

```ts
{
  scenarios: Array<{
    ...same as pitches-result,
    imageUrl?: string;
    projected_revenue_low?: number;
    projected_revenue_high?: number;
    projected_profit_low?: number;
    projected_profit_high?: number;
    // ...
  }>;
}
```

### 3.5 `complete`

Same as today: `data.result` is the full website-analysis result (success, url, scrapedAt, analysis, metadata, scenarios, ctas, ctaCount, hasSufficientCTAs, organizationId). Use it as the single source of truth once the job is done, or to replace any partial state you had built from the partial-result events.

---

## 4. Suggested UI flow

1. User enters URL and starts analysis.
2. `POST /api/v1/jobs/website-analysis` with `{ url }` → get `jobId`.
3. Open `EventSource(\`${API_BASE}/api/v1/jobs/${jobId}/stream?token=...\`)` (or `?sessionId=...`).
4. On **progress-update**: update progress bar / step label / phase text.
5. On **analysis-result**: show org summary, CTAs, metadata (e.g. summary card, CTA list). User sees value before audiences are ready.
6. On **audiences-result**: show audience cards (segment, problem, no pitch/image yet — e.g. placeholders for pitch and image).
7. On **pitches-result**: update the same cards with pitch text (or replace scenarios with this list).
8. On **scenarios-result**: update cards with imageUrl (and any revenue/profit if you display them).
9. On **complete**: set final state from `data.result`, close EventSource, show “Done” (or replace partial state with `data.result`).
10. On **failed**: close EventSource, show `data.error` (and optionally `data.errorCode`).

You can ignore partial-result events and only handle **complete** (same behavior as before, just over SSE); the partial events are for **incremental UI**.

---

## 5. Example: listening for partial results

```js
const jobId = response.jobId; // from POST /jobs/website-analysis
const url = `${API_BASE}/api/v1/jobs/${jobId}/stream?token=${encodeURIComponent(accessToken)}`;
const es = new EventSource(url);

let analysis = null;
let scenarios = [];

es.addEventListener('connected', (e) => {
  const data = JSON.parse(e.data);
  console.log('Stream connected', data.jobId);
});

es.addEventListener('progress-update', (e) => {
  const data = JSON.parse(e.data);
  setProgress(data.progress);
  setCurrentStep(data.currentStep);
  setPhase(data.phase);
});

es.addEventListener('analysis-result', (e) => {
  const data = JSON.parse(e.data);
  analysis = data;
  setOrgSummary(data.analysis);
  setCTAs(data.ctas);
  setMetadata(data.metadata);
});

es.addEventListener('audiences-result', (e) => {
  const data = JSON.parse(e.data);
  scenarios = data.scenarios;
  setAudienceCards(scenarios); // no pitch/image yet
});

es.addEventListener('pitches-result', (e) => {
  const data = JSON.parse(e.data);
  scenarios = data.scenarios;
  setAudienceCards(scenarios); // now with pitch
});

es.addEventListener('scenarios-result', (e) => {
  const data = JSON.parse(e.data);
  scenarios = data.scenarios;
  setAudienceCards(scenarios); // now with imageUrl
});

es.addEventListener('complete', (e) => {
  const data = JSON.parse(e.data);
  setFinalResult(data.result);
  es.close();
});

es.addEventListener('failed', (e) => {
  const data = JSON.parse(e.data);
  setError(data.error);
  es.close();
});
```

---

## 6. Cleanup

- Call `eventSource.close()` when you receive **complete**, **failed**, or on user cancel / navigate away.
- The server cleans up on client disconnect; no explicit unsubscribe.

---

## 7. Reference

- Job stream events (full list): [job-stream-sse.md](./job-stream-sse.md)
- Job create / status / retry / cancel: [frontend-job-queue-handoff.md](./frontend-job-queue-handoff.md)
- Backend: `routes/jobs.js` (GET `/:jobId/stream`), `jobs/job-worker.js` (publishes events), `services/website-analysis-pipeline.js` (onPartialResult)
