# WordPress publish configuration — handoff for fixing

Use this handoff when fixing or debugging **WordPress connection and publish** so that the Automate My Blog backend can successfully create posts on the user’s WordPress site.

---

## 1. What the backend does

- **Connect (store credentials):** `POST /api/v1/publishing-platforms/connect` with `platform: "wordpress"`, `site_url`, `username`, `application_password`, and optionally `use_index_php_rest_route: true`. Credentials are stored encrypted.
- **Publish:** When the user publishes a post to WordPress, the backend calls the WordPress REST API to create a post:
  - **URL:** Either `{site_url}/wp-json/wp/v2/posts` (default) or `{site_url}/index.php?rest_route=/wp/v2/posts` (when `useIndexPhpRestRoute` is true in stored credentials).
  - **Method:** POST.
  - **Auth:** HTTP Basic using `username` and `application_password`.
  - **Body:** JSON `{ "title": "...", "content": "...", "status": "publish" | "draft" }`.
- **Expected response:** JSON with `id` and `link` (or `guid.rendered`). The backend parses this with `response.json()` and then returns the post URL to the client.

Relevant code: `services/wordpress-publish.js`, `routes/publishing-platforms.js` (WordPress connect block), `routes/posts.js` (publish handler that calls `publishToWordPress`).

---

## 2. Two REST URL formats

Many WordPress installs use “pretty” permalinks and expose the REST API at:

- `https://example.com/blog/wp-json/wp/v2/posts`

Some installs (e.g. no pretty permalinks, or custom routing) expect:

- `https://example.com/blog/index.php?rest_route=/wp/v2/posts`

The backend supports both:

- **Default:** Uses `{site_url}/wp-json/wp/v2/posts`. If the response is **404**, it retries once with `{site_url}/index.php?rest_route=/wp/v2/posts`.
- **Optional:** If the user reconnects with `use_index_php_rest_route: true`, the backend uses the `index.php?rest_route=` URL on the first request (no retry needed).

So “fixing the configuration” can mean:

1. **Setting `site_url` correctly** — Base URL of the WordPress site only (e.g. `https://samjhill.com/blog`), with no path like `/wp-json/...` or `/index.php?rest_route=...`.
2. **Using the right REST style** — If the site only answers at `index.php?rest_route=`, the user must reconnect with `use_index_php_rest_route: true` (or the backend will try pretty first and retry on 404).
3. **Ensuring WordPress returns JSON** — The backend expects a JSON response. If WordPress (or a plugin/server in front) returns HTML (e.g. a login or error page), the backend will fail with something like “Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON”.

---

## 3. How to verify WordPress from the command line

Replace `SITE_URL`, `USERNAME`, and `APP_PASSWORD` with the real values. Use the same URL style the backend would use.

**If the site uses index.php?rest_route=:**

```bash
curl -v -X POST "https://SITE_URL/index.php?rest_route=/wp/v2/posts" \
  -u "USERNAME:APP_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","content":"Test","status":"draft"}'
```

**If the site uses pretty permalinks:**

```bash
curl -v -X POST "https://SITE_URL/wp-json/wp/v2/posts" \
  -u "USERNAME:APP_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","content":"Test","status":"draft"}'
```

**Success:** HTTP 201 and a JSON body with `id`, `link`, etc.  
**Failure:** 401 (bad credentials), 403 (forbidden), 404 (wrong URL or REST disabled), or 200 with an HTML body (wrong endpoint or something overriding the REST API).

---

## 4. Common failures and how to fix them

| Symptom | Likely cause | Fix |
|--------|----------------|-----|
| **404** “WordPress REST API not found” | Wrong URL or REST not available at that path. | Use the other URL style. Reconnect with `use_index_php_rest_route: true` if the site expects `index.php?rest_route=`. Ensure REST API is enabled (default in WP). |
| **403** “WordPress returned 403” | Server or plugin blocking the request; or user can’t create posts. | Ensure the WordPress user has at least Editor role; use an Application Password created for that user; temporarily disable security/“disable REST” plugins; check server/proxy rules. |
| **HTML instead of JSON** (“Unexpected token '<', \"<!DOCTYPE \"...”) | WordPress (or proxy) returned an HTML page with a 2xx status instead of REST JSON. | Confirm the exact REST URL with curl (see above). If curl gets JSON, the stored `site_url` or REST style may be wrong. If curl gets HTML, fix WordPress/server (permalinks, REST routing, plugins, or proxy) so the REST endpoint returns JSON. |
| **401** “WordPress rejected credentials” | Bad username or Application Password. | Recreate the Application Password in WP (Users → Profile → Application Passwords) and reconnect in the app with the new password. |

---

## 5. Reconnecting WordPress with the index.php option

If the site requires `index.php?rest_route=` for the REST API, the user must reconnect and set the option so the backend uses that URL on the first request.

**Via API (e.g. for testing or a script):**

```bash
curl -X POST "https://BACKEND_URL/api/v1/publishing-platforms/connect" \
  -H "Authorization: Bearer JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "wordpress",
    "site_url": "https://samjhill.com/blog",
    "username": "WP_USERNAME",
    "application_password": "WP_APP_PASSWORD",
    "use_index_php_rest_route": true
  }'
```

Replace `BACKEND_URL`, `JWT`, `WP_USERNAME`, and `WP_APP_PASSWORD`. After a successful 200, the next publish will use `{site_url}/index.php?rest_route=/wp/v2/posts`.

**Via frontend:** The connect form should send `use_index_php_rest_route: true` when the user opts in (e.g. “Use index.php?rest_route= for REST API”). See [THIRD_PARTY_PUBLISHING_FRONTEND_HANDOFF.md](./THIRD_PARTY_PUBLISHING_FRONTEND_HANDOFF.md) for the WordPress connect body.

---

## 6. Optional backend improvements

If you are allowed to change the backend, consider:

- **Robust response handling:** Before `response.json()`, check `Content-Type` or the first bytes of the body. If the response looks like HTML (e.g. starts with `<!DOCTYPE` or `<html`), throw a clear error such as “WordPress returned an HTML page instead of JSON. Check the site URL and REST API configuration.”
- **Logging:** Log the request URL (without credentials) and response status when publish fails, to make debugging easier.

These are optional; the main fix is usually **correct `site_url`**, **correct REST URL style** (`use_index_php_rest_route` when needed), and **WordPress/server returning JSON** at that URL.

---

## 7. Quick checklist for “fix WordPress configuration”

1. Confirm **site_url** is the base URL only (e.g. `https://samjhill.com/blog`).
2. Confirm which REST URL works with **curl** (pretty vs `index.php?rest_route=`).
3. If only **index.php?rest_route=** works, reconnect with **use_index_php_rest_route: true**.
4. Ensure the WordPress user has **Editor** or **Administrator** and the **Application Password** is valid.
5. Ensure the REST endpoint returns **JSON** (not an HTML page) for the create-post request.
