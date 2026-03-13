# Debug: WordPress REST API returns 200 with HTML instead of JSON

**Give this document to Cursor (or another developer) to debug why the WordPress REST API returns an HTML page instead of JSON when creating a post.**

---

## 1. Problem summary

- **Expected:** `POST https://SITE_URL/index.php?rest_route=/wp/v2/posts` with valid WordPress Application Password returns **201** and a **JSON** body like `{"id": 123, "link": "https://..."}`.
- **Actual:** The same request returns **200** with a **HTML** body (`<!DOCTYPE html>...`). The backend (and any JSON parser) then fails with “WordPress returned an HTML page instead of JSON” or “Unexpected token '<'”.
- **Implication:** The REST API URL is being served by something that returns a normal web page (e.g. theme, redirect, or plugin) instead of the WordPress REST API handler. The fix is on the **WordPress site or server**, not in the Automate My Blog backend.

**Relevant backend code:** `services/wordpress-publish.js` (it already detects HTML and throws a clear error; the fix is to make WordPress return JSON at that URL).

---

## 2. Reproduce the issue

Use real values for the WordPress site. Replace placeholders:

- `SITE_URL` = base URL of the WordPress install, e.g. `https://samjhill.com/blog` (no trailing slash, no `/wp-json` or `index.php?...`).
- `USERNAME` = WordPress login username.
- `APP_PASSWORD` = Application Password from WordPress (Users → Profile → Application Passwords). Use the raw string with spaces, or paste without spaces; curl accepts both in `-u "user:pass"`.

**Request that currently returns 200 + HTML:**

```bash
curl -s -o /tmp/wp-out -w "%{http_code}\n" -X POST "https://SITE_URL/index.php?rest_route=/wp/v2/posts" \
  -u "USERNAME:APP_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","content":"Test","status":"draft"}'
echo "HTTP code above; body:"
head -5 /tmp/wp-out
```

**Also try the “pretty” REST URL** (some sites use this instead):

```bash
curl -s -o /tmp/wp-pretty -w "%{http_code}\n" -X POST "https://SITE_URL/wp-json/wp/v2/posts" \
  -u "USERNAME:APP_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","content":"Test","status":"draft"}'
echo "HTTP code above; body:"
head -5 /tmp/wp-pretty
```

**Success looks like:** HTTP 201 and first line of body is `{` (JSON).  
**Failure we’re debugging:** HTTP 200 and first line is `<!DOCTYPE html>` or `<html`.

Record which URL was used and what both the status code and body type (JSON vs HTML) were for each.

---

## 3. Debugging steps (in order)

Work through these on the **WordPress server/host** or via WP Admin. The goal is to find why the REST route is not being handled by WordPress’s REST API.

### 3.1 Confirm REST API is reachable (GET)

Check if the REST API responds at all with JSON:

```bash
# index.php style
curl -s -o /tmp/wp-get -w "%{http_code}\n" "https://SITE_URL/index.php?rest_route=/wp/v2" -u "USERNAME:APP_PASSWORD"
head -3 /tmp/wp-get

# pretty style
curl -s -o /tmp/wp-get-pretty -w "%{http_code}\n" "https://SITE_URL/wp-json/wp/v2" -u "USERNAME:APP_PASSWORD"
head -3 /tmp/wp-get-pretty
```

- If both return HTML: REST namespace might be disabled, wrong, or overridden site-wide.
- If one returns JSON (e.g. `{"namespace":"wp/v2",...}`): that base URL is correct; focus on why **POST** to `/wp/v2/posts` returns HTML (e.g. redirect to login, or a plugin handling the request).

### 3.2 WordPress permalinks

- In WP Admin go to **Settings → Permalinks**.
- If “Plain” is selected, the `index.php?rest_route=...` form is the standard one; if “Pretty” is selected, both `/wp-json/...` and `index.php?rest_route=...` can work depending on server rules.
- Click **Save** once (without changing anything) to refresh rewrite rules. Then re-run the curl from section 2.

### 3.3 Plugins that affect REST or routing

- **Disable plugins** that might:
  - Disable or restrict the REST API.
  - Require login/captcha for all requests (so unauthenticated or API requests get an HTML login page).
  - Change routing or “protect” the site (security/firewall plugins).
- Test with **all non-essential plugins disabled**. If the curl then returns 201 + JSON, re-enable plugins one by one and re-test until the HTML response comes back; that plugin is the cause.
- If the project uses a **staging/test copy** of the site, prefer debugging there to avoid affecting production.

### 3.4 Server / host configuration

- **.htaccess (Apache):** Ensure nothing strips `rest_route` or rewrites `index.php?rest_route=...` to a different URL that serves a page. WordPress’s default rules should pass that query string to `index.php`.
- **Nginx:** Ensure `try_files` or `location` blocks don’t send `/index.php?rest_route=...` to a static page or a different app. The request should be handled by WordPress’s `index.php` with the query string intact.
- **Reverse proxy / CDN:** Ensure they don’t replace or cache the REST response with an HTML page. If there’s a “maintenance” or “coming soon” page, ensure it’s not applied to the REST path.
- **Host-specific:** Some hosts have a “disable REST API” or “lock down XML-RPC/REST” option; ensure REST is allowed for the site (or for the path used).

### 3.5 Check what WordPress actually receives

If you have **file or database access** to the WordPress install:

- Add temporary logging in `wp-config.php` or a must-use plugin to log `$_SERVER['REQUEST_URI']` and `$_GET` for requests to `index.php` (or use the host’s request logs). Confirm that when you POST to `index.php?rest_route=/wp/v2/posts`, WordPress receives that query string. If the server rewrites the request before it hits WordPress, the REST router may never run.
- Optionally, add a minimal **must-use plugin** that runs early and, for `rest_route=/wp/v2/posts`, logs that it was hit and exits; then check whether that log appears when you run the curl. If it doesn’t, the request isn’t reaching WordPress’s REST bootstrap.

### 3.6 Theme or early hook returning HTML

- Less common, but a theme or a very early hook might send output (e.g. redirect or HTML) before the REST API runs. Try switching temporarily to a default theme (e.g. Twenty Twenty-Four) and re-running the curl. If it then returns JSON, the original theme (or something only active with it) is interfering.

---

## 4. When it’s fixed

You’re done when **the same curl that previously returned 200 + HTML** returns:

- **Status:** 201 (Created)
- **Body:** JSON, e.g. `{"id":123,"link":"https://...","title":{...},...}`

Example:

```bash
curl -s -X POST "https://SITE_URL/index.php?rest_route=/wp/v2/posts" \
  -u "USERNAME:APP_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","content":"Test","status":"draft"}'
```

Expected: first character of the response is `{`, and `id` and `link` are present.

---

## 5. After WordPress is fixed (app side)

- If the working URL is **index.php?rest_route=**: user should connect (or reconnect) WordPress in the app with **“Use index.php?rest_route= for REST API”** checked (or the equivalent API body with `use_index_php_rest_route: true`). See [WORDPRESS_INDEX_PHP_REST_OPTION_FRONTEND_HANDOFF.md](./WORDPRESS_INDEX_PHP_REST_OPTION_FRONTEND_HANDOFF.md).
- If the working URL is **wp-json**: user can leave that option unchecked. No backend change is required once WordPress returns JSON.

---

## 6. Reference

- Backend behavior and curl checks: [WORDPRESS_PUBLISH_CONFIGURATION_HANDOFF.md](./WORDPRESS_PUBLISH_CONFIGURATION_HANDOFF.md).
- Frontend “index.php” option: [WORDPRESS_INDEX_PHP_REST_OPTION_FRONTEND_HANDOFF.md](./WORDPRESS_INDEX_PHP_REST_OPTION_FRONTEND_HANDOFF.md).
