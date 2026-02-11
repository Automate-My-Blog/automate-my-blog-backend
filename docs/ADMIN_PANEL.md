# Admin Panel

Simple administration panel for application statistics and DB cache management.

## Access

- **URL**: `GET /admin` or `GET /api/v1/admin-panel`
- **Auth**: Either
  - Log in as a **super_admin** user (JWT in `Authorization: Bearer <token>`), or
  - Set `ADMIN_API_KEY` in the environment and pass it via:
    - Header: `x-admin-key: <key>`
    - Query: `/admin?admin_key=<key>`

## Features

1. **Application & DB stats**
   - Node version, env, Redis status
   - Table row counts (users, organizations, projects, blog_posts, jobs, organization_intelligence, audiences, cta_analysis, website_pages, comprehensive_seo_analyses, leads)
   - Platform metrics from `platform_metrics_summary` view (if present)

2. **Cache by URL**
   - **View**: See cached website analysis entries for a given URL (organizations keyed by `website_url`).
   - **Clear**: Remove website analysis cache for a given URL so the next analysis runs from scratch. This deletes related `organization_intelligence`, `cta_analysis`, `website_pages`, and `audiences` rows and sets `organizations.last_analyzed_at = NULL`.

## API (same auth)

- `GET /api/v1/admin-panel/stats` — JSON stats
- `GET /api/v1/admin-panel/cache?url=<url>` — List cache entries for URL
- `DELETE /api/v1/admin-panel/cache?url=<url>` — Clear cache for URL

## Environment

| Variable        | Required | Description |
|----------------|----------|-------------|
| `ADMIN_API_KEY` | No      | When set, allows access with `x-admin-key` header or `admin_key` query param. Leave unset to allow only super_admin JWT. |

See `.env.example` for the optional `ADMIN_API_KEY` entry.
