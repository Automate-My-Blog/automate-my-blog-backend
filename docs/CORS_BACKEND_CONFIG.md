# CORS: Backend configuration required

When the frontend is served from a different origin than the backend (e.g. `https://www.automatemyblog.com` → `https://automate-my-blog-backend.vercel.app`), the **backend** must send CORS headers or the browser will block responses.

## Error you may see

```
Access to fetch at 'https://automate-my-blog-backend.vercel.app/api/...' from origin 'https://www.automatemyblog.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

**Preflight:** For `POST` (e.g. `/api/v1/analytics/track`, `/api/v1/analytics/track-batch`), the browser first sends an `OPTIONS` request. If the backend does not respond to `OPTIONS` with CORS headers, you get: *"Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present."* The fix is the same: backend must allow the frontend origin and respond to `OPTIONS` with those headers.

## Origins by environment

| Environment | Frontend origin | Backend (example) |
|-------------|-----------------|-------------------|
| Production  | `https://www.automatemyblog.com`, `https://automatemyblog.com` | `automate-my-blog-backend.vercel.app` |
| Staging     | `https://staging.automatemyblog.com` | `automate-my-blog-backend-env-staging-automate-my-blog.vercel.app` |
| Local dev   | `http://localhost:3000` (or your dev port) | Your backend URL |

**Staging CORS:** The staging backend must allow `https://staging.automatemyblog.com`. If it only allows production origins, requests from the staging frontend (including analytics `track` / `track-batch`) will fail with the preflight error above.

## Fix (backend only)

Configure the backend (e.g. `automate-my-blog-backend` on Vercel) to allow the frontend origin:

- **Production:** `https://www.automatemyblog.com` (and optionally `https://automatemyblog.com`)
- **Staging:** `https://staging.automatemyblog.com`
- **Response header:** `Access-Control-Allow-Origin: <allowed-origin>` (or `*` for public APIs)

### Examples

**Node/Express:** Use the `cors` middleware and allow your frontend origin(s). For staging, include the staging origin:

```js
const cors = require('cors');
const allowedOrigins = [
  'https://www.automatemyblog.com',
  'https://automatemyblog.com',
  'https://staging.automatemyblog.com',
  'http://localhost:3000'
];
app.use(cors({ origin: allowedOrigins }));
```

**Vercel (`vercel.json`):** Add headers for API routes. For multiple origins you may need dynamic CORS (e.g. serverless function that echoes `Origin` when it's in an allow-list). Single-origin example:

```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "https://www.automatemyblog.com" },
        { "key": "Access-Control-Allow-Methods", "value": "GET, POST, OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Authorization, Content-Type" }
      ]
    }
  ]
}
```

For staging, the backend must send `Access-Control-Allow-Origin: https://staging.automatemyblog.com` (or use an allow-list that includes it).

**Preflight:** If the backend receives `OPTIONS` requests, respond with `204` and the same CORS headers so the browser can complete the actual request.

---

The frontend cannot fix CORS; the server must send the `Access-Control-Allow-Origin` header (or allow the origin in its CORS config).
