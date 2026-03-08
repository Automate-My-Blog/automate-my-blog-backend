# Direct Platform Publishing — Backend Handoff

This document describes the **direct publish/unpublish** actions added in the Posts tab of the dashboard. It is intended for the backend team so API contracts and response shapes align with the frontend.

**Related:** [PR #589 — feat: add direct platform publishing actions in posts tab](https://github.com/Automate-My-Blog/automate-my-blog-frontend/pull/589), [API_SPECIFICATION.md](./API_SPECIFICATION.md) (Direct Publishing section).

---

## Table of contents

1. [Overview](#1-overview)
2. [Auth](#2-auth)
3. [Endpoints](#3-endpoints)
4. [Publish](#4-publish)
5. [Unpublish](#5-unpublish)
6. [Post payload: publication metadata](#6-post-payload-publication-metadata)
7. [Frontend behavior](#7-frontend-behavior)
8. [Errors](#8-errors)
9. [Checklist](#9-checklist)

---

## 1. Overview

The dashboard Posts tab supports **direct publishing** from the post actions menu:

- **Publish Now / Publish Again** — Opens a modal to choose one or more connected platforms; frontend calls `POST /api/v1/posts/:id/publish` with the selected platforms.
- **Unpublish** — Either per-platform (“Unpublish from WordPress”) or “Unpublish” from all; frontend calls `POST /api/v1/posts/:id/unpublish` with optional `platform` (omit = all).

The frontend displays publication status in the Posts table (status tag + per-platform tags with optional links). It expects the **post** resource to include `publication_status` and `platform_publications` (or equivalent) so the UI can show publishing in progress, published, or failed per platform.

**Backend responsibilities:**

- Implement `POST /api/v1/posts/:id/publish` and `POST /api/v1/posts/:id/unpublish`.
- Return a consistent post payload (including publication metadata) in responses and/or ensure the post list/detail endpoints include the same fields so the dashboard status column stays in sync.

---

## 2. Auth

All direct publishing endpoints require a logged-in user (JWT).

- **Header:** `Authorization: Bearer <accessToken>`
- **401** if not authenticated → frontend shows error and does not update the post list.

---

## 3. Endpoints

| Purpose | Method | Endpoint |
|--------|--------|----------|
| Publish post to one or more connected platforms | POST | `/api/v1/posts/:id/publish` |
| Unpublish post from one platform or all | POST | `/api/v1/posts/:id/unpublish` |

`:id` is the post ID (e.g. UUID or string primary key).

---

## 4. Publish

### Request

```http
POST /api/v1/posts/{post_id}/publish
Authorization: Bearer {token}
Content-Type: application/json

{
  "platforms": ["wordpress", "medium"]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `platforms` | string[] | Yes | Platform keys the user selected (e.g. `wordpress`, `medium`). At least one. |

The frontend sends only the keys; it does not send labels or URLs. Backend should validate that each platform is connected for the user/org and that the post is publishable.

### Response (success)

Frontend expects a JSON body with:

- **`success`**: `true`
- **`post`** (optional but recommended): The updated post object including `publication_status` and `platform_publications` (see [§6](#6-post-payload-publication-metadata)).

If `post` is omitted, the frontend optimistically sets the post in local state to `publication_status: 'publishing'` and `platform_publications: platforms.map(p => ({ platform: p, status: 'publishing' }))`, then refetches the post list. Returning the updated `post` avoids a refetch and keeps the UI accurate (e.g. if backend starts async publishing and sets status to `publishing`).

### Response (error)

Standard error format; frontend shows `error.message` or a generic "Failed to publish post." See [§8](#8-errors).

---

## 5. Unpublish

### Request

```http
POST /api/v1/posts/{post_id}/unpublish
Authorization: Bearer {token}
Content-Type: application/json

{
  "platform": "wordpress"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `platform` | string | No | Platform key to unpublish from. **Omit or `null`** to unpublish from **all** connected destinations for that post. |

### Response (success)

- **`success`**: `true`
- **`post`** (optional but recommended): The updated post with `publication_status` and `platform_publications` reflecting the unpublish (e.g. empty array if unpublished from all).

If `post` is omitted, the frontend optimistically sets `publication_status: 'draft'` and `platform_publications: []`, then refetches the post list.

### Response (error)

Standard error format; frontend shows `error.message` or "Failed to unpublish post." See [§8](#8-errors).

---

## 6. Post payload: publication metadata

So the dashboard status column and per-platform tags stay correct, the **post** object (in publish/unpublish responses and in any GET that returns posts) should include publication metadata the frontend already consumes.

### Recommended fields on the post object

| Field | Type | Notes |
|-------|------|--------|
| `publication_status` | string | e.g. `'draft'`, `'publishing'`, `'published'`, `'failed'`. Frontend uses this plus `platform_publications` to derive overall status. |
| `platform_publications` | array | List of per-platform publication state. |

### Shape of each item in `platform_publications`

| Field | Type | Notes |
|-------|------|--------|
| `platform` | string | Key (e.g. `wordpress`, `medium`). Used as unique key in UI. |
| `status` | string | One of: `'published'`, `'publishing'`, `'failed'`. Drives tag color and text. |
| `label` | string | Optional. Human-readable name (e.g. "WordPress") for the status column. |
| `url` | string | Optional. If present, frontend renders the platform tag as a link to the published post. |

Frontend logic (for reference):

- **Overall status tag:** If any platform is `publishing` → "Publishing in progress" (blue). If any `failed` (and none publishing) → "Publish failed" (red). If any `published` → "Published to N platform(s)" (green). Else falls back to post `status` (draft/scheduled/published).
- **Per-platform tags:** Rendered below the main status; green/blue/red/default by `status`; clickable when `url` is set.

If your backend uses different field names (e.g. `platform_publications` vs `platformPublications`), the frontend may need a small adapter or the API can expose the names above for consistency with the spec.

---

## 7. Frontend behavior

| Action | Frontend behavior |
|--------|--------------------|
| User clicks "Publish Now" / "Publish Again" | Opens `PublishModal` with post and list of connected platforms (from post or org/settings). User selects platforms and confirms. |
| User confirms publish | Calls `POST /api/v1/posts/:id/publish` with `{ platforms }`. On success: updates post in state from `result.post` if present, else optimistic `publishing` + refetch. Shows success message and closes modal. |
| User clicks "Unpublish" or "Unpublish from {Platform}" | Confirmation modal. On confirm: calls `POST /api/v1/posts/:id/unpublish` with `{ platform }` or `{}`. On success: updates post from `result.post` if present, else optimistic draft + refetch. |
| Status column | Uses `publication_status` and `platform_publications` to show main tag and per-platform tags (with links when `url` is set). |

The frontend does **not** poll for publication status after publish; it relies on the returned `post` or on the next full list load. If publishing is asynchronous, returning `post` with `publication_status: 'publishing'` and corresponding `platform_publications[].status: 'publishing'` is enough for the UI to show "Publishing in progress" until the user refreshes or navigates.

---

## 8. Errors

| Case | HTTP | Frontend behavior |
|------|------|--------------------|
| Not authenticated | 401 | Shows error message; does not update list. |
| Post not found / no access | 404 | Shows error message. |
| Invalid or disconnected platform | 400 / 4xx | Shows `error.message` or "Failed to publish post." |
| Server error | 500 | Shows error message or "Failed to publish/unpublish post." |

Frontend uses the same standard error response shape as elsewhere (e.g. `error.message`). No special error codes are required for this feature.

---

## 9. Checklist

- [x] Implement `POST /api/v1/posts/:id/publish` with body `{ platforms: string[] }`.
- [x] Implement `POST /api/v1/posts/:id/unpublish` with body `{ platform?: string }`; omit `platform` for "unpublish from all".
- [x] Require JWT: `Authorization: Bearer <token>`.
- [x] On success, return `{ success: true, post?: <updated post> }` with post including `publication_status` and `platform_publications` (or equivalent).
- [x] Ensure GET endpoints that return posts (e.g. post list/detail) include the same publication metadata so the dashboard status column stays correct after refetch.
- [x] Use platform keys consistently (e.g. `wordpress`, `medium`) so the frontend can match "connected platforms" in the publish modal.
- [ ] (Optional) Provide `label` and `url` per platform in `platform_publications` for clearer UI and clickable links.

---

## Quick reference

| Purpose | Endpoint | Body |
|--------|----------|------|
| Publish to selected platforms | `POST /api/v1/posts/:id/publish` | `{ "platforms": ["wordpress", "medium"] }` |
| Unpublish from one or all | `POST /api/v1/posts/:id/unpublish` | `{ "platform": "wordpress" }` or `{}` for all |

All require `Authorization: Bearer <JWT>`.

**Post response:** Include `publication_status` and `platform_publications` (each with `platform`, `status`, and optionally `label`, `url`) in the post object when returning updated post data.
