# Publishing — Backend status vs frontend handoffs

This doc summarizes backend implementation status against the frontend publishing docs. Use it to see what’s done and what’s left.

**Source handoffs** (in frontend repo `docs/publishing/`): INTEGRATION_BACKEND_HANDOFF.md, DIRECT_PLATFORM_PUBLISHING_BACKEND_HANDOFF.md, THIRD_PARTY_PUBLISHING_SERVICES_BACKEND_HANDOFF.md, plus platform-specific handoffs (Medium, Shopify, Drupal, Squarespace, Next.js, Jekyll, Hugo, Astro, Gatsby, Contentful, Sanity, HubSpot).

---

## 1. Connection layer (list / connect / disconnect)

| Requirement | Status | Notes |
|-------------|--------|--------|
| **GET /api/v1/publishing-platforms/connections** | ✅ Done | Returns `{ connections }` for all 16 platform keys; `platform`, `connected`, `label`, `site_name`, `site_url`, `account`. |
| **POST /api/v1/publishing-platforms/connect** | ✅ Partial | See platform table below. |
| **DELETE /api/v1/publishing-platforms/:platform/disconnect** | ✅ Done | All 16 keys; 404 when not connected. |
| **OAuth callback redirect** | ✅ Done (Medium) | Redirect to frontend with `?publishing=connected&platform=...` or `?publishing=error&message=...`. |

### Connect by platform

| Platform | Connect (store credentials / OAuth) | Publish (actually send to provider) |
|----------|-------------------------------------|-------------------------------------|
| **wordpress** | ✅ `site_url`, `username?`, `application_password` | ✅ `wordpress-publish.js` |
| **medium** | ✅ OAuth only → `authorization_url`; callback stores tokens + `medium_user_id` | ✅ `medium-publish.js` |
| **ghost** | ✅ `admin_url`, `admin_api_key` | ❌ Not implemented (status stays `publishing`) |
| **substack** | ✅ `api_key`, `publication_url?` | ❌ Not implemented |
| **contentful** | ✅ `space_id`, `environment_id?`, `management_token` | ❌ Not implemented |
| **sanity** | ✅ `project_id?`, `dataset?`, `api_token` | ❌ Not implemented |
| **jekyll** | ✅ `repository_url`, `access_token`, `branch?`, `posts_path?` | ❌ Not implemented |
| **nextjs** | ✅ `repository_url`, `access_token`, `branch?`, `content_path?` | ❌ Not implemented |
| **webflow** | ❌ 503 “OAuth not yet configured” | ❌ |
| **squarespace** | ❌ 503 | ❌ |
| **wix** | ❌ 503 | ❌ |
| **shopify** | ❌ 503 | ❌ |
| **hubspot** | ❌ 503 | ❌ |
| **drupal** | ❌ 503 | ❌ |
| **hugo** | ❌ 503 | ❌ |
| **astro** | ❌ 503 | ❌ |

---

## 2. Publish / unpublish endpoints

| Requirement | Status | Notes |
|-------------|--------|--------|
| **POST /api/v1/posts/:id/publish** | ✅ Done | Validates `platforms` and “connected”; returns updated post with `publication_status` and `platform_publications`. |
| **POST /api/v1/posts/:id/unpublish** | ✅ Done | Optional `platform`; removes from `platform_publications`; returns updated post. |
| **Post payload** | ✅ Done | `formatPostForResponse()` includes `publication_status` and `platform_publications`; list/detail use it. |
| **platform_publications shape** | ✅ Done | `platform`, `status`, optional `url`, `label`; failed entries have `message`. |

### Optional request fields (not yet used)

- **`publish_mode`** — Handoff: `live` (default) or `draft`. Backend does not read this yet. Could be passed to WordPress (draft vs publish) and Medium (`publishStatus: 'public'` vs `'draft'`).
- **`update_existing`** — Handoff: when `true`, update existing destination post. Backend does not read this; would require storing external post IDs per platform and implementing update flows.

---

## 3. Left to do (by priority)

### High (core handoff compliance)

- None. List/connect/disconnect, publish/unpublish contract, and post metadata are implemented for the platforms that have connect support. Medium and WordPress have full publish; others get `status: 'publishing'` until implemented.

### Medium (better UX / handoff parity)

1. **Honor `publish_mode`**  
   Read `publish_mode` from `POST .../publish` and pass to providers that support drafts (e.g. WordPress, Medium).

2. **Honor `update_existing`**  
   Store external post IDs in `platform_publications` (e.g. `external_id` or in metadata). When `update_existing: true`, call provider update APIs instead of create where available (WordPress supports update; Medium does not).

3. **Ghost publish**  
   Implement `ghost-publish.js` (or similar) and call it when `platforms` includes `ghost`, using stored `admin_url` and `admin_api_key`.

4. **Substack publish**  
   Implement Substack publish using stored API key and call it when `platforms` includes `substack`.

### Lower (more platforms)

5. **OAuth + publish for:** webflow, squarespace, wix, shopify, hubspot, drupal, hugo, astro  
   Each has a platform-specific handoff in the frontend `docs/publishing/` folder (e.g. `SHOPIFY_PUBLISHING_BACKEND_HANDOFF.md`). Implement connect (OAuth or token) then publish/unpublish per doc.

6. **CMS / static publish**  
   Contentful, Sanity, Jekyll, Next.js: connect is done; implement actual publish (e.g. create/update entry or commit to repo) per their handoffs.

---

## 4. Quick reference

| Action | Method | Endpoint | Backend |
|--------|--------|----------|---------|
| List connections | GET | `/api/v1/publishing-platforms/connections` | ✅ |
| Connect | POST | `/api/v1/publishing-platforms/connect` | ✅ 8 platforms; 503 for 8 OAuth-only |
| Disconnect | DELETE | `/api/v1/publishing-platforms/:platform/disconnect` | ✅ |
| Publish | POST | `/api/v1/posts/:id/publish` | ✅ (WordPress + Medium real publish; others `publishing`) |
| Unpublish | POST | `/api/v1/posts/:id/unpublish` | ✅ |

Post responses include `publication_status` and `platform_publications`; frontend uses them for the status column and per-platform tags.
