# WordPress “Use index.php REST URL” — frontend handoff

**Ask:** Add a **checkbox** (or toggle) to the **WordPress connection** form that, when checked, sends `use_index_php_rest_route: true` to the backend. The backend already supports this; the frontend currently does not expose it.

---

## Why this is needed

Some WordPress installs expose the REST API only (or correctly) at:

- `https://example.com/blog/index.php?rest_route=/wp/v2/posts`

instead of the “pretty” URL:

- `https://example.com/blog/wp-json/wp/v2/posts`

If the backend uses the wrong URL, publish can fail (404 or an HTML response instead of JSON). Letting the user opt in to the `index.php?rest_route=` URL fixes that for those sites.

---

## API contract (already implemented)

**Endpoint:** `POST /api/v1/publishing-platforms/connect`

**WordPress body** (include the new optional field):

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `platform` | string | Yes | `"wordpress"` |
| `site_url` | string | Yes | Base URL of the WordPress site (no trailing slash). |
| `username` | string | Recommended | WordPress login; required for publishing. |
| `application_password` | string | Yes | Application password from WordPress. |
| **`use_index_php_rest_route`** | **boolean** | **No** | **If `true`, backend uses `{site_url}/index.php?rest_route=/wp/v2/posts` instead of `{site_url}/wp-json/wp/v2/posts`.** Default/omit = `false`. |

**Example body when the option is enabled:**

```json
{
  "platform": "wordpress",
  "site_url": "https://samjhill.com/blog",
  "username": "wpuser",
  "application_password": "xxxx xxxx xxxx xxxx",
  "use_index_php_rest_route": true
}
```

**Response (200):** `{ "success": true, "platform": "wordpress" }`

Full WordPress connect spec: [THIRD_PARTY_PUBLISHING_FRONTEND_HANDOFF.md](./THIRD_PARTY_PUBLISHING_FRONTEND_HANDOFF.md) (§ WordPress).

---

## What to build in the UI

1. **Where:** On the **WordPress connect** screen/modal (where the user enters Site URL, Username, Application password).
2. **Control:** A **checkbox** or toggle, e.g.:
   - **Label:** “Use index.php?rest_route= for REST API” or “My WordPress site uses index.php for the REST API”.
   - **Help text (optional):** “Enable if your site doesn’t use pretty permalinks for the REST API, or if publishing fails with 404/connection errors.”
3. **Behavior:** When the user submits the connect form, include `use_index_php_rest_route: true` in the request body **only if** the checkbox is checked; otherwise omit it or send `false`.
4. **Reconnect:** If the user edits/reconnects WordPress, show the same checkbox. The backend does not return this value in `GET /connections` (it’s inside encrypted credentials), so the UI cannot pre-fill “current value”. It’s fine to default the checkbox to **unchecked** each time; users who need it can check it when (re)connecting.

---

## Copy suggestions

- **Checkbox label:** “Use index.php?rest_route= for REST API”
- **Short help:** “Check if your WordPress site doesn’t support the default REST URL (e.g. no pretty permalinks) or if publish fails.”
- **Placement:** Below Site URL / Username / Application password, before the primary submit action.

---

## Summary

| Item | Detail |
|------|--------|
| **New request field** | `use_index_php_rest_route` (boolean, optional) |
| **UI** | Checkbox (or toggle) on WordPress connect form |
| **Send `true`** | When checkbox is checked on submit |
| **Send `false` or omit** | When unchecked (default) |
| **Backend** | Already supports this; no backend change required |
