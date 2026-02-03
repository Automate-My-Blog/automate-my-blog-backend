# SSE stream auth — frontend handoff

Streaming endpoints (topics, audiences, blog, etc.) now work for **both logged-in users and anonymous/session users**. The client opens the SSE connection using either a JWT (`?token=`) or a session ID (`?sessionId=`).

---

## 1. Starting a stream (POST)

Use the same auth as today:

- **Logged-in:** `Authorization: Bearer <JWT>` (and optionally pass the same JWT as `?token=` or in body if the endpoint uses it to build `streamUrl`).
- **Anonymous/session:** `x-session-id: <sessionId>` (session from `POST /api/v1/session/create` or your app’s session store).

Endpoints that support **session** for the POST (and return a usable `streamUrl` for anonymous):

- `POST /api/v1/topics/generate-stream` — accepts JWT or `x-session-id`; response `streamUrl` contains `?token=...` or `?sessionId=...` so it’s ready for EventSource.

- `POST /api/v1/tweets/search-for-topic-stream` — same; accepts JWT or `x-session-id`; response `streamUrl` ready for EventSource.

Others (e.g. blog) may require a logged-in user for the POST; the **SSE GET** still accepts either auth type below.

---

## 2. Opening the SSE connection (GET)

`EventSource` cannot send headers, so auth is **only via query**.

The server accepts **either**:

| Query param   | Use case              | Example |
|---------------|------------------------|--------|
| `token`       | Logged-in user (JWT)   | `?token=eyJhbG...` |
| `sessionId`   | Anonymous/session user | `?sessionId=a1b2c3d4-e5f6-7890-abcd-ef1234567890` |

**Preferred:** Use the `streamUrl` from the POST response. The backend now sets it so that:

- If the user had a JWT → `streamUrl` includes `?token=<JWT>`.
- If the user had only `x-session-id` → `streamUrl` includes `?sessionId=<sessionId>`.

So you can always do:

```js
const { connectionId, streamUrl } = await startStreamResponse.json();
const es = new EventSource(streamUrl);  // already has token= or sessionId=
```

**If you build the URL yourself:**

```js
const base = API_BASE;
const connectionId = '...'; // from POST response

// Logged-in:
const url = `${base}/api/v1/stream/${connectionId}?token=${encodeURIComponent(accessToken)}`;

// Anonymous/session:
const url = `${base}/api/v1/stream/${connectionId}?sessionId=${encodeURIComponent(sessionId)}`;

const es = new EventSource(url);
```

---

## 3. Errors

- **401 Unauthorized** — Missing or invalid `token` and missing or invalid `sessionId` (e.g. `sessionId` shorter than 10 characters). Send exactly one of `token` (valid JWT) or `sessionId` (valid session ID).

---

## 4. Summary

| Step              | Logged-in                    | Anonymous/session                    |
|-------------------|------------------------------|-------------------------------------|
| Start stream POST | `Authorization: Bearer JWT`  | `x-session-id: <sessionId>`         |
| Response          | `streamUrl` with `?token=...` | `streamUrl` with `?sessionId=...`    |
| Open EventSource  | `new EventSource(streamUrl)`  | `new EventSource(streamUrl)`        |

No frontend change is required if you already use `streamUrl` from the response; anonymous users now get a `streamUrl` that includes `sessionId` and can open the stream without logging in.

---

## 5. Reference

- Topics stream contract: [docs/topics-stream-frontend-handoff.md](./topics-stream-frontend-handoff.md)
- Tweet search stream contract: [docs/tweets-search-stream-frontend-handoff.md](./tweets-search-stream-frontend-handoff.md)
- Backend stream route: `routes/stream.js` — `GET /api/v1/stream/:connectionId`
- Backend topics stream: `routes/topics.js` — `POST /api/v1/topics/generate-stream`
- Backend tweets stream: `routes/tweets.js` — `POST /api/v1/tweets/search-for-topic-stream`
