# Issue #303 — Narration streaming endpoints: frontend handoff

**GitHub:** [automate-my-blog-frontend#303](https://github.com/Automate-My-Blog/automate-my-blog-frontend/issues/303)  
**Status:** Backend implemented. Use this doc to wire the frontend so the typing cursor shows real narration text.

---

## 1. Backend status (issue #303)

All three SSE endpoints are implemented in this repo and mounted under `/api/v1/analysis`:

| Endpoint | Purpose |
|----------|--------|
| `GET /api/v1/analysis/narration/audience` | Narration for audience step (e.g. “We found 3 audiences…”) |
| `GET /api/v1/analysis/narration/topic` | Narration for topic step after audience is selected |
| `GET /api/v1/analysis/narration/content` | Narration for content step (future use) |

- **Base URL:** Same as rest of API, e.g. `${API_BASE}/api/v1/analysis/narration/...`.
- **Response:** `Content-Type: text/event-stream`. Stream stays open until the full narration is sent, then the server closes the connection.
- **Auth:** Token or session. Supports both logged-in users (JWT) and anonymous/session users.

If the frontend was previously getting **404** on these URLs, ensure:

1. The request goes to the correct base (e.g. `https://your-api.vercel.app/api/v1/analysis/narration/audience` or your staging URL).
2. The backend branch that includes these routes is deployed (they live in `routes/analysis.js`).

---

## 2. Event names and payloads (use these exactly)

The backend sends these event types. **Frontend must listen for these names** (they differ from an older doc that used `*-narration-chunk` / `*-narration-complete` for audience and topic).

| Endpoint | Chunk event | Complete event | Optional |
|----------|-------------|----------------|----------|
| `/narration/audience` | `audience-chunk` | `audience-complete` | `connected` (once, with `{ organizationId }`) |
| `/narration/topic` | `topic-chunk` | `topic-complete` | `connected` (once, with `{ organizationId }`) |
| `/narration/content` | `content-narration-chunk` | `content-narration-complete` | — |

- **Chunk events:** Payload `{ text: string }`. Each chunk is one word (or leading space for word separation). Append `data.text` to the visible narration for a typing effect.
- **Complete events:** Payload `{ text: string }`. Audience/topic send `text: ''`; content sends full text. After the complete event, the server closes the stream.
- **connected:** Only audience and topic send this first; content does not. You can use it to know the stream is ready.

SSE format: `event: <eventType>\ndata: <JSON>\n\n`. Parse `event.data` as JSON.

---

## 3. Query parameters

| Param | Endpoint(s) | Required | Description |
|-------|-------------|----------|-------------|
| `organizationId` | All | Yes | Organization UUID. |
| `selectedAudience` | `/narration/topic` | No | Audience label for the topic narration (e.g. “Busy parents”). |
| `selectedTopic` | `/narration/content` | No | Topic for the content narration (e.g. “5 time-saving tips”). |
| `sessionId` | All (when using EventSource without JWT) | If no JWT | Session ID from your app (e.g. from `POST /api/v1/session/create` or equivalent). |
| `token` | All (EventSource with JWT) | Optional | JWT access token when you cannot send `Authorization` (e.g. EventSource). |

---

## 4. Auth (token and session)

- **Logged-in (JWT):** Prefer `fetch()` with `Authorization: Bearer <accessToken>` so the token is not in the URL.
- **EventSource:** Cannot send custom headers. Use query:
  - **Session:** `?organizationId=...&sessionId=<sessionId>`
  - **JWT:** `?organizationId=...&token=<JWT>` (backend accepts `token` for these routes and validates it).

Same behavior as other SSE routes; see [sse-stream-auth-frontend-handoff.md](./sse-stream-auth-frontend-handoff.md) for the shared contract.

---

## 5. Errors (before stream starts)

If the stream has not started, the API returns JSON:

| Status | Typical cause |
|--------|----------------|
| **400** | Missing `organizationId` (`error: 'organizationId is required'`). |
| **401** | No auth and no session (e.g. no JWT, no `sessionId` where required). |
| **404** | `Organization not found or access denied`. |
| **500** | Server/narration error (`error`, `message` in body). |

After the response has `Content-Type: text/event-stream` and the first bytes are sent, errors are not sent as JSON; the connection may just close. Handle stream `error` and connection close on the client.

---

## 6. Suggested UI flow

1. **Audience step:** Open `GET .../narration/audience?organizationId=...` (and `sessionId` or `token` if needed). On each `audience-chunk`, append `data.text` to the visible narration. On `audience-complete`, stop appending and close the stream (use a blinking cursor until complete).
2. **Topic step:** After the user selects an audience, open `GET .../narration/topic?organizationId=...&selectedAudience=...`. Handle `topic-chunk` and `topic-complete` the same way.
3. **Content step:** When implemented in the UI, open `GET .../narration/content?organizationId=...&selectedTopic=...`. Handle `content-narration-chunk` and `content-narration-complete`.

Cancel by closing the `EventSource` or aborting the `fetch()`; the server will stop sending and close the connection.

---

## 7. Example: EventSource (e.g. sessionId)

```js
const organizationId = '...'; // from analysis/flow state
const sessionId = '...';     // or omit if using fetch + Bearer
const base = 'https://your-api.vercel.app'; // or process.env.REACT_APP_API_URL
const url = `${base}/api/v1/analysis/narration/audience?organizationId=${encodeURIComponent(organizationId)}&sessionId=${encodeURIComponent(sessionId)}`;
const es = new EventSource(url);

let narration = '';

es.addEventListener('connected', (e) => {
  const data = JSON.parse(e.data);
  console.log('Stream connected', data.organizationId);
});

es.addEventListener('audience-chunk', (e) => {
  const data = JSON.parse(e.data);
  narration += data.text ?? '';
  setNarrationText(narration);
});

es.addEventListener('audience-complete', (e) => {
  es.close();
  setNarrationComplete(true);
});

es.onerror = () => {
  es.close();
  setNarrationError(true);
};
```

---

## 8. Example: fetch() with ReadableStream (JWT in header)

Use when you have a JWT and want to avoid putting it in the URL.

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
let narration = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
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
        if (eventType === 'audience-chunk') {
          narration += data.text ?? '';
          setNarrationText(narration);
        }
        if (eventType === 'audience-complete') setNarrationComplete(true);
      } catch (_) {}
    }
  }
}
```

---

## 9. Acceptance criteria (from issue #303)

- No 404 errors in the browser console for these three endpoints.
- Narration text types out with the blinking cursor (word-by-word, ~50 ms delay on backend).
- Messages are personalized with business name (backend uses org data).
- Works for both authenticated users and session users.
- Stream completes within ~10 seconds under normal conditions.

---

## 10. Reference

- **Backend:** `routes/analysis.js` — `GET /narration/audience`, `GET /narration/topic`, `GET /narration/content` (first matching content route uses `content-narration-*` events).
- **SSE helper:** `utils/streaming-helpers.js` — `writeSSE`.
- **Narration copy:** `services/openai.js` — `generateAudienceNarrative`, `generateTopicNarrative`; content uses `generateContentGenerationNarration` (first content handler).
- **Related:** [narration-stream-frontend-handoff.md](./narration-stream-frontend-handoff.md) (updated to match these event names), [sse-stream-auth-frontend-handoff.md](./sse-stream-auth-frontend-handoff.md).
