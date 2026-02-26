# Google OAuth (per-client) — Frontend Handoff

This document describes how the **frontend** integrates with the backend for **Google OAuth** (Search Console and Analytics) when credentials are **per-client** — i.e. you set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the **frontend** Vercel env and pass them when starting the OAuth flow. Related: [automate-my-blog-frontend#504](https://github.com/Automate-My-Blog/automate-my-blog-frontend/issues/504).

---

## 1. Overview

- **Credentials:** Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the **frontend** Vercel project (per client/deployment).
- **Flow:** User clicks “Connect Google” → frontend calls **POST** `/api/v1/google/oauth/authorize/:service` with those credentials in the body → backend returns `authUrl` → frontend redirects user to `authUrl` → user signs in on Google → Google redirects to the **backend** callback → backend exchanges the code and stores tokens → backend redirects user back to the frontend (e.g. settings page with `?connected=search_console` or `?connected=analytics`).
- **Secrets:** The frontend sends `client_id` and `client_secret` in the **request body** only (never in the URL). The backend does not persist them; it uses Redis temporarily for the callback.

---

## 2. Frontend env vars (Vercel)

| Variable | Required | Notes |
|----------|----------|--------|
| `GOOGLE_CLIENT_ID` | Yes | From Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID. |
| `GOOGLE_CLIENT_SECRET` | Yes | Same OAuth client. Use **Preview** / **Production** as needed. |

Backend must have `GOOGLE_REDIRECT_URI`, `REDIS_URL`, and `OAUTH_ENCRYPTION_KEY` set (see backend repo). The backend does **not** need `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` when using this flow.

---

## 3. Endpoints quick reference

Base path: `/api/v1/google`. All auth-required endpoints need **JWT**: `Authorization: Bearer <accessToken>`.

| Purpose | Method | Path | Auth | Notes |
|--------|--------|------|------|--------|
| Start OAuth (per-client) | **POST** | `/oauth/authorize/:service` | Yes | Body: `{ client_id, client_secret }`. Returns `{ authUrl }`. Use for “Connect Google” when credentials are in frontend env. |
| Start OAuth (backend creds) | GET | `/oauth/authorize/:service` | Yes | No body. Use when backend has platform credentials in env. |
| Backend config check | GET | `/oauth/config` | No | `{ clientConfigured: boolean }`. Optional; when using per-client creds you can skip this. |
| Connection status | GET | `/oauth/status/:service` | Yes | `{ connected, expires_at, scopes }`. |
| Disconnect | DELETE | `/oauth/disconnect/:service` | Yes | Revokes connection. |
| Store user’s own creds | POST | `/oauth/credentials` | Yes | Body: `{ service, client_id, client_secret }`. For self-serve; not needed when using frontend env. |

**Services:** `:service` is one of `search_console`, `analytics`. For `trends`, no OAuth is required; the backend may return `noOAuthRequired: true` and a `redirectUrl` instead of `authUrl`.

---

## 4. Connect flow (per-client)

When the user clicks “Connect Google” for Search Console or Analytics:

1. **Call POST authorize with credentials from env.**  
   This request **must** be made from the server (e.g. Next.js API route or server action) so `GOOGLE_CLIENT_SECRET` is never sent from the browser. The server reads both env vars and forwards them to the backend.

```js
// Example: run in Next.js API route or server action (server-side only)
const API_BASE = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:3001';
const service = 'search_console'; // or 'analytics'

const res = await fetch(`${API_BASE}/api/v1/google/oauth/authorize/${service}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
  }),
});

const data = await res.json();
```

2. **Handle response and redirect.**

- If **200** and `data.noOAuthRequired` (e.g. trends): redirect to `data.redirectUrl` if present.
- If **200** and `data.authUrl`: redirect the user to `data.authUrl`:
  ```js
  if (data.authUrl) {
    window.location.href = data.authUrl;
    return;
  }
  ```
- If **400**: show `data.error` (e.g. missing credentials, invalid service).
- If **503**: backend Redis not configured; show a message that OAuth is temporarily unavailable or that backend needs `REDIS_URL`.

**Important:** `client_secret` must not be exposed in client-side JavaScript. In Next.js, use env vars without `NEXT_PUBLIC_` for the secret and call the authorize endpoint from a **server action** or API route that reads `process.env.GOOGLE_CLIENT_SECRET` and forwards it in the body. If your frontend is a pure SPA, you need a small backend or serverless function that holds the secret and calls the backend POST authorize on behalf of the user.

---

## 5. After redirect (callback)

Google redirects to the **backend** (`GOOGLE_REDIRECT_URI`). The backend handles the callback and then redirects the user to the **frontend** with query params, e.g.:

- Success: `https://<frontend>/settings/google-integrations?connected=search_console` or `?connected=analytics`
- Error: `https://<frontend>/settings/google-integrations?error=<message>`

**Frontend:** On the settings/integrations page, read `searchParams.get('connected')` or `searchParams.get('error')` and show success or error state. Optionally call **GET** `/api/v1/google/oauth/status/:service` to confirm and show connection details.

---

## 6. Status and disconnect

```js
// Status (e.g. to show “Connected” and expiry)
const res = await fetch(`${API_BASE}/api/v1/google/oauth/status/search_console`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const { connected, expires_at, scopes } = (await res.json());

// Disconnect
await fetch(`${API_BASE}/api/v1/google/oauth/disconnect/search_console`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

---

## 7. Errors

| Status | Meaning |
|--------|--------|
| **400** | Missing `client_id`/`client_secret` in body, or invalid `service`. Show `response.body.error`. |
| **401** | Missing or invalid JWT. Send `Authorization: Bearer <accessToken>`. |
| **503** | Backend Redis unavailable. Per-client flow requires `REDIS_URL` on the backend. Show a friendly message or fallback to “Connect later”. |

---

## 8. Security notes

- **Never** put `GOOGLE_CLIENT_SECRET` in a `NEXT_PUBLIC_` env var or in client-side code. Use a server action, API route, or serverless function to call POST `/oauth/authorize/:service` with the secret.
- Do not log the request body that contains `client_secret`.
- Callback URL is on the backend; ensure your Google Cloud OAuth client has that exact redirect URI (e.g. `https://<backend>/api/v1/google/oauth/callback`) in the authorized list.

---

## 9. Checklist for frontend

- [ ] Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in frontend Vercel env (or equivalent). Keep secret server-side only.
- [ ] “Connect Google” calls **POST** `/api/v1/google/oauth/authorize/:service` with body `{ client_id, client_secret }` and JWT in `Authorization` header.
- [ ] On 200 with `authUrl`, redirect user to `authUrl`.
- [ ] On settings/integrations page, read `?connected=` or `?error=` after redirect and show success/error.
- [ ] Use GET `/oauth/status/:service` to show connection state; use DELETE `/oauth/disconnect/:service` to disconnect.
- [ ] Do not expose `client_secret` in the client bundle; use server action or API route to perform the authorize request.

---

## 10. Related docs

- [GOOGLE_OAUTH_CREDENTIALS_ISSUE_504.md](./GOOGLE_OAUTH_CREDENTIALS_ISSUE_504.md) — backend credential options (per-client vs backend env vs per-user)
- Backend route: `routes/google-integrations.js` (POST `/oauth/authorize/:service`, GET `/oauth/callback`)
