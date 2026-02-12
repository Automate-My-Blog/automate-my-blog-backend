# Social handles — frontend handoff

This document describes the **social media handles** feature: how handles are discovered, stored, and exposed so the frontend can display and edit them. They are used (in a later phase) to tailor blog post voice from social content.

**Related:** [brand-voice-from-social-media-proposal.md](./brand-voice-from-social-media-proposal.md)

---

## 1. Overview

- **Discovery:** When the backend runs **website analysis** (scrape + analyze), it extracts links from the page that point to known social platforms (Twitter/X, LinkedIn, Facebook, Instagram, YouTube, TikTok), parses them into **handles**, and saves them on the organization.
- **Storage:** `organizations.social_handles` (JSONB). Shape: `{ "twitter": ["@acme"], "linkedin": ["company/acme"], "instagram": ["acme"], ... }`. Each key is a platform; each value is an array of handle strings (usually one per platform).
- **APIs:** The frontend can **read** handles, **override** them (manual edit), and **re-run discovery** from the org’s website.

---

## 2. When are handles populated?

| Event | What happens |
|-------|----------------|
| **Website analysis** (job or sync) | Backend scrapes the site, collects social links from all `<a href="...">`, normalizes to handles, and persists `social_handles` on the organization. No extra frontend call needed. |
| **Refresh social voice** | Frontend calls `POST …/refresh-social-voice` to re-scrape the org’s `website_url` and overwrite `social_handles` with newly discovered handles. |
| **Manual edit** | Frontend calls `PATCH …/social-handles` with the desired `social_handles` object. |

After the first website analysis, you can show handles from `GET …/social-handles` and optionally allow “Refresh” and “Edit.”

---

## 3. API reference

Base path: **`/api/v1/organizations`**  
Auth: **JWT or session** (same as analysis/jobs):
- **Logged in:** `Authorization: Bearer <JWT>`
- **Anonymous funnel:** `x-session-id: <sessionId>` (org must be linked to this session from website analysis)

If neither is provided, the API returns **401** with message `Provide Authorization header or x-session-id.`  
`organizationId` is the organization UUID (e.g. from website analysis result).

---

### 3.1 Get social handles

**Request**

- **Method:** `GET`
- **URL:** `${API_BASE}/api/v1/organizations/:organizationId/social-handles`

**Response (200)**

```json
{
  "success": true,
  "social_handles": {
    "twitter": ["@acme"],
    "linkedin": ["company/acme"],
    "instagram": ["acme"]
  }
}
```

`social_handles` may be `{}` if none have been discovered or set.

**Errors:** `404` (organization not found), `500` (server error).

---

### 3.2 Set social handles (manual override)

**Request**

- **Method:** `PATCH`
- **URL:** `${API_BASE}/api/v1/organizations/:organizationId/social-handles`
- **Body:**

```json
{
  "social_handles": {
    "twitter": ["@acme"],
    "linkedin": ["company/acme"],
    "instagram": ["acme"],
    "youtube": ["@acme"]
  }
}
```

- **Rules:** `social_handles` must be an object. Each value must be an array of strings. Omitted platforms are left unchanged only if you merge on the frontend; the backend **replaces** the entire `social_handles` with the body (so send the full object if you want to preserve other platforms).

**Response (200)**

```json
{
  "success": true,
  "social_handles": {
    "twitter": ["@acme"],
    "linkedin": ["company/acme"],
    "instagram": ["acme"],
    "youtube": ["@acme"]
  }
}
```

**Errors:** `400` (invalid body: not an object, or a value not an array of strings), `404` (organization not found), `500` (server error).

---

### 3.3 Refresh social handles (re-run discovery)

Re-scrapes the organization’s `website_url` and overwrites `social_handles` with discovered handles.

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/organizations/:organizationId/refresh-social-voice`

**Response (200)**

```json
{
  "success": true,
  "social_handles": {
    "twitter": ["@acme"],
    "linkedin": ["company/acme"]
  },
  "message": "Found and saved 2 platform(s)."
}
```

If no social links are found:

```json
{
  "success": true,
  "social_handles": {},
  "message": "No social handles found on the website."
}
```

**Errors:** `400` (organization has no `website_url`), `404` (organization not found), `500` (scrape or server error).

---

## 4. Data shape (social_handles)

| Platform       | Example key     | Example value(s)        | Notes |
|----------------|-----------------|-------------------------|--------|
| Twitter/X      | `twitter`       | `["@username"]`         | Leading `@` optional in storage. |
| LinkedIn       | `linkedin`      | `["company/slug"]`, `["in/profile-slug"]` | Company or personal profile. |
| Facebook       | `facebook`      | `["PageName"]`          | Page username or ID. |
| Instagram      | `instagram`     | `["username"]`          | No `@` in value. |
| YouTube        | `youtube`       | `["@handle"]`, `["c/Name"]`, or `["channel/ID"]` | Channel handle or ID. |
| TikTok         | `tiktok`        | `["@username"]`         | |
| GitHub         | `github`        | `["username"]`          | User or org login. |
| Reddit         | `reddit`        | `["username"]`          | From /user/ or /u/ URLs. |
| Pinterest      | `pinterest`     | `["username"]`          | |
| Medium         | `medium`        | `["@username"]` or `["publication"]` | |
| Substack       | `substack`      | `["@username"]` or `["blogname"]` | blogname from subdomain. |
| Mastodon       | `mastodon`      | `["instance.social/@user"]` | Instance + handle. |
| Threads        | `threads`       | `["@username"]`         | Meta’s Threads. |
| Bluesky        | `bluesky`       | `["handle.bsky.social"]`| |
| Tumblr         | `tumblr`        | `["blogname"]`          | |
| Vimeo          | `vimeo`         | `["username"]`          | |
| Dribbble       | `dribbble`      | `["username"]`          | |
| Behance        | `behance`       | `["username"]`          | |
| SoundCloud     | `soundcloud`    | `["username"]`          | |
| Twitch         | `twitch`        | `["username"]`          | |
| Telegram       | `telegram`      | `["username"]`          | From t.me links. |
| Patreon        | `patreon`       | `["username"]`          | |
| Linktree       | `linktree`      | `["username"]`          | linktr.ee. |
| Snapchat       | `snapchat`      | `["username"]`          | From snapchat.com/add/. |
| Ko-fi          | `kofi`          | `["username"]`          | ko-fi.com. |
| Buy Me a Coffee| `buymeacoffee`  | `["username"]`          | |
| Discord        | `discord`       | `["userId"]`            | From discord.com/users/ (numeric ID). |

Frontend can display per-platform and allow add/remove per platform; when calling PATCH, send the full `social_handles` object you want stored.

---

## 5. Suggested UI flow

1. **After website analysis:** Call `GET …/social-handles` and show “Social profiles” (or “Brand social”) with chips/links per platform. If empty, show “No social links found on your site” and a “Refresh” button.
2. **Refresh:** On “Refresh,” call `POST …/refresh-social-voice`; then call `GET …/social-handles` (or use the response body) to update the list.
3. **Edit:** Let the user add/remove/edit handles per platform; on save, call `PATCH …/social-handles` with the full object.

No changes are required to the website-analysis job or stream: discovery and storage are already part of the backend pipeline.
