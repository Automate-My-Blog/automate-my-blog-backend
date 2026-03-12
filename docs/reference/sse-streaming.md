# SSE streaming (Phase 1)

Shared SSE infrastructure for job stream, blog/audience/bundle streaming. See [GitHub issue #95](https://github.com/Automate-My-Blog/automate-my-blog-backend/issues/95).

## Auth for SSE

`EventSource` does not support custom headers (e.g. `Authorization: Bearer …`). Auth is done via **query param**:

- **URL:** `GET /api/v1/stream?token=JWT`
- The backend validates `token` with the same JWT used for API auth (`JWT_SECRET`). Invalid or missing token returns `401 Unauthorized`.
- Frontend: when opening the stream, append the access token:  
  `new EventSource(\`${API_BASE}/api/v1/stream?token=${accessToken}\`)`

Cookie-based auth would also work with EventSource (cookies are sent by the browser), but this repo uses JWT; the query-param approach keeps a single token story for the frontend.

## CORS

The app CORS config allows the same origins as the rest of the API (production, Vercel previews, localhost). Cross-origin SSE from the frontend (e.g. Vercel preview or localhost:3000) is allowed when the request `Origin` is in the allowed list; `credentials: true` is set so cookies/credentials can be sent if you add cookie auth later.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/stream?token=JWT` | `token` query | Open SSE connection. First event: `connected` with `{ connectionId }`. Then keepalive comments and app events via Redis Pub/Sub. |
| GET | `/api/v1/stream/:connectionId?token=JWT` | `token` query | Join existing stream by connectionId (returned from POST /audiences/generate-stream, POST /blog/generate-stream, POST /topics/generate-stream, GET .../bundle/calculate?stream=true). First event: `connected` with `{ connectionId }`. |

## Connection lifecycle

- **Create:** Client GETs `/api/v1/stream?token=…`. Server sends SSE headers, creates a connection in the stream manager, sends `connected` event with `connectionId`, and starts keepalive comments.
- **Cleanup:** On client disconnect (close/error), the stream manager removes the connection and clears keepalive.
- **Sending events:** Use `streamManager.publish(connectionId, event, data)` to send an SSE event to that connection (in-process or via Redis for cross-process).

## Redis Pub/Sub

- **Channel pattern:** `stream:*` (each connection has channel `stream:{connectionId}`).
- **Payload:** JSON `{ event, data }`.
- Used so that any process (e.g. job worker or another API instance) can publish to a connection; the process that owns the connection receives via Redis and writes to the response.

## Acceptance criteria (issue #95)

- **Auth validated for stream connections** — GET `/api/v1/stream` requires `?token=JWT`; invalid/missing token returns 401.
- **Supports concurrent connections (50+ simultaneous)** — Stream manager uses a `Map` keyed by `connectionId`; no hard limit; keepalive and Redis Pub/Sub scale with connections.
- **Connections clean up on client disconnect** — `res.on('close')` and `res.on('error')` call `removeConnection(connectionId)`; keepalive timer cleared; connection removed from map.
- **Stream manager can create connections and emit events via Redis** — `createConnection()` registers a connection; `publish(connectionId, event, data)` sends in-process or via Redis channel `stream:{connectionId}`; subscriber `PSUBSCRIBE stream:*` forwards to the right connection.

## Blog content stream contract

For the blog content stream (e.g. `POST /api/v1/enhanced-blog-generation/generate-stream`), the backend sends **only post-body markdown** in `content-chunk` events (no title/meta/wrapper JSON). See [blog-content-stream-frontend-handoff.md](./blog-content-stream-frontend-handoff.md) for the full contract and frontend reference.

## Files

- `utils/streaming-helpers.js` — `formatSSE`, `writeSSE`, `sendKeepalive`
- `services/stream-manager.js` — connection map, Redis subscribe/publish, EventEmitter
- `routes/stream.js` — GET `/api/v1/stream` with `?token=` auth
