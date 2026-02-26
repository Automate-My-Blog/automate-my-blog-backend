# Google OAuth credentials and frontend issue #504

For [automate-my-blog-frontend#504](https://github.com/Automate-My-Blog/automate-my-blog-frontend/issues/504), point 6 asks to set real credentials in Vercel env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

## Per-client credentials on the frontend

When each **client** (tenant or deployment) has its own Google OAuth app, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the **frontend** Vercel env. The frontend then starts the OAuth flow by calling:

- **POST /api/v1/google/oauth/authorize/:service**  
  Body: `{ "client_id": "<from env>", "client_secret": "<from env>" }`  
  Backend stores them temporarily in Redis (keyed by OAuth state) and returns `{ authUrl }`. The user is redirected to Google; on callback, the backend uses the stored credentials to exchange the code and store tokens. Credentials are not persisted.

**Backend requirements for per-client (frontend) flow:**

| Variable | Required | Notes |
|----------|----------|--------|
| `GOOGLE_REDIRECT_URI` | Yes | Backend callback URL, e.g. `https://<backend-host>/api/v1/google/oauth/callback`. Add this in Google Cloud Console as authorized redirect URI. |
| `REDIS_URL` | Yes | Used to pass credentials from authorize request to callback (short-lived). |
| `OAUTH_ENCRYPTION_KEY` | Yes | Encrypts stored OAuth tokens. |

The backend does **not** need `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` in its env when using this flow.

## Alternative: credentials on the backend

- **Backend env (platform-wide):** Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `OAUTH_ENCRYPTION_KEY` in the backend Vercel env. The frontend uses **GET /api/v1/google/oauth/authorize/:service** (no body) to get `authUrl`.
- **Per-user (self-serve):** Users submit their own OAuth app credentials via **POST /api/v1/google/oauth/credentials**. Stored encrypted in `user_google_app_credentials`. Frontend then uses GET /oauth/authorize/:service.

## Backend endpoints for the frontend

- **GET /api/v1/google/oauth/config** (no auth): `{ success: true, clientConfigured: boolean }`. `clientConfigured` is true when the backend has platform credentials in env. When using per-client credentials on the frontend, the frontend can ignore this and always call POST /oauth/authorize with its env-derived credentials.
- **POST /api/v1/google/oauth/authorize/:service** (auth required): Body `{ client_id, client_secret }`. Use when credentials are in the frontend (per-client). Requires Redis and `GOOGLE_REDIRECT_URI` on the backend.

## Summary for issue 504

- **Point 6 (set real credentials in Vercel):** You can set them on the **frontend** (per-client): set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the frontend Vercel env, and start the flow with **POST /api/v1/google/oauth/authorize/:service** with body `{ client_id, client_secret }`. Backend must have `GOOGLE_REDIRECT_URI`, `REDIS_URL`, and `OAUTH_ENCRYPTION_KEY` set.
