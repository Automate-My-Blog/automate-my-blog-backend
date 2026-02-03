# Content generation job stream — frontend hand-off

Streaming blog generation so the UI can show **partial results as each stage finishes** instead of waiting for the full pipeline. Create a content-generation job, then open `GET /api/v1/jobs/:jobId/stream` and listen for **progress-update**, **context-result**, **blog-result**, **visuals-result**, **seo-result**, and **complete**.

**Related:** [job-stream-sse.md](./job-stream-sse.md) (event schema), [frontend-job-queue-handoff.md](./frontend-job-queue-handoff.md) (job create/poll/cancel).

**Backward compatible:** Existing behavior (progress-update then **complete**) is unchanged. New events (**context-result**, **blog-result**, **visuals-result**, **seo-result**) are additive; ignore them if you only consume **complete**.

**Auth:** Content generation requires **JWT** (logged-in user). No session-only flow.

---

## 1. Start the job and open the stream

### 1.1 Create the job

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/jobs/content-generation`
- **Auth:** `Authorization: Bearer <JWT>` (required)
- **Body (JSON):** Same as `POST /api/v1/enhanced-blog-generation/generate`:

```json
{
  "topic": { "title": "...", "subheader": "...", ... },
  "businessInfo": { "businessType": "...", "targetAudience": "...", "userId": "...", ... },
  "organizationId": "uuid",
  "additionalInstructions": "...",
  "options": { "includeVisuals": true, "autoSave": true, "status": "draft" }
}
```

**Response**

- **201 Created**

```json
{
  "jobId": "uuid"
}
```

**Errors:** `400` (missing/invalid fields), `401` (no JWT), `503` (queue unavailable).

### 1.2 Open the SSE stream

Auth is via **query**: `?token=<JWT>` (EventSource cannot send custom headers).

**Request**

- **Method:** `GET`
- **URL:** `${API_BASE}/api/v1/jobs/${jobId}/stream?token=${encodeURIComponent(accessToken)}`

**Response**

- **200 OK** — `Content-Type: text/event-stream`. Connection stays open until job completes, fails, or ~10 min timeout.

First event is **connected** with `{ connectionId, jobId }`. Then **progress-update** and partial-result events (see below).

**Errors:** `404` (job not found or not owned by user), `401` (invalid/missing auth).

---

## 2. Event types and payloads (frontend contract)

All event `data` is JSON. Parse `event.data` and switch on the **event type**.

| Event type        | When                     | Use in UI |
|-------------------|--------------------------|-----------|
| `connected`       | Right after opening      | Optional: confirm connection. |
| `progress-update`  | Progress / step          | Progress bar: `data.progress`, `data.currentStep`, `data.estimatedTimeRemaining`. |
| `context-result`   | Organization context loaded | Optional: show “Context loaded”, `data.completenessScore`. |
| `blog-result`      | Blog content ready       | **Show post body immediately** (title, content, metaDescription, tags, seoKeywords, etc.). User can read while visuals/SEO run. |
| `visuals-result`   | Visual suggestions ready | Optional: show `data.visualContentSuggestions` (image suggestions). |
| `seo-result`       | SEO analysis ready       | Optional: show `data.seoAnalysis` (score, topStrengths, topImprovements). |
| `complete`         | Full job done            | `data.result` = full result (same shape as sync generate API). Close stream. |
| `failed`           | Job failed or cancelled  | `data.error`, `data.errorCode`. Close stream. |
| `stream-timeout`   | ~10 min warning          | Stream closing soon; fall back to polling `GET /jobs/:jobId/status` if needed. |

---

## 3. Partial result payload shapes

### 3.1 `context-result`

Emitted after organization context is loaded (before blog generation).

```ts
{
  organizationId: string;
  completenessScore: number;
  availability: {
    has_blog_content?: boolean;
    has_cta_data?: boolean;
    has_internal_links?: boolean;
    completeness_score?: number;
  };
}
```

### 3.2 `blog-result`

Emitted when the main blog post content is ready (before visual suggestions and SEO analysis). Use it to **render the post body** so the user can read while the rest runs.

```ts
{
  title: string;
  content: string;        // Markdown
  metaDescription?: string;
  tags?: string[];
  seoKeywords?: string[];
  estimatedReadTime?: string;
  internalLinks?: Array<{ anchorText: string; suggestedUrl: string; context?: string }>;
  ctaSuggestions?: Array<{ text: string; placement: string; type: string; context?: string }>;
  seoOptimizationScore?: string | number;
  organizationContext?: { ... };
  generationMetadata?: { duration?: number; tokensUsed?: number };
  // ... other fields from generateEnhancedBlogPost
}
```

### 3.3 `visuals-result`

Emitted when visual content suggestions are ready (if `includeVisuals !== false`).

```ts
{
  visualContentSuggestions: Array<{
    type: string;
    description?: string;
    placement?: string;
    prompt?: string;
    // ...
  }>;
}
```

### 3.4 `seo-result`

Emitted when SEO analysis is complete (if not skipped).

```ts
{
  seoAnalysis: {
    overallScore?: number;
    topStrengths?: string[];
    topImprovements?: string[];
    // ...
  };
}
```

### 3.5 `complete`

Same as today: `data.result` is the full content-generation result (blog + visuals + SEO + metadata + savedPost + imageGeneration, etc.). Use it as the single source of truth once the job is done.

---

## 4. Suggested UI flow

1. User starts blog generation (topic, businessInfo, organizationId, etc.).
2. `POST /api/v1/jobs/content-generation` with body + JWT → get `jobId`.
3. Open `EventSource(\`${API_BASE}/api/v1/jobs/${jobId}/stream?token=...\`)`.
4. On **progress-update**: update progress bar / “Writing...” step.
5. On **context-result**: optional — show “Context loaded” or completeness indicator.
6. On **blog-result**: **show the post** (title, content, metaDescription, tags, etc.) so the user can read while visuals/SEO run.
7. On **visuals-result**: optional — show image suggestions or “Visuals ready”.
8. On **seo-result**: optional — show SEO score and improvements.
9. On **complete**: set final state from `data.result` (includes savedPost, metadata, imageGeneration), close EventSource, show “Done”.
10. On **failed**: close EventSource, show `data.error`.

**Minimal (backward compatible):** Only handle **progress-update** and **complete**; ignore **context-result**, **blog-result**, **visuals-result**, **seo-result** — same as before.

---

## 5. Example: listening for partial results

```js
const jobId = response.jobId; // from POST /jobs/content-generation
const url = `${API_BASE}/api/v1/jobs/${jobId}/stream?token=${encodeURIComponent(accessToken)}`;
const es = new EventSource(url);

let blogContent = null;

es.addEventListener('connected', (e) => {
  const data = JSON.parse(e.data);
  console.log('Stream connected', data.jobId);
});

es.addEventListener('progress-update', (e) => {
  const data = JSON.parse(e.data);
  setProgress(data.progress);
  setCurrentStep(data.currentStep);
});

es.addEventListener('context-result', (e) => {
  const data = JSON.parse(e.data);
  setContextLoaded(data.completenessScore);
});

es.addEventListener('blog-result', (e) => {
  const data = JSON.parse(e.data);
  blogContent = data;
  setPostPreview(data.title, data.content, data.metaDescription); // show post immediately
});

es.addEventListener('visuals-result', (e) => {
  const data = JSON.parse(e.data);
  setVisualSuggestions(data.visualContentSuggestions);
});

es.addEventListener('seo-result', (e) => {
  const data = JSON.parse(e.data);
  setSeoScore(data.seoAnalysis?.overallScore);
  setSeoImprovements(data.seoAnalysis?.topImprovements);
});

es.addEventListener('complete', (e) => {
  const data = JSON.parse(e.data);
  setFinalResult(data.result); // includes savedPost, metadata, imageGeneration
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
- The server cleans up on client disconnect.

---

## 7. Reference

- Job stream events (full list): [job-stream-sse.md](./job-stream-sse.md)
- Job create / status / retry / cancel: [frontend-job-queue-handoff.md](./frontend-job-queue-handoff.md)
- Backend: `routes/jobs.js` (GET `/:jobId/stream`), `jobs/job-worker.js` (processContentGeneration), `services/enhanced-blog-generation.js` (generateCompleteEnhancedBlog, onPartialResult)
