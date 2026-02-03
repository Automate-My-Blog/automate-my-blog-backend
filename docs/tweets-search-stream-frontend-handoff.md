# Tweet search stream — frontend hand-off

Streaming tweet search for a selected topic. Replaces the non-streaming `POST /api/tweets/search-for-topic`. Same pattern as **topics** (`POST /api/v1/topics/generate-stream`) and **audiences** (`POST /api/v1/audiences/generate-stream`).

## 1. Start the stream

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/tweets/search-for-topic-stream`
- **Auth:** Either:
  - `Authorization: Bearer <JWT>`, or
  - `x-session-id: <sessionId>` (for anonymous/session users)
- **Body (JSON):**

```json
{
  "topic": {
    "title": "string",
    "subheader": "string",
    "trend": "string",
    "seoBenefit": "string",
    "category": "string"
  },
  "businessInfo": {
    "businessType": "string",
    "targetAudience": "string"
  },
  "maxTweets": 3
}
```

`topic` and `businessInfo` are required. `maxTweets` is optional (default 3).

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

- **400** — Missing required body (`topic`, `businessInfo` required).
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

First event you get is **connected** with `{ connectionId }`. Then you'll get tweet search events (see below).

---

## 3. Event types and payloads (frontend contract)

All event `data` is JSON. Parse `event.data` and switch on `event.type` (or the event name your SSE client exposes).

| Event type         | When                       | Data shape |
|--------------------|----------------------------|------------|
| `connected`        | Right after opening stream | `{ connectionId }` |
| `queries-extracted`| Search queries ready       | `{ searchTermsUsed: string[] }` |
| `complete`         | All tweets found           | `{ tweets: Tweet[], searchTermsUsed: string[] }` |
| `error`            | Something failed           | `{ error: string, errorCode?: string }` |

**Tweet object:**

```ts
{
  url: string;      // https://x.com/username/status/1234567890
  author: string;   // Full Name
  handle: string;   // username
  text: string;     // Tweet text
  likes?: number;
  retweets?: number;
  verified?: boolean;
}
```

---

## 4. Suggested UI flow

1. User selects a topic and triggers "Search for tweets".
2. `POST /api/v1/tweets/search-for-topic-stream` with `topic`, `businessInfo`, optionally `maxTweets`.
3. On 200, open `EventSource(streamUrl)`.
4. On **queries-extracted**: show "Searching for: {searchTermsUsed[0]}..." or similar.
5. On **complete**: populate the tweet list with `data.tweets`, close EventSource.
6. On **error**: close EventSource, show `data.error` to the user.

You can also ignore **queries-extracted** and only handle **complete** (same as the old non-streaming endpoint, but over SSE).

---

## 5. Cleanup

- Call `eventSource.close()` when:
  - You received **complete**, or
  - You received **error**, or
  - The user navigates away / cancels.
- The server cleans up when the client disconnects; no explicit "unsubscribe" call.

---

## 6. Same pattern as topics/audiences

If you already have code for topics or audiences streaming:

- **Start:** `POST /api/v1/tweets/search-for-topic-stream` → returns `connectionId` and `streamUrl`.
- **Listen:** Same `GET /api/v1/stream/:connectionId?token=...` or `?sessionId=...` endpoint; only the event names and payloads differ.
- **Tweet search events:** `queries-extracted`, `complete`, `error`.

Reuse your existing SSE connection + auth + cleanup logic; add a handler that switches on these event types and updates tweet state.

---

## 7. Reference

- SSE stream auth (JWT vs session): [docs/sse-stream-auth-frontend-handoff.md](./sse-stream-auth-frontend-handoff.md)
- Topics stream contract: [docs/topics-stream-frontend-handoff.md](./topics-stream-frontend-handoff.md)
- Backend route: `routes/tweets.js` — `POST /search-for-topic-stream`
- Backend stream logic: `services/enhanced-blog-generation.js` — `searchForTopicStream()`
