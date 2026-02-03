# Topics stream — frontend hand-off

Streaming topic generation so the UI can show topics (and images) as they’re ready instead of waiting for the full response. Same pattern as **audiences** (`POST /api/v1/audiences/generate-stream`) and **blog** (`POST /api/v1/blog/generate-stream`).

## 1. Start the stream

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/topics/generate-stream`
- **Auth:** Either:
  - `Authorization: Bearer <JWT>`, or
  - `x-session-id: <sessionId>` (for anonymous/session users)
- **Body (JSON):**

```json
{
  "businessType": "string",
  "targetAudience": "string",
  "contentFocus": "string"
}
```

All three fields are required. Same semantics as the existing non-streaming `POST /api/trending-topics` (e.g. from website analysis).

**Response**

- **200 OK**

```json
{
  "connectionId": "uuid",
  "streamUrl": "https://api.example.com/api/v1/stream/{connectionId}?token=... OR ?sessionId=..."
}
```

The server sets `streamUrl` so it is ready for EventSource:
- **Logged-in:** `streamUrl` includes `?token=<JWT>`.
- **Anonymous/session:** `streamUrl` includes `?sessionId=<sessionId>`.

Use `streamUrl` as-is, or build it yourself:  
`GET ${API_BASE}/api/v1/stream/${connectionId}?token=${accessToken}` (logged-in) or `?sessionId=${sessionId}` (anonymous).

**Errors**

- **400** — Missing or invalid body (`businessType`, `targetAudience`, `contentFocus` required).
- **401** — No auth; send JWT or `x-session-id`.
- **500** — Server error; `body.error`, `body.message`.

---

## 2. Open the SSE connection

`EventSource` does not send custom headers, so auth is via **query**. The `streamUrl` from step 1 already contains `?token=` (logged-in) or `?sessionId=` (anonymous)—use it as-is.

```js
const url = streamUrl; // from step 1 (has token= or sessionId=), or build:
// Logged-in: const url = `${API_BASE}/api/v1/stream/${connectionId}?token=${encodeURIComponent(accessToken)}`;
// Anonymous: const url = `${API_BASE}/api/v1/stream/${connectionId}?sessionId=${encodeURIComponent(sessionId)}`;
const es = new EventSource(url);
```

First event you get is **connected** with `{ connectionId }`. Then you’ll get topic events (see below).

---

## 3. Event types and payloads (frontend contract)

All event `data` is JSON. Parse `event.data` and switch on `event.type` (or the event name your SSE client exposes).

| Event type              | When                         | Data shape |
|-------------------------|------------------------------|------------|
| `connected`             | Right after opening stream   | `{ connectionId }` |
| `topic-complete`        | One topic’s JSON is ready    | `{ topic }` — topic has **no** `image` yet |
| `topic-image-start`     | DALL·E started for a topic   | `{ index, total, topic }` |
| `topic-image-complete`  | DALL·E finished for a topic  | `{ index, topic }` — topic now has `image` (URL) |
| `complete`              | All topics and images done   | `{ topics }` — full array with `image` on each |
| `error`                 | Something failed             | `{ error: string, errorCode?: string }` |

**Topic object (once available):**

```ts
{
  id: number;
  trend: string;
  title: string;
  subheader: string;
  seoBenefit: string;
  category: string;
  image?: string;   // only after topic-image-complete / complete
}
```

---

## 4. Suggested UI flow

1. User triggers “Generate topics” (e.g. from analysis).
2. `POST /api/v1/topics/generate-stream` with `businessType`, `targetAudience`, `contentFocus`.
3. On 200, open `EventSource(streamUrl)` (or the built URL with `?token=`).
4. On **topic-complete**: append the topic to the list (show title/subheader; image placeholder).
5. On **topic-image-start**: optional “Generating image for topic N…” or spinner.
6. On **topic-image-complete**: set the topic’s image URL in the list.
7. On **complete**: you have the full `topics` array; you can close the EventSource and treat as done.
8. On **error**: close the EventSource, show `data.error` to the user.

You can also ignore intermediate events and only handle **complete** (same as the old non-streaming endpoint, but over SSE).

---

## 5. Cleanup

- Call `eventSource.close()` when:
  - You received **complete**, or
  - You received **error**, or
  - The user navigates away / cancels.
- The server cleans up when the client disconnects; no explicit “unsubscribe” call.

---

## 6. Same pattern as audiences/blog

If you already have code for audiences or blog streaming:

- **Start:** `POST /api/v1/audiences/generate-stream` or `POST /api/v1/blog/generate-stream` → same idea: returns `connectionId` and optionally `streamUrl`.
- **Listen:** Same `GET /api/v1/stream/:connectionId?token=...` or `?sessionId=...` endpoint; only the event names and payloads differ.
- **Topics events:** `topic-complete`, `topic-image-start`, `topic-image-complete`, `complete`, `error` (audiences use `audience-complete`, `complete`, `error`; blog uses its own event set).

Reuse your existing SSE connection + auth + cleanup logic; add a handler that switches on these event types and updates topic state.

---

## 7. Reference

- SSE stream auth (JWT vs session): [docs/sse-stream-auth-frontend-handoff.md](./sse-stream-auth-frontend-handoff.md)
- Shared SSE docs: [docs/sse-streaming.md](./sse-streaming.md)
- Backend route: `routes/topics.js` — `POST /generate-stream`
- Backend stream logic: `services/openai.js` — `generateTrendingTopicsStream()`
