# YouTube video search stream — frontend hand-off

Streaming YouTube video search for a selected topic. Same pattern as **tweets** (`POST /api/v1/tweets/search-for-topic-stream`), **topics** (`POST /api/v1/topics/generate-stream`), and **audiences** (`POST /api/v1/audiences/generate-stream`).

## 1. Start the stream

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/youtube-videos/search-for-topic-stream`
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
  "maxVideos": 5
}
```

`topic` and `businessInfo` are required. `maxVideos` is optional (default 5).

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

First event you get is **connected** with `{ connectionId }`. Then you'll get YouTube video search events (see below).

---

## 3. Event types and payloads (frontend contract)

All event `data` is JSON. Parse `event.data` and switch on `event.type` (or the event name your SSE client exposes).

| Event type         | When                       | Data shape |
|--------------------|----------------------------|------------|
| `connected`        | Right after opening stream | `{ connectionId }` |
| `queries-extracted`| Search queries ready       | `{ searchTermsUsed: string[] }` |
| `complete`         | All videos found           | `{ videos: Video[], searchTermsUsed: string[] }` |
| `error`            | Something failed           | `{ error: string, errorCode?: string }` |

**Video object:**

```ts
{
  url: string;           // https://www.youtube.com/watch?v=abc123
  videoId: string;       // YouTube video ID (e.g. abc123)
  title: string;         // Video title
  description?: string;  // Truncated description (first 200 chars)
  channelTitle: string;  // Channel name
  channelId: string;     // YouTube channel ID
  publishedAt: string;   // ISO 8601 date (e.g. 2024-01-15T00:00:00Z)
  thumbnailUrl: string;  // Thumbnail image URL (medium size)
  viewCount: number;     // View count
  likeCount: number;     // Like count
  duration?: string;     // Human-readable duration (e.g. "5m 30s")
}
```

---

## 4. Suggested UI flow

1. User selects a topic and triggers "Search for YouTube videos".
2. `POST /api/v1/youtube-videos/search-for-topic-stream` with `topic`, `businessInfo`, optionally `maxVideos`.
3. On 200, open `EventSource(streamUrl)`.
4. On **queries-extracted**: show "Searching for: {searchTermsUsed[0]}..." or similar.
5. On **complete**: populate the video list with `data.videos`, close EventSource.
6. On **error**: close EventSource, show `data.error` to the user.

You can also ignore **queries-extracted** and only handle **complete** (same as tweet search, but over SSE).

---

## 5. Cleanup

- Call `eventSource.close()` when:
  - You received **complete**, or
  - You received **error**, or
  - The user navigates away / cancels.
- The server cleans up when the client disconnects; no explicit "unsubscribe" call.

---

## 6. Same pattern as tweets/topics/audiences

If you already have code for tweet search or topic streaming:

- **Start:** `POST /api/v1/youtube-videos/search-for-topic-stream` → returns `connectionId` and `streamUrl`.
- **Listen:** Same `GET /api/v1/stream/:connectionId?token=...` or `?sessionId=...` endpoint; only the event names and payloads differ.
- **YouTube video search events:** `queries-extracted`, `complete`, `error`.

Reuse your existing SSE connection + auth + cleanup logic; add a handler that switches on these event types and updates video state.

---

## 7. Reference

- SSE stream auth (JWT vs session): [docs/sse-stream-auth-frontend-handoff.md](./sse-stream-auth-frontend-handoff.md)
- Tweet search stream (similar): [docs/tweets-search-stream-frontend-handoff.md](./tweets-search-stream-frontend-handoff.md)
- Topics stream contract: [docs/topics-stream-frontend-handoff.md](./topics-stream-frontend-handoff.md)
- Backend route: `routes/youtube-videos.js` — `POST /search-for-topic-stream`
- Backend stream logic: `services/enhanced-blog-generation.js` — `searchForTopicStreamYouTube()`
- YouTube search service: `services/youtube-video-search.js`

---

## 8. Backend configuration

YouTube video search requires `YOUTUBE_API_KEY` in the environment. If not set, the service returns an empty array and the stream completes with `videos: []`. Frontend should handle empty results gracefully.

To enable: create a Google Cloud project, enable **YouTube Data API v3**, and create an API key. Add to `.env`:

```
YOUTUBE_API_KEY=your_youtube_api_key_here
```
