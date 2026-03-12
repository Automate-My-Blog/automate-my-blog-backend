# Medium OAuth on Staging — What Actually Fixes It

The backend implements the Medium OAuth flow (see [PUBLISHING_OAUTH_FRONTEND_HANDOFF.md](./PUBLISHING_OAUTH_FRONTEND_HANDOFF.md)). A **503** or “not configured” on `POST /api/v1/publishing-platforms/connect` with `{ "platform": "medium" }` means **OAuth app credentials are missing**. Prefer storing them in the **encrypted secrets table** (no env vars); env vars are an optional fallback.

**Important:** Per [Medium’s API/Importing policy](https://help.medium.com/hc/en-us/articles/213480228-API-Importing), Medium **does not issue new integration tokens** and does not allow new integrations. **Existing** OAuth applications and tokens continue to work. If you don’t already have a Medium application at [medium.com/me/applications](https://medium.com/me/applications), you cannot create a new one for API access; consider alternatives (e.g. import via webpage, IFTTT, RSS) for outbound.

---

## 1. Medium OAuth app (existing only)

1. Go to [Medium → Settings → Applications](https://medium.com/me/applications).
2. Use an **existing** application (new ones are not available for API). You need:
   - **Application name** and **Description**
   - **Callback URL**: must **exactly** match the backend callback URL.
3. Callback URL formula: `https://<staging-backend-url>/api/v1/publishing-platforms/medium/callback`  
   Example: `https://automate-my-blog-backend-git-staging-<team>.vercel.app/api/v1/publishing-platforms/medium/callback`
4. Copy the **Client ID** and **Client secret** from the Medium application.

---

## 2. Store credentials (recommended — no env vars)

Have a **super_admin** user call:

```http
POST /api/v1/publishing-platforms/oauth/credentials
Authorization: Bearer <super_admin_jwt>
Content-Type: application/json

{
  "platform": "medium",
  "client_id": "<from Medium>",
  "client_secret": "<from Medium>"
}
```

Credentials are stored encrypted in the database (`platform_publishing_app_credentials`). No need to set `MEDIUM_CLIENT_ID` or `MEDIUM_CLIENT_SECRET` in Vercel.

**Required env (unchanged):**

- **`OAUTH_ENCRYPTION_KEY`** — Must be set so the backend can encrypt/decrypt stored credentials (same as for Google OAuth credentials).
- **`FRONTEND_URL`** — Staging frontend base URL so the OAuth callback redirects to the right place (e.g. `https://staging-app.vercel.app`).
- **`BACKEND_URL`** or **VERCEL_URL** — So the backend can build the redirect_uri for Medium (or set **`MEDIUM_REDIRECT_URI`** explicitly).

---

## 3. Optional: env var fallback

If you prefer not to use the credentials store, you can set in Vercel (Preview + branch staging):

- `MEDIUM_CLIENT_ID`
- `MEDIUM_CLIENT_SECRET`

Resolution order is: **encrypted store first**, then env vars.

---

## 4. Verify

1. Open the staging frontend and go to Settings (or Integrations).
2. Click “Connect” for Medium.
3. Backend should return **200** with `{ "success": true, "authorization_url": "https://medium.com/...", "state": "..." }` (no 503).
4. After redirect and authorizing on Medium, user is sent back to `FRONTEND_URL/settings?publishing=connected&platform=medium`.

---

## Summary

| Method | Action |
|--------|--------|
| **Recommended** | Super_admin calls **POST /api/v1/publishing-platforms/oauth/credentials** with `{ "platform": "medium", "client_id", "client_secret" }`. No Medium env vars needed. |
| **Optional** | Set `MEDIUM_CLIENT_ID` and `MEDIUM_CLIENT_SECRET` in Vercel for the staging environment. |
| **Both** | Ensure `OAUTH_ENCRYPTION_KEY`, `FRONTEND_URL`, and backend URL (for redirect_uri) are set; add the exact callback URL in the Medium application. |

Same pattern applies to Shopify, Webflow, Squarespace, Wix, HubSpot, and Drupal: store credentials via **POST /api/v1/publishing-platforms/oauth/credentials** with the appropriate `platform` value.
