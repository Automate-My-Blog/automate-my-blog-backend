# Admin Panel

Simple administration panel for application statistics and DB cache management.

## Access

- **URL**: `GET /admin` or `GET /api/v1/admin-panel`
- **Login**: `GET /admin/login` — login page using existing app auth (`POST /api/v1/auth/login`). Only **super_admin** users can proceed; others see "Access denied".
- **Auth**: Either
  - **Super admin login**: Open `/admin` or `/admin/login`, sign in with a super admin account (email/password). Token is stored in sessionStorage and used for panel requests. Use "Log out" to clear it.
  - **API key**: Set `ADMIN_API_KEY` and pass via header `x-admin-key` or query `admin_key` (e.g. `/admin?admin_key=<key>`).

## Features

1. **Overview (stats + charts)**
   - **Stat cards**: Node version, Redis status, DB size, total jobs.
   - **Charts** (Chart.js): Job queue by status (queued / running / succeeded / failed); table row counts (horizontal bar).
   - Stats also include table counts and `platform_metrics_summary` when available.

2. **Job queue**
   - **Summary**: In stats, `db.jobSummary.byStatus` and `db.jobSummary.byType`, plus doughnut chart.
   - **Recent jobs**: `GET /api/v1/admin-panel/jobs/recent?limit=25` — table of last N jobs (type, status, created_at, error snippet). Panel has “Load recent jobs”.

3. **Cached URLs (website analysis)**
   - **List**: `GET /api/v1/admin-panel/cache/urls` — all orgs with `last_analyzed_at` set; panel shows table with “Clear” per row.
   - **Clear all**: `DELETE /api/v1/admin-panel/cache/all` — clears all website analysis cache.
   - **By URL**: View/clear cache for a single URL (unchanged).

4. **Cache by URL (single)**
   - **View**: See cached website analysis entries for a given URL (organizations keyed by `website_url`).
   - **Clear**: Remove website analysis cache for a given URL so the next analysis runs from scratch.

## API (same auth)

- `GET /api/v1/admin-panel/stats` — JSON stats (app, db.tables, db.sizeBytes, db.jobSummary, db.platformMetrics)
- `GET /api/v1/admin-panel/jobs/recent?limit=25` — Recent jobs list
- `GET /api/v1/admin-panel/cache/urls` — List all cached website URLs
- `DELETE /api/v1/admin-panel/cache/all` — Clear all website analysis cache
- `GET /api/v1/admin-panel/cache?url=<url>` — List cache entries for URL
- `DELETE /api/v1/admin-panel/cache?url=<url>` — Clear cache for URL

## Environment

| Variable        | Required | Description |
|----------------|----------|-------------|
| `ADMIN_API_KEY` | No      | When set, allows access with `x-admin-key` header or `admin_key` query param. Leave unset to allow only super_admin JWT. |

See `.env.example` for the optional `ADMIN_API_KEY` entry.
