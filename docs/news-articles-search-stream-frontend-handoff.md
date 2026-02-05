# News article search stream — frontend hand-off

Streaming news article search for a selected topic. Same pattern as **tweets** (`POST /api/v1/tweets/search-for-topic-stream`), **YouTube** (`POST /api/v1/youtube-videos/search-for-topic-stream`), and **topics** (`POST /api/v1/topics/generate-stream`).

## 1. Start the stream

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/news-articles/search-for-topic-stream`
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
  "maxArticles": 5
}
```

`topic` and `businessInfo` are required. `maxArticles` is optional (default 5).

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

First event you get is **connected** with `{ connectionId }`. Then you'll get news article search events (see below).

---

## 3. Event types and payloads (frontend contract)

All event `data` is JSON. Parse `event.data` and switch on `event.type` (or the event name your SSE client exposes).

| Event type         | When                       | Data shape |
|--------------------|----------------------------|------------|
| `connected`        | Right after opening stream | `{ connectionId }` |
| `queries-extracted`| Search queries ready       | `{ searchTermsUsed: string[] }` |
| `complete`         | All articles found         | `{ articles: Article[], searchTermsUsed: string[] }` |
| `error`            | Something failed           | `{ error: string, errorCode?: string }` |

**Article object:**

```ts
{
  url: string;           // Direct URL to the article
  title: string;         // Headline or title
  description?: string;  // Description/snippet (truncated to 300 chars)
  sourceName: string;    // Publisher name (e.g. "BBC News", "TechCrunch")
  sourceId?: string;     // Source identifier
  author?: string;       // Article author
  publishedAt: string;   // ISO 8601 date (e.g. 2024-01-15T12:00:00Z)
  urlToImage?: string;   // Image URL for the article
  content?: string;      // Truncated content (first 200 chars)
}
```

---

## 4. Suggested UI flow

1. User selects a topic and triggers "Search for news articles".
2. `POST /api/v1/news-articles/search-for-topic-stream` with `topic`, `businessInfo`, optionally `maxArticles`.
3. On 200, open `EventSource(streamUrl)`.
4. On **queries-extracted**: show "Searching for: {searchTermsUsed[0]}..." or similar.
5. On **complete**: populate the article list with `data.articles`, close EventSource.
6. On **error**: close EventSource, show `data.error` to the user.

You can also ignore **queries-extracted** and only handle **complete** (same as tweet/YouTube search, but over SSE).

---

## 5. Cleanup

- Call `eventSource.close()` when:
  - You received **complete**, or
  - You received **error**, or
  - The user navigates away / cancels.
- The server cleans up when the client disconnects; no explicit "unsubscribe" call.

---

## 6. Same pattern as tweets/YouTube/topics

If you already have code for tweet or YouTube search streaming:

- **Start:** `POST /api/v1/news-articles/search-for-topic-stream` → returns `connectionId` and `streamUrl`.
- **Listen:** Same `GET /api/v1/stream/:connectionId?token=...` or `?sessionId=...` endpoint; only the event names and payloads differ.
- **News article search events:** `queries-extracted`, `complete`, `error`.

Reuse your existing SSE connection + auth + cleanup logic; add a handler that switches on these event types and updates article state.

---

## 7. Reference

- SSE stream auth (JWT vs session): [docs/sse-stream-auth-frontend-handoff.md](./sse-stream-auth-frontend-handoff.md)
- Tweet search stream (similar): [docs/tweets-search-stream-frontend-handoff.md](./tweets-search-stream-frontend-handoff.md)
- YouTube video search (similar): [docs/youtube-videos-search-stream-frontend-handoff.md](./youtube-videos-search-stream-frontend-handoff.md)
- Backend route: `routes/news-articles.js` — `POST /search-for-topic-stream`
- Backend stream logic: `services/enhanced-blog-generation.js` — `searchForTopicStreamNews()`
- News search service: `services/news-article-search.js`

---

## 8. Backend configuration

News article search requires `NEWS_API_KEY` in the environment. If not set, the service returns an empty array and the stream completes with `articles: []`. Frontend should handle empty results gracefully.

To enable: sign up at [newsapi.org](https://newsapi.org), get an API key (free developer tier available). Add to `.env`:

```
NEWS_API_KEY=your_news_api_key_here
```

**Note:** The free NewsAPI.org developer tier only works from localhost. For production, a paid plan is required.
