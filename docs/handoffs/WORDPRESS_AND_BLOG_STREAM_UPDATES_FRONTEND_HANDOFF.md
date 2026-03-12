# WordPress & blog stream updates — frontend handoff

Short write-up for the frontend on recent backend changes: **WordPress connection display** and **blog post generation stream auth**.

**Related:** [Third-Party Publishing](./THIRD_PARTY_PUBLISHING_FRONTEND_HANDOFF.md), [SSE stream auth](./sse-stream-auth-frontend-handoff.md), [Direct platform publishing](./direct-platform-publishing-frontend-handoff.md).

---

## 1. WordPress connection: `account` in GET /connections

### What changed

When a user connects WordPress with **username** provided, the backend now stores that username in the `account` column. **GET /api/v1/publishing-platforms/connections** therefore returns `account` for WordPress when it was set on connect.

### Frontend impact

- **GET /connections** — For WordPress, the `account` field may now be present (the WordPress username). You can show it in Settings/Integrations (e.g. "Connected as **account**" or "WordPress — **account** @ **site_url**").
- **Connect form** — Continue sending `username` when connecting WordPress. It's recommended/required for publish; without it, the first publish fails with a "missing username" error and the user must reconnect with username.

### Example response (WordPress with username)

```json
{
  "connections": [
    {
      "platform": "wordpress",
      "label": "WordPress",
      "connected": true,
      "site_url": "https://myblog.com",
      "account": "wpuser"
    }
  ]
}
```

If the user connected WordPress before this backend change, `account` may be `undefined` until they reconnect and supply a username.

---

## 2. Blog post generation stream: use `streamUrl` as-is (401 fix)

### What changed

When the user is authenticated only via **cookie** (no `Authorization` header), the backend used to return a `streamUrl` without a token. Opening that URL from a different origin (e.g. staging frontend → API) did not send cookies, so **GET /api/v1/stream/:connectionId** returned **401 Unauthorized**.

The backend now:

- Resolves the access token from the cookie when building `streamUrl`.
- Returns a `streamUrl` that already includes **connectionId** and **?token=...** when the user is cookie-authenticated.

So the stream URL is always usable for cross-origin EventSource.

### Frontend impact

- **Always use the `streamUrl` from the POST response** when opening the blog content stream. Do not strip the query string or build the URL yourself without the token.
- **Relevant endpoints** (both return `connectionId` and `streamUrl`):
  - **POST /api/v1/enhanced-blog-generation/generate-stream** — body includes `connectionId`; response includes `streamUrl` (full URL with connectionId and token when available).
  - **POST /api/v1/blog/generate-stream** — same idea; response includes `streamUrl`.

### Example usage

```js
// After POST to generate-stream (enhanced-blog or blog)
const { connectionId, streamUrl } = response.json();

// Use streamUrl as-is — it already has ?token=... when user is cookie-authenticated
const eventSource = new EventSource(streamUrl);
```

If you build the URL manually (e.g. for logged-in users with a known JWT), include the token:  
`/api/v1/stream/${connectionId}?token=${encodeURIComponent(accessToken)}`.  
Prefer using `streamUrl` from the response so cookie-auth and cross-origin work without extra logic.

---

## 3. Summary

| Area | Change | Frontend action |
|------|--------|------------------|
| WordPress GET /connections | Backend now returns `account` for WordPress when username was provided on connect. | Optionally show `account` in Settings for WordPress; keep sending `username` on connect. |
| Blog generation stream | Backend puts token in `streamUrl` when user is cookie-authenticated. | Use `streamUrl` from the POST response as-is for EventSource; do not strip query params. |

No breaking changes. Existing flows continue to work; the updates improve display (WordPress account) and fix 401 when opening the stream cross-origin with cookie auth.
