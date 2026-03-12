# Issue #504 — Backend evaluation and support

Evaluation of this backend against [automate-my-blog-frontend#504](https://github.com/Automate-My-Blog/automate-my-blog-frontend/issues/504): *Google OAuth integration: Search Console + Analytics for per-post funnel data*.

---

## 1. Where we are

### OAuth and connections

| Requirement | Backend status |
|-------------|----------------|
| OAuth so users can connect their own GSC and Analytics | ✅ Supported. GET `/api/v1/google/oauth/authorize/:service` (search_console, analytics); credentials from encrypted store (per-user or platform) or env. |
| Tokens stored per user | ✅ `user_oauth_credentials` (encrypted). |
| Each user sees only their property’s data | ✅ All GSC/GA calls use the authenticated user’s OAuth tokens. |
| Credentials in env | ✅ Not required. Use encrypted store (POST `/oauth/credentials`; platform creds via `platform: true` for super_admin). See [GOOGLE_OAUTH_CREDENTIALS_ISSUE_504.md](./GOOGLE_OAUTH_CREDENTIALS_ISSUE_504.md). |

### Per-post funnel data

| Requirement | Backend status |
|-------------|----------------|
| Search Impressions (GSC) | ✅ Via GET `/api/v1/google/funnel` → `funnel.search_impressions`. |
| Search Clicks (GSC) | ✅ Via same endpoint → `funnel.search_clicks`. |
| Time on Site (GA) | ✅ Via funnel API → `funnel.time_on_site_seconds` (from GA4 `averageSessionDuration`). |
| Internal Links Clicked (GA events) | ✅ Via funnel API → `funnel.internal_links_clicked` (GA4 event `internal_link_click`). |
| CTA Clicks (GA events) | ✅ Via funnel API → `funnel.cta_clicks` (GA4 event `cta_click`). |
| Filter by date range | ✅ Query params `startDate`, `endDate` (YYYY-MM-DD). |
| Graceful empty / not connected | ✅ Funnel returns `null` for stages when that integration isn’t connected; `meta.gsc_connected` / `meta.ga_connected` indicate connection status. |

### APIs provided for the frontend

- **GET /api/v1/google/funnel** — Single per-post funnel (all 5 stages + meta). See [per-post-funnel-api-frontend-handoff.md](./per-post-funnel-api-frontend-handoff.md).
- **GET /api/v1/google/search-console/page-performance** — GSC only (impressions, clicks, etc.) for a page/date range.
- **GET /api/v1/google/analytics/page-performance** — GA only (pageviews, avg session duration, bounce, conversions) for a page/date range.
- **GET /api/v1/google/oauth/config** — Whether backend has OAuth client configured.
- **GET /api/v1/google/oauth/status/:service** — Whether user has connected GSC or Analytics.

---

## 2. What the frontend still needs to do

1. **OAuth consent in Production** — Backend supports the flow; Google Cloud Console must be set to Production and verified as per the issue.
2. **Redirect URIs** — Add backend callback URL(s) in Google Cloud Console (e.g. `https://<api>/api/v1/google/oauth/callback`).
3. **Store `siteUrl` and GA4 `propertyId`** — Backend does not store these; frontend (or app settings) must pass them into the funnel and other GSC/GA endpoints.
4. **Resolve post → URL** — Backend expects `pageUrl` (and optionally `pagePath`); frontend must map each post to its live URL (or path) and pass it to the funnel API.
5. **GA4 events** — To get Internal Links and CTA counts, the **site** (where the blog lives) must send GA4 events `internal_link_click` and `cta_click`; backend only reads them.
6. **Caching** — Issue suggests caching per post + date range. Backend does not cache funnel responses; frontend (or a future backend layer) can cache.

---

## 3. Handoff doc

**Frontend handoff for the funnel API:** [per-post-funnel-api-frontend-handoff.md](./per-post-funnel-api-frontend-handoff.md)

It covers: endpoint, query params, response shape, funnel stages, GA4 event names, errors, and where to get `siteUrl` / `propertyId`.
