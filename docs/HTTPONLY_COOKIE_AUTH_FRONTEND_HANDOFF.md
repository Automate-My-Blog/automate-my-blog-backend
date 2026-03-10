# httpOnly Cookie Auth — Frontend Handoff

This document describes how the **backend** implements auth with httpOnly cookies so the **frontend** can rely on it. Backend issue: [#12 — Move Auth Tokens to httpOnly Cookies](https://github.com/Automate-My-Blog/automate-my-blog-backend/issues/12).

---

## 1. Overview

- The backend **sets** `access_token` and `refresh_token` as **httpOnly cookies** on login, register, and refresh.
- The backend **clears** those cookies on logout.
- Authenticated requests use **cookies** (sent automatically by the browser with `credentials: 'include'`). The frontend **must not** store tokens in `localStorage` or send `Authorization: Bearer` for normal API calls (Bearer is still accepted for backward compatibility).
- Session state is determined by **cookie presence + `GET /api/v1/auth/me`**, not by reading a token in JS.

---

## 2. What the Backend Does

| Endpoint | Behavior |
|----------|----------|
| `POST /api/v1/auth/login` | On success: sets `access_token` and `refresh_token` cookies; returns `{ success, user, accessToken, refreshToken, expiresIn }` (body kept for compatibility; frontend should not store tokens). |
| `POST /api/v1/auth/register` | Same as login: sets both cookies and returns the same JSON. |
| `POST /api/v1/auth/refresh` | Reads refresh token from **cookie** (preferred) or body `refreshToken`. On success: sets new access and refresh cookies; returns new tokens in body. Frontend should send **empty body** and rely on cookie. |
| `POST /api/v1/auth/logout` | Clears `access_token` and `refresh_token` cookies. Response: `{ success, message }`. Frontend only needs to clear local session markers; cookie invalidation is server-side. |
| `GET /api/v1/auth/me` | Requires auth via **cookie or** `Authorization: Bearer`. Returns `{ success, user }`. Use this to restore session on reload. |

All protected REST routes and SSE stream routes accept auth from **cookie first**, then (where applicable) `Authorization: Bearer` or `?token=`.

---

## 3. Cookie Names and Attributes

| Cookie name   | Purpose     | Backend-set attributes |
|---------------|-------------|-------------------------|
| `access_token`  | JWT access  | `HttpOnly`, `Secure` (in production), `SameSite` (see below), `Path=/`, `Max-Age` (e.g. 7 days) |
| `refresh_token` | JWT refresh | Same, with longer `Max-Age` (e.g. 30 days) |

- **SameSite:** In **production** (and staging), the backend defaults to **`SameSite=None`** with **`Secure`** so cookies are sent on cross-origin requests (e.g. frontend at `staging.automatemyblog.com` → API at `*.vercel.app`). In local dev it defaults to `Lax`. Override with `COOKIE_SAME_SITE=lax|strict|none` if needed (see §8).
- The frontend **cannot read** these cookies (httpOnly). It only needs to send requests with credentials so the browser attaches them.

---

## 4. Staging / cross-origin (frontend and API on different domains)

When the frontend is on a different domain than the API (e.g. `staging.automatemyblog.com` → `automate-my-blog-backend-*.vercel.app`), the backend sets auth cookies with **`SameSite=None`** and **`Secure`** so the browser sends them on cross-origin requests. This is done when:

- `NODE_ENV=production`, or
- `VERCEL=1` (set by Vercel for all deployments), or
- **`COOKIE_CROSS_ORIGIN=true`** (set this on staging if 401s persist; it forces cross-origin cookie attributes).

On login/register the backend sends **explicit `Set-Cookie`** headers with `SameSite=None; Secure; Path=/; HttpOnly; Max-Age=...` so the exact format is guaranteed. If you still see 401 after login, add **`COOKIE_CROSS_ORIGIN=true`** to the backend (staging) environment and redeploy.

---

## 5. Frontend Requirements

1. **Send credentials on every request to the API**
   - Use `credentials: 'include'` (fetch) or equivalent (e.g. axios `withCredentials: true`) so the browser sends cookies on same- and cross-origin requests to the backend.

2. **Do not store tokens in localStorage**
   - Do not persist `accessToken` or `refreshToken` in localStorage. Rely on cookies for auth.

3. **Session / auth state**
   - Use a session marker in memory or `sessionStorage` (e.g. “user loaded”) and **`GET /api/v1/auth/me`** to resolve the current user. On reload, call `/auth/me` with credentials; if it returns 200, restore session; if 401, treat as logged out.

4. **Login / register**
   - After successful login or register, the response will include `Set-Cookie` for both tokens. Store only the `user` object (and any UI state); do not store the tokens. Subsequent requests will use the cookies automatically.

5. **Refresh**
   - Call `POST /api/v1/auth/refresh` with **empty JSON body** (`{}`) and **credentials included**. The backend will read the refresh token from the cookie and set new access/refresh cookies on success.

6. **Logout**
   - Call `POST /api/v1/auth/logout` with credentials. The backend clears the auth cookies. Clear any local session markers; no need to clear cookies in JS (they are httpOnly).

7. **REST requests**
   - Do **not** send `Authorization: Bearer <token>` for normal API calls. Rely on cookies. The backend still accepts Bearer for compatibility (e.g. scripts or legacy clients).

---

## 6. CORS and Credentials

- The backend sends **`Access-Control-Allow-Credentials: true`** and an **explicit** `Access-Control-Allow-Origin` (never `*`) for the frontend origin.
- The frontend **must** send credentials so cookies are included; the backend is already configured for credentialed requests.

---

## 7. SSE (EventSource / streaming)

- **Authenticated SSE:** The backend accepts auth from the **cookie** first, then from `?token=<accessToken>` (e.g. for legacy or non-cookie clients). The frontend should open SSE URLs **with credentials** and **no** token query param when the user is logged in (cookies will be sent automatically).
- **Anonymous SSE:** Continue to pass `sessionId` in the query (or header where supported) for unauthenticated flows.
- Example (logged-in):  
  `EventSource(url, { withCredentials: true })`  
  with no `?token=` on the URL.

---

## 8. Optional Backend Environment (for reference)

If the frontend and API are on different domains and cookies are not sent, the backend can tune cookies via env (no frontend change):

| Env variable           | Purpose |
|------------------------|--------|
| **`COOKIE_CROSS_ORIGIN`** | Set to `true` or `1` to **force** `SameSite=None` and `Secure` for auth cookies (use if 401s persist on staging; overrides NODE_ENV/VERCEL). |
| `COOKIE_SAME_SITE`     | `lax`, `strict`, or `none`. Override when needed. |
| `COOKIE_DOMAIN`        | Optional domain for the cookie (e.g. shared subdomain). |
| `COOKIE_SECURE`        | Set to `true` to force `Secure` in non-production. |

---

## 9. Validation Checklist (Frontend)

- [ ] Login succeeds and the browser receives `Set-Cookie` for `access_token` and `refresh_token`.
- [ ] After reload, calling `GET /api/v1/auth/me` with credentials returns 200 and the current user (session restored via cookie).
- [ ] Logout calls `POST /api/v1/auth/logout`; after that, `GET /api/v1/auth/me` returns 401.
- [ ] Authenticated REST requests succeed **without** an `Authorization` header (cookies only).
- [ ] Authenticated SSE streams work **without** `token` in the query string (credentials/cookies only).
- [ ] Refresh is called with an empty body and credentials; new cookies are set and subsequent `/auth/me` or API calls succeed.

---

## 10. Local Development

- Point the frontend at the local backend (e.g. `http://localhost:3001`). Use **credentials included** on all API and SSE requests.
- The backend allows localhost origins and sets cookies with `Secure` off in development, so cookies work over `http://localhost`.
- See [LOCAL_BACKEND_FRONTEND_HANDOFF.md](./LOCAL_BACKEND_FRONTEND_HANDOFF.md) for API base URL and CORS; auth is cookie-based as above, no need to send `Authorization: Bearer` from the frontend.
