# Publishing OAuth — Frontend handoff

This doc describes what the frontend must do to support **OAuth-based publishing connections** after the backend implements OAuth for Medium, Shopify, Webflow, Squarespace, Wix, HubSpot, and Drupal. Use it with your existing **INTEGRATION_BACKEND_HANDOFF** and **DIRECT_PLATFORM_PUBLISHING_BACKEND_HANDOFF** in `docs/publishing/`.

---

## 1. Connect request by platform

All OAuth platforms use the same endpoint: `POST /api/v1/publishing-platforms/connect` with `Authorization: Bearer <token>` (or session cookie). The **request body** differs by platform.

| Platform   | Request body | Notes |
|-----------|--------------|--------|
| **Medium** | `{ "platform": "medium" }` | No extra fields. |
| **Shopify** | `{ "platform": "shopify", "shop": "your-store.myshopify.com" }` or `{ "platform": "shopify", "shop": "your-store" }` | **Required:** `shop` (store domain or store name). Backend normalizes to `*.myshopify.com`. |
| **Webflow** | `{ "platform": "webflow" }` | No extra fields. |
| **Squarespace** | `{ "platform": "squarespace" }` | No extra fields. |
| **Wix** | `{ "platform": "wix" }` | No extra fields. |
| **HubSpot** | `{ "platform": "hubspot" }` | No extra fields. |
| **Drupal** | `{ "platform": "drupal", "site_url": "https://mysite.com" }` | **Required:** `site_url` (base URL of the Drupal site with OAuth2 enabled). |

**Response (success):**  
`{ "success": true, "authorization_url": "https://...", "state": "..." }`  

**Frontend action:**  
`window.location.href = response.authorization_url` so the user is sent to the provider to authorize. The user then returns to your app via the **callback** (see §2).

**Response (error):**  
- **400** — Missing required field (e.g. `shop` for Shopify, `site_url` for Drupal). Show `error.message`.  
- **503** — OAuth not configured for that platform (missing env vars). Show `message` and suggest contacting support or try another platform.

---

## 2. Callback handling (after user authorizes)

The backend handles the provider’s redirect to its callback URL, exchanges the code for tokens, stores them, then **redirects the user to the frontend** with query params. The frontend does **not** call the backend again; it only reads the URL and refetches connections.

**Success redirect:**  
`{FRONTEND_URL}/settings?publishing=connected&platform={platform}`  

Example: `https://app.example.com/settings?publishing=connected&platform=medium`

**Error redirect:**  
`{FRONTEND_URL}/settings?publishing=error&message={encoded_message}`  

Example: `https://app.example.com/settings?publishing=error&message=Access%20denied`

**Frontend responsibilities:**

1. On load (e.g. Settings or Integrations page), read `publishing` and `platform` / `message` from the query string.
2. If `publishing === 'connected'` and `platform` is set:
   - Show a success message (e.g. “Connected to {platform}”).
   - Refetch `GET /api/v1/publishing-platforms/connections`.
   - Remove the query params from the URL (e.g. replaceState or navigate to clean URL).
3. If `publishing === 'error'`:
   - Show `message` (decode URI component) as an error toast or inline message.
   - Refetch connections.
   - Remove the query params.

**Callback paths (for reference; frontend does not call these):**

- Medium: `GET /api/v1/publishing-platforms/medium/callback`
- Shopify: `GET /api/v1/publishing-platforms/shopify/callback`
- Webflow: `GET /api/v1/publishing-platforms/webflow/callback`
- Squarespace: `GET /api/v1/publishing-platforms/squarespace/callback`
- Wix: `GET /api/v1/publishing-platforms/wix/callback`
- HubSpot: `GET /api/v1/publishing-platforms/hubspot/callback`
- Drupal: `GET /api/v1/publishing-platforms/drupal/callback`

---

## 3. List connections

`GET /api/v1/publishing-platforms/connections` returns all 16 platform keys with `connected: true/false`. For OAuth platforms, when connected you may see:

- `platform`, `connected: true`, optional `account`, `site_name`, `site_url`

No change required if you already consume this shape.

---

## 4. Disconnect

`DELETE /api/v1/publishing-platforms/:platform/disconnect` works for all platforms, including OAuth ones. Use the **platform key** in the path (e.g. `medium`, `shopify`, `webflow`, `squarespace`, `wix`, `hubspot`, `drupal`).

---

## 5. UI changes summary

| Area | Change |
|------|--------|
| **Connect – Medium** | Already: body `{ "platform": "medium" }` → redirect to `authorization_url`. No change. |
| **Connect – Shopify** | Send **`shop`** with platform. e.g. input or dropdown for store name/domain, then body `{ "platform": "shopify", "shop": userInput }`. |
| **Connect – Drupal** | Send **`site_url`** with platform. e.g. input for Drupal site URL, then body `{ "platform": "drupal", "site_url": "https://mysite.com" }`. |
| **Connect – Webflow, Squarespace, Wix, HubSpot** | Body `{ "platform": "webflow" }` (etc.). No extra fields. Same “Connect with {Platform}” → redirect flow as Medium. |
| **Callback handling** | On app load, read `publishing`, `platform`, `message`; show success/error; refetch connections; clean URL. Same for all OAuth platforms. |
| **Platform labels** | Use existing labels (e.g. `PLATFORM_LABELS.medium` = `"Medium"`). |

---

## 6. Quick reference

| Action | Method | Endpoint / body |
|--------|--------|------------------|
| Start connect (Medium, Webflow, Squarespace, Wix, HubSpot) | POST | `/api/v1/publishing-platforms/connect` — body: `{ "platform": "medium" }` (or webflow, squarespace, wix, hubspot) → response: `{ "authorization_url", "state" }` |
| Start connect (Shopify) | POST | `/api/v1/publishing-platforms/connect` — body: `{ "platform": "shopify", "shop": "store.myshopify.com" }` → `{ "authorization_url", "state" }` |
| Start connect (Drupal) | POST | `/api/v1/publishing-platforms/connect` — body: `{ "platform": "drupal", "site_url": "https://mysite.com" }` → `{ "authorization_url", "state" }` |
| After OAuth | — | User lands on frontend with `?publishing=connected&platform=...` or `?publishing=error&message=...`. Frontend shows message, refetches connections, cleans URL. |
| List | GET | `/api/v1/publishing-platforms/connections` |
| Disconnect | DELETE | `/api/v1/publishing-platforms/{platform}/disconnect` |

All requests use the same auth as the rest of the app (session cookie or `Authorization: Bearer <token>`).
