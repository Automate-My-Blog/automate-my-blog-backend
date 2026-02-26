# Google OAuth credentials and frontend issue #504

For [automate-my-blog-frontend#504](https://github.com/Automate-My-Blog/automate-my-blog-frontend/issues/504), point 6: credentials are stored in the **encrypted store** (no Vercel env vars required).

## Encrypted store (no env vars)

Credentials are stored in the backend database, encrypted at rest:

1. **Per-user:** Any user can submit their own OAuth app credentials via **POST /api/v1/google/oauth/credentials** with body `{ service, client_id, client_secret }`. Stored in `user_google_app_credentials`.
2. **Platform:** A **super_admin** can store one set per service for the whole app via **POST /api/v1/google/oauth/credentials** with body `{ service, client_id, client_secret, platform: true }`. Stored in `platform_google_app_credentials`. All users then use these for that service unless they have per-user credentials.

**Resolution order:** per-user store → platform store → env fallback (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`). Prefer the encrypted store so you don’t need Vercel env vars.

## Backend env (still required)

| Variable | Required | Notes |
|----------|----------|--------|
| `GOOGLE_REDIRECT_URI` | Yes | Backend OAuth callback URL, e.g. `https://<backend>/api/v1/google/oauth/callback`. Add in Google Cloud Console as authorized redirect URI. |
| `OAUTH_ENCRYPTION_KEY` | Yes | 64 hex chars. Encrypts tokens and app credentials at rest. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | No* | *Optional fallback if nothing is in the encrypted store. |

## Frontend flow

- **Connect:** Call **GET** `/api/v1/google/oauth/authorize/:service` (no body). Backend resolves credentials from encrypted store (or env) and returns `{ authUrl }`. Redirect the user to `authUrl`.
- **Config check:** **GET** `/api/v1/google/oauth/config` returns `{ clientConfigured: boolean }` (true when platform store or env has credentials). Use to show/hide “Connect Google” or a setup message.
- No frontend env vars for Google OAuth; credentials live only in the backend encrypted store (or backend env as fallback).

## Summary for issue 504

- **Point 6:** Do **not** set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in Vercel if you use the encrypted store. A super_admin stores them once via **POST /api/v1/google/oauth/credentials** with `platform: true`. Frontend uses **GET /oauth/authorize/:service** to start the flow.
