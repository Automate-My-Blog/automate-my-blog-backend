# Social handles — frontend handoff (pasteable)

**Base:** `https://automate-my-blog-backend.vercel.app/api/v1/organizations` (or your API_BASE)

**Auth:** Same as analysis/jobs — send one of:
- `Authorization: Bearer <JWT>` (logged in)
- `x-session-id: <sessionId>` (anonymous funnel; org must be linked to this session from website analysis)

Without either → **401** "Provide Authorization header or x-session-id."

---

**1. GET social handles**

`GET /api/v1/organizations/:organizationId/social-handles`

Response 200:
```json
{ "success": true, "social_handles": { "twitter": ["@acme"], "linkedin": ["in/slug"], "github": ["acme"] } }
```
Empty = `social_handles: {}`.

---

**2. PATCH social handles (manual edit)**

`PATCH /api/v1/organizations/:organizationId/social-handles`  
Body: `{ "social_handles": { "twitter": ["@handle"], "linkedin": ["company/slug"], ... } }`  
Backend replaces the whole object — send full object to keep other platforms.

Response 200: `{ "success": true, "social_handles": { ... } }`

---

**3. POST refresh (re-scrape website for handles)**

`POST /api/v1/organizations/:organizationId/refresh-social-voice`  
No body. Org must have `website_url` set.

Response 200: `{ "success": true, "social_handles": { ... }, "message": "Found and saved N platform(s)." }`  
If none found: `social_handles: {}`, message "No social handles found on the website."

---

**Platform keys (examples):** `twitter`, `linkedin`, `github`, `instagram`, `facebook`, `youtube`, `tiktok`, `reddit`, `pinterest`, `medium`, `substack`, `mastodon`, `threads`, `bluesky`, `tumblr`, `vimeo`, `dribbble`, `behance`, `soundcloud`, `twitch`, `telegram`, `patreon`, `linktree`, `snapchat`, `kofi`, `buymeacoffee`, `discord`

**When populated:** Handles are discovered during website analysis (no extra call). Use GET to show them after analysis; optional "Refresh" and "Edit" buttons call POST and PATCH.
