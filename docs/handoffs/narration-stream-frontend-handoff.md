# Narration stream API — frontend handoff

Short, word-by-word **SSE streams** for the 3-step analysis flow: **audience**, **topic**, and **content** narrations. Use them to drive a typing-effect or progressive reveal in the UI.

**For issue #303 (narration streaming 404 fix):** See [issue-303-narration-streaming-frontend-handoff.md](./issue-303-narration-streaming-frontend-handoff.md) for the exact event names and examples.

**Related:** [sse-stream-auth-frontend-handoff.md](./sse-stream-auth-frontend-handoff.md) (auth for SSE), [issue-261-backend-implementation.md](./issue-261-backend-implementation.md) (backend context).

---

## 1. Overview

| Endpoint | Query params | Purpose |
|----------|--------------|--------|
| `GET /api/v1/analysis/narration/audience` | `organizationId` | Narration about audience scenarios (e.g. “We found 3 audiences…”) |
| `GET /api/v1/analysis/narration/topic` | `organizationId`, `selectedAudience?` | Narration about picking a topic for that audience |
| `GET /api/v1/analysis/narration/content` | `organizationId`, `selectedTopic?` | Narration about generating content for that topic |

- **Base URL:** Same as rest of API (e.g. `${API_BASE}/api/v1/analysis/narration/...`).
- **Response:** `Content-Type: text/event-stream`. Connection stays open until the full narration is sent, then the stream ends.
- **Auth:** Optional. Either **JWT** (e.g. `Authorization: Bearer <token>` when using `fetch`) or **session** (`sessionId` in query). If `organizationId` is omitted and there is no auth, the API returns **401**. With a valid `organizationId`, the org may be resolved for the current user or by id (e.g. for anonymous flows).

---

## 2. Auth when using EventSource

`EventSource` cannot send custom headers. Use **query** for auth:

- **Session (anonymous):** `?organizationId=...&sessionId=<sessionId>`
- **Logged-in (JWT):** Prefer `fetch()` with `Authorization: Bearer <token>` and reading the response body as a stream (see example below). If you must use `EventSource`, pass `sessionId` if the user has a session, or ensure the backend supports `?token=<JWT>` for this route and use that.

See [sse-stream-auth-frontend-handoff.md](./sse-stream-auth-frontend-handoff.md) for the shared auth contract.

---

## 3. Event types and payloads

All three endpoints use the same pattern:

- **Chunk event** — one word (or whitespace) at a time; payload `{ text: string }`.
- **Complete event** — full narration text; payload `{ text: string }`. After this, the server closes the stream.

Event names are endpoint-specific (must match backend exactly):

| Endpoint | Chunk event | Complete event |
|----------|-------------|----------------|
| `/narration/audience` | `audience-chunk` | `audience-complete` |
| `/narration/topic` | `topic-chunk` | `topic-complete` |
| `/narration/content` | `content-narration-chunk` | `content-narration-complete` |

Audience and topic also send an optional `connected` event first (payload `{ organizationId }`). Content does not.

**SSE format:** Each message is `event: <eventType>\ndata: <JSON>\n\n`. Parse `event.data` as JSON.

---

## 4. Query parameters

| Param | Endpoint(s) | Required | Description |
|-------|-------------|----------|-------------|
| `organizationId` | All | Yes | Organization UUID. |
| `selectedAudience` | `/narration/topic` | No | Audience label for the narration (e.g. “Busy parents”). Defaults to org’s target audience. |
| `selectedTopic` | `/narration/content` | No | Topic for the narration (e.g. “5 time-saving tips”). Defaults to “this topic”. |
| `sessionId` | All (for EventSource) | If no JWT | Session ID from `POST /api/v1/session/create` or your app session. |

---

## 5. Errors (before stream starts)

If the stream has not yet started, the API may return JSON:

| Status | Body | Cause |
|--------|------|--------|
| **400** | `{ success: false, error: 'organizationId is required', message: '...' }` | Missing `organizationId`. |
| **401** | `{ success: false, error: 'Authentication or session required', message: '...' }` | No JWT and no `sessionId`, and `organizationId` was not provided. |
| **404** | `{ success: false, error: 'Organization not found', message: '...' }` | Org not found or not accessible. |
| **500** | `{ success: false, error: '...', message: '...' }` | Server error (e.g. narration generation failed). |

Once the response has `Content-Type: text/event-stream` and the first bytes are sent, errors are not sent as JSON; the connection may simply close. Handle `error` and `onconnectionclose` on the client.

---

## 6. Suggested UI flow

1. **Audience step:** Open `GET .../narration/audience?organizationId=...`. On each `audience-chunk`, append `data.text` to the visible narration. On `audience-complete`, close the stream.
2. **Topic step:** After the user selects an audience, open `GET .../narration/topic?organizationId=...&selectedAudience=...`. Handle `topic-chunk` and `topic-complete` the same way.
3. **Content step:** After the user selects a topic, open `GET .../narration/content?organizationId=...&selectedTopic=...`. Handle `content-narration-chunk` and `content-narration-complete`, then close the stream.

You can cancel by closing the `EventSource` or aborting the `fetch()`; the server will stop sending and close the connection.

---

## 7. Example: EventSource (e.g. with sessionId)

```js
const organizationId = '...';
const sessionId = '...'; // or omit if using fetch + Bearer
const url = `${API_BASE}/api/v1/analysis/narration/audience?organizationId=${encodeURIComponent(organizationId)}&sessionId=${encodeURIComponent(sessionId)}`;
const es = new EventSource(url);

let narration = '';

es.addEventListener('audience-chunk', (e) => {
  const data = JSON.parse(e.data);
  narration += data.text ?? '';
  setNarrationText(narration);
});

es.addEventListener('audience-complete', (e) => {
  es.close();
});

es.onerror = () => {
  es.close();
  setNarrationError(true);
};
```

---

## 8. Example: fetch() with ReadableStream (JWT in header)

Use this when you have a JWT and want to send `Authorization: Bearer <token>`.

```js
const organizationId = '...';
const url = `${API_BASE}/api/v1/analysis/narration/audience?organizationId=${encodeURIComponent(organizationId)}`;
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${accessToken}` }
});

if (!res.ok) {
  const err = await res.json().catch(() => ({}));
  throw new Error(err.message || err.error || res.statusText);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  // Parse SSE lines: event: ... \n data: ... \n\n
  const parts = buffer.split('\n\n');
  buffer = parts.pop() ?? '';
  for (const part of parts) {
    const eventMatch = part.match(/event:\s*(.+)/);
    const dataMatch = part.match(/data:\s*(.+)/);
    const eventType = eventMatch?.[1]?.trim();
    const dataStr = dataMatch?.[1]?.trim();
    if (eventType && dataStr) {
      try {
        const data = JSON.parse(dataStr);
        if (eventType === 'audience-chunk') setNarrationText((prev) => prev + (data.text ?? ''));
        if (eventType === 'audience-complete') { /* stream done */ }
      } catch (_) {}
    }
  }
}
```

---

## 9. Cleanup

- Close the `EventSource` or abort the `fetch()` when the component unmounts or the user navigates away, and on `*-narration-complete` or error.
- The server ends the stream after sending the complete event; no explicit “close” event.

---

## 10. Reference

- **Backend:** `routes/analysis.js` — `GET /narration/audience`, `GET /narration/topic`, `GET /narration/content`.
- **SSE helper:** `utils/streaming-helpers.js` — `formatSSE`, `writeSSE`.
- **Narration copy:** `services/openai.js` — `generateAudienceNarration`, `generateTopicNarration`, `generateContentGenerationNarration`.
