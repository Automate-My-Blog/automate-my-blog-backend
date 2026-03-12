# Google OAuth — Frontend Handoff (encrypted store)

This document describes how the **frontend** integrates with the backend for **Google OAuth** (Search Console and Analytics). Credentials are stored in the backend **encrypted store** (no Vercel env vars). Related: [automate-my-blog-frontend#504](https://github.com/Automate-My-Blog/automate-my-blog-frontend/issues/504).

---

## 1. Overview

- **Credentials:** Stored in the backend only (per-user or platform). A **super_admin** sets platform credentials once via **POST /api/v1/google/oauth/credentials** with `platform: true`. No frontend or backend Vercel env vars for `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` required.
- **Flow:** User clicks “Connect Google” → frontend calls **GET** `/api/v1/google/oauth/authorize/:service` (no body) → backend returns `authUrl` from encrypted store (or env fallback) → frontend redirects user to `authUrl` → user signs in on Google → backend callback exchanges code and stores tokens → backend redirects to frontend (e.g. `?connected=search_console` or `?connected=analytics`).

---

## 2. One-time setup (platform credentials)

A **super_admin** stores the OAuth app credentials once so all users can connect:

```js
// Super_admin only. Run once (e.g. from admin UI or script).
const res = await fetch(`${API_BASE}/api/v1/google/oauth/credentials`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${superAdminAccessToken}`,
  },
  body: JSON.stringify({
    service: 'search_console',  // or 'analytics'
    client_id: 'xxx.apps.googleusercontent.com',
    client_secret: 'GOCSPX-xxx',
    platform: true,
  }),
});
// 200 = stored in encrypted platform store
```

Repeat for `analytics` if needed. After that, any user can use **GET /oauth/authorize/:service** to start the flow; the backend uses these platform credentials.

---

## 3. Endpoints quick reference

Base path: `/api/v1/google`. Auth-required endpoints need **JWT**: `Authorization: Bearer <accessToken>`.

| Purpose | Method | Path | Auth | Notes |
|--------|--------|------|------|--------|
| Start OAuth | **GET** | `/oauth/authorize/:service` | Yes | No body. Returns `{ authUrl }` or `{ noOAuthRequired, redirectUrl }` for trends. |
| Config check | GET | `/oauth/config` | No | `{ clientConfigured: boolean }`. Use to show/hide “Connect Google”. |
| Store credentials (per-user) | POST | `/oauth/credentials` | Yes | Body: `{ service, client_id, client_secret }`. Stores for current user. |
| Store credentials (platform) | POST | `/oauth/credentials` | Yes (super_admin) | Body: `{ service, client_id, client_secret, platform: true }`. |
| Connection status | GET | `/oauth/status/:service` | Yes | `{ connected, expires_at, scopes }`. |
| Disconnect | DELETE | `/oauth/disconnect/:service` | Yes | Revokes connection. |

**Services:** `:service` is one of `search_console`, `analytics`. For `trends`, no OAuth; backend may return `noOAuthRequired: true`.

---

## 4. Connect flow

When the user clicks “Connect Google” for Search Console or Analytics:

1. **Call GET authorize (no body).**

```js
const service = 'search_console'; // or 'analytics'
const res = await fetch(`${API_BASE}/api/v1/google/oauth/authorize/${service}`, {
  headers: { Authorization: `Bearer ${accessToken}` },
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
- If **400**: show `data.error` (e.g. “Google OAuth not configured” — platform credentials not set yet).
- If **403**: forbidden (e.g. platform credentials endpoint called without super_admin).

---

## 5. After redirect (callback)

Google redirects to the **backend**. The backend then redirects the user to the **frontend** with query params:

- Success: `https://<frontend>/settings/google-integrations?connected=search_console` or `?connected=analytics`
- Error: `https://<frontend>/settings/google-integrations?error=<message>`

On the settings page, read `searchParams.get('connected')` or `searchParams.get('error')` and show success or error. Optionally call **GET** `/oauth/status/:service` to confirm.

---

## 6. Status and disconnect

```js
// Status
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
| **400** | OAuth not configured: no credentials in encrypted store (or env). Super_admin should call POST /oauth/credentials with `platform: true` once. |
| **401** | Missing or invalid JWT. |
| **403** | Platform credentials only: body had `platform: true` but user is not super_admin. |

---

## 8. Checklist for frontend

- [ ] No frontend env vars for Google OAuth; credentials are in the backend encrypted store (or backend env).
- [ ] “Connect Google” calls **GET** `/api/v1/google/oauth/authorize/:service` with JWT (no body).
- [ ] On 200 with `authUrl`, redirect user to `authUrl`.
- [ ] On settings page, read `?connected=` or `?error=` after redirect.
- [ ] Optional: call GET `/oauth/config` to show/hide “Connect Google” based on `clientConfigured`.
- [ ] Platform credentials: super_admin sets them once via POST `/oauth/credentials` with `platform: true`.

---

## 9. Related docs

- [GOOGLE_OAUTH_CREDENTIALS_ISSUE_504.md](./GOOGLE_OAUTH_CREDENTIALS_ISSUE_504.md) — credential options and backend env
- Backend: `routes/google-integrations.js`, `services/oauth-manager.js`, tables `user_google_app_credentials`, `platform_google_app_credentials`
