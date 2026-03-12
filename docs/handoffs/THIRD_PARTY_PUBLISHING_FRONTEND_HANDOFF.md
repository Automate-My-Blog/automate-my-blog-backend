# Third-Party Publishing — Frontend Handoff

This document describes the **connection management** and **publish** APIs for third-party platforms (WordPress, Medium, Substack, Ghost). It is intended for the frontend so the dashboard can implement Settings/Integrations (connect/disconnect) and the Publish modal using the same platform keys and response shapes as the backend.

**Related:** [Direct Platform Publishing — Backend Handoff](./direct-platform-publishing-frontend-handoff.md) (publish/unpublish request shapes, post payload), [API_SPECIFICATION.md](./API_SPECIFICATION.md).

---

## Table of contents

1. [Overview](#1-overview)
2. [Platform keys](#2-platform-keys)
3. [Auth](#3-auth)
4. [List connected platforms](#4-list-connected-platforms)
5. [Connect a platform](#5-connect-a-platform)
6. [Disconnect a platform](#6-disconnect-a-platform)
7. [Medium OAuth redirect](#7-medium-oauth-redirect)
8. [Publish and post payload](#8-publish-and-post-payload)
9. [Unpublish](#9-unpublish)
10. [Errors](#10-errors)
11. [Quick reference](#11-quick-reference)

---

## 1. Overview

The backend supports:

- **Connection management** — List, connect, and disconnect one connection per platform per user (WordPress, Medium, Substack, Ghost).
- **Publish** — `POST /api/v1/posts/:id/publish` with `platforms: ["wordpress", "medium", …]`. The backend validates that each platform is connected and, for **WordPress**, performs the actual publish to the user’s site. Other platforms (Medium, Substack, Ghost) are accepted and stored as “publishing” until backend support is added.

Use the **same platform keys** everywhere: Publish modal, Settings/Integrations, and in `platform_publications` on the post.

---

## 2. Platform keys

Use these **lowercase** keys in all API requests and when matching responses.

| Key         | Label    |
|------------|----------|
| `wordpress` | WordPress |
| `medium`    | Medium    |
| `substack`  | Substack  |
| `ghost`     | Ghost     |

---

## 3. Auth

All publishing connection endpoints require a logged-in user (JWT).

- **Header:** `Authorization: Bearer <accessToken>`
- **401** if not authenticated → show error and do not update connection state.

The **Medium OAuth callback** is the only publishing-related URL that does **not** use the JWT; the user is redirected there by Medium after authorizing.

---

## 4. List connected platforms

### Request

```http
GET /api/v1/publishing-platforms/connections
Authorization: Bearer {token}
```

### Response (200)

```json
{
  "connections": [
    {
      "platform": "wordpress",
      "label": "WordPress",
      "connected": true,
      "site_name": null,
      "site_url": "https://myblog.com",
      "account": "wpuser"
    },
    {
      "platform": "medium",
      "label": "Medium",
      "connected": true,
      "account": "johndoe"
    }
  ]
}
```

| Field       | Type    | Notes |
|------------|---------|--------|
| `platform` | string  | Key: `wordpress`, `medium`, `substack`, `ghost`. |
| `label`    | string  | Human-readable name. |
| `connected`| boolean | Always `true` in this list (only connected platforms are returned). |
| `site_name`| string  | Optional. WordPress/Ghost site name. |
| `site_url` | string  | Optional. WordPress/Ghost/Substack base URL. |
| `account`  | string  | Optional. WordPress username (when set on connect), or Medium/Substack account or publication identifier. |

Use this list to:

- Show which platforms are connected in **Settings / Integrations**.
- Restrict or highlight options in the **Publish modal** to connected platforms only (or show all and rely on backend 400 if user selects an unconnected one).

---

## 5. Connect a platform

### Endpoint

```http
POST /api/v1/publishing-platforms/connect
Authorization: Bearer {token}
Content-Type: application/json
```

All connect requests include `platform` in the body. Other fields depend on the platform.

---

### WordPress

**Body:**

```json
{
  "platform": "wordpress",
  "site_url": "https://myblog.com",
  "username": "wpuser",
  "application_password": "xxxx xxxx xxxx xxxx",
  "use_index_php_rest_route": false
}
```

| Field                       | Type    | Required | Notes |
|-----------------------------|---------|----------|--------|
| `site_url`                 | string  | Yes      | Base URL of the WordPress site (no trailing slash). |
| `application_password`     | string  | Yes      | Application password from WP (Users → Profile → Application Passwords). |
| `username`                 | string  | Recommended | WordPress login. **Required for publishing.** If omitted, connect succeeds but publish will fail until the user reconnects with username. |
| `use_index_php_rest_route`  | boolean | No       | If `true`, use `{site_url}/index.php?rest_route=/wp/v2/posts` instead of `{site_url}/wp-json/wp/v2/posts`. Set for WordPress installs that don’t have pretty permalinks for the REST API. |

**Response (200):** `{ "success": true, "platform": "wordpress" }`

---

### Ghost

**Body:**

```json
{
  "platform": "ghost",
  "admin_url": "https://my.ghost.io",
  "admin_api_key": "key"
}
```

| Field           | Type   | Required | Notes |
|-----------------|--------|----------|--------|
| `admin_url`     | string | Yes      | Ghost admin URL (e.g. from Ghost admin → Settings → Integrations). |
| `admin_api_key` | string | Yes      | Admin API key from the same place. |

**Response (200):** `{ "success": true, "platform": "ghost" }`

---

### Medium (OAuth)

**Body:**

```json
{
  "platform": "medium"
}
```

**Response (200):**

```json
{
  "success": true,
  "authorization_url": "https://medium.com/m/oauth/authorize?client_id=...&scope=...&state=...&response_type=code&redirect_uri=...",
  "state": "..."
}
```

**Frontend behavior:**

1. Call `POST /connect` with `{ "platform": "medium" }`.
2. On 200, **redirect the user** to `response.authorization_url` (same window or popup).
3. User authorizes on Medium; Medium redirects to the **backend callback** (see [§7](#7-medium-oauth-redirect)).
4. Backend redirects the user to your frontend with success or error query params.
5. On return to the app, **refetch** `GET /connections` to show Medium as connected.

**Response (503):** If Medium OAuth is not configured on the backend: `{ "success": false, "error": "Service unavailable", "message": "Medium OAuth is not configured (...)" }`. Show a “Coming soon” or contact-admin message.

---

### Substack

**Body:**

```json
{
  "platform": "substack",
  "api_key": "sk_...",
  "publication_url": "https://yoursubstack.substack.com"
}
```

| Field             | Type   | Required | Notes |
|-------------------|--------|----------|--------|
| `api_key`         | string | Yes      | From [Substack API Key Generator](https://auth.substackapi.dev/). |
| `publication_url` | string | No       | Publication URL for display. |

**Response (200):** `{ "success": true, "platform": "substack" }`

---

## 6. Disconnect a platform

### Request

```http
DELETE /api/v1/publishing-platforms/{platform}/disconnect
Authorization: Bearer {token}
```

`:platform` is one of: `wordpress`, `medium`, `substack`, `ghost`.

**Example:** `DELETE /api/v1/publishing-platforms/wordpress/disconnect`

### Response (200)

```json
{
  "success": true
}
```

Refetch the connections list so the UI no longer shows that platform as connected.

### Response (404)

Platform is not connected for this user. Body includes `error` and `message` (e.g. “WordPress is not connected for this account”). Show “Not connected” or similar.

### Response (400)

Invalid platform key. Show `error.message` (e.g. “Unknown platform”).

---

## 7. Medium OAuth redirect

After the user authorizes on Medium, the backend callback runs (no JWT). The backend then **redirects the browser** to your frontend with query params.

**Success:**

- URL: `{FRONTEND_URL}/settings?publishing=connected&platform=medium`  
  (Backend uses `FRONTEND_URL` env; default `http://localhost:3000`.)

**Error:**

- URL: `{FRONTEND_URL}/settings?publishing=error&message={encodedMessage}`

**Frontend behavior:**

- On load (or in a dedicated “publishing callback” route), read `publishing` and `message` (and optional `platform`) from the query string.
- If `publishing=connected` → show success toast; refetch `GET /connections`.
- If `publishing=error` → show `message` (decode URI component) as an error toast or inline message.
- Optionally clear the query string from the URL after handling so the message is not shown again on refresh.

---

## 8. Publish and post payload

### Publish request

Same as in [Direct Platform Publishing — Backend Handoff](./direct-platform-publishing-frontend-handoff.md):

```http
POST /api/v1/posts/{post_id}/publish
Authorization: Bearer {token}
Content-Type: application/json

{
  "platforms": ["wordpress", "medium"]
}
```

- Backend validates that **every** platform in `platforms` is connected for the user.
- If any is not connected → **400** with message like: “The following platform(s) are not connected for your account. Connect them in Settings first: …”

### Publish response (200)

Backend returns the **updated post** with publication metadata. For **WordPress**, the backend performs the publish to the user’s site and returns the result in `platform_publications`.

```json
{
  "success": true,
  "post": {
    "id": "...",
    "title": "...",
    "content": "...",
    "publication_status": "published",
    "platform_publications": [
      {
        "platform": "wordpress",
        "status": "published",
        "url": "https://myblog.com/2025/03/my-post/"
      },
      {
        "platform": "medium",
        "status": "publishing"
      }
    ]
  }
}
```

### Per-platform status

| `status`     | Meaning |
|-------------|---------|
| `published` | Backend successfully published (WordPress). Use `url` when present as the link for the platform tag. |
| `publishing`| Accepted but not yet published by backend (e.g. Medium, Substack, Ghost). |
| `failed`    | Publish attempt failed. Optional `message` contains the error (e.g. “WordPress rejected credentials”). |

### Overall `publication_status`

- `draft` — No platforms published.
- `publishing` — At least one platform in progress (all returned items are `publishing`).
- `published` — At least one platform `published`.
- `failed` — At least one `failed` and none `published`.

Use `publication_status` plus `platform_publications` for the main status tag and per-platform tags (with links when `url` is set), as in the [Direct Platform Publishing handoff §6](./direct-platform-publishing-frontend-handoff.md#6-post-payload-publication-metadata).

---

## 9. Unpublish

Unchanged from the Direct Platform Publishing handoff:

- **Request:** `POST /api/v1/posts/:id/unpublish` with body `{ "platform": "wordpress" }` or `{}` for “unpublish from all”.
- **Response:** `{ success: true, post?: <updated post> }` with updated `publication_status` and `platform_publications`.

No connection-specific behavior; same JWT and error handling as publish.

---

## 10. Errors

| Case | HTTP | Frontend behavior |
|------|------|--------------------|
| Not authenticated | 401 | Show error; do not update connection list or post. |
| Invalid platform key | 400 | Show `error.message` (e.g. “Unknown platform”). |
| Invalid connect body (missing required field) | 400 | Show `message` (e.g. “WordPress connection requires site_url and application_password”). |
| Platform not connected (publish) | 400 | Show message listing unconnected platforms; suggest connecting in Settings. |
| Platform already connected (N/A for current backend) | — | Backend upserts; no 409. |
| Connection not found (disconnect) | 404 | Show “Not connected”. |
| Medium OAuth not configured | 503 | Show “Medium connect not available” or similar. |
| Server / provider error | 500 | Show generic error message. |

Use the same standard error shape as elsewhere (`success: false`, `error`, `message`). No special error codes required.

---

## 11. Quick reference

| Purpose | Method | Endpoint | Body (key fields) |
|--------|--------|----------|--------------------|
| List connections | GET | `/api/v1/publishing-platforms/connections` | — |
| Connect WordPress | POST | `/api/v1/publishing-platforms/connect` | `platform`, `site_url`, `username`, `application_password` |
| Connect Ghost | POST | `/api/v1/publishing-platforms/connect` | `platform`, `admin_url`, `admin_api_key` |
| Connect Medium | POST | `/api/v1/publishing-platforms/connect` | `platform: "medium"` → use `authorization_url` to redirect |
| Connect Substack | POST | `/api/v1/publishing-platforms/connect` | `platform`, `api_key`, `publication_url`? |
| Disconnect | DELETE | `/api/v1/publishing-platforms/:platform/disconnect` | — |
| Publish | POST | `/api/v1/posts/:id/publish` | `platforms: ["wordpress", "medium", …]` |
| Unpublish | POST | `/api/v1/posts/:id/unpublish` | `platform?` (omit for all) |

**Platform keys:** `wordpress`, `medium`, `substack`, `ghost` — use consistently in connections list, connect/disconnect, and publish.

**Medium callback:** Backend redirects to `{FRONTEND_URL}/settings?publishing=connected&platform=medium` or `?publishing=error&message=...`. Handle on the frontend and refetch connections.

**Post after publish:** Response includes `post.publication_status` and `post.platform_publications[]` with `platform`, `status`, and optionally `url` (WordPress) or `message` (on failure).
