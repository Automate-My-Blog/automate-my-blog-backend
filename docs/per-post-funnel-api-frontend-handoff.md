# Per-post funnel API — Frontend handoff (issue #504)

Backend support for [automate-my-blog-frontend#504](https://github.com/Automate-My-Blog/automate-my-blog-frontend/issues/504): **per-post funnel metrics** (Search Impressions → Search Clicks → Time on Site → Internal Links Clicked → CTA Clicks) with optional date range.

---

## 1. Endpoint

**GET** `/api/v1/google/funnel`

**Auth:** Required. Send `Authorization: Bearer <accessToken>`.

**Query parameters:**

| Parameter   | Required | Description |
|------------|----------|-------------|
| `pageUrl`  | Yes      | The post’s URL. Use the same value you use in GSC (often full URL) and for GA (often path). If GSC and GA use different formats, the backend uses this single value for both; for best results use the format that matches your GSC property (e.g. `https://example.com/blog/my-post` or `/blog/my-post`). |
| `siteUrl`  | Yes      | Site URL as in Google Search Console (e.g. `https://example.com` or `sc-domain:example.com`). |
| `propertyId` | Yes    | GA4 Property ID (numeric). |
| `startDate` | Yes     | Start of date range (YYYY-MM-DD). |
| `endDate`  | Yes      | End of date range (YYYY-MM-DD). |

**Example:**

```
GET /api/v1/google/funnel?pageUrl=%2Fblog%2Fmy-post&siteUrl=https%3A%2F%2Fexample.com&propertyId=123456789&startDate=2025-01-01&endDate=2025-01-31
```

---

## 2. Response shape

**200 OK**

```json
{
  "success": true,
  "funnel": {
    "search_impressions": 1250,
    "search_clicks": 89,
    "time_on_site_seconds": 142,
    "internal_links_clicked": 12,
    "cta_clicks": 5
  },
  "meta": {
    "start_date": "2025-01-01",
    "end_date": "2025-01-31",
    "gsc_connected": true,
    "ga_connected": true
  }
}
```

- **Funnel fields:** Each is either a number or `null`.  
  - **Number:** Value for that metric in the date range (may be `0` if no data).  
  - **`null`:** That source is not connected (e.g. `search_impressions`/`search_clicks` are `null` if GSC is not connected; GA fields are `null` if GA is not connected).
- **`meta.gsc_connected` / `meta.ga_connected`:** Whether the user has connected Google Search Console and/or Google Analytics. Use for empty states and “Connect Google” prompts.

---

## 3. Funnel stages (issue #504 mapping)

| Stage                  | Source           | Response field             | Notes |
|------------------------|------------------|----------------------------|--------|
| Search Impressions     | Google Search Console | `funnel.search_impressions` | Times the post appeared in search results. |
| Search Clicks          | Google Search Console | `funnel.search_clicks`      | Clicks from search to the post. |
| Time on Site           | Google Analytics | `funnel.time_on_site_seconds` | Average engagement time on the post (seconds). |
| Internal Links Clicked| Google Analytics (events) | `funnel.internal_links_clicked` | Requires GA4 event `internal_link_click` on that page. |
| CTA Clicks             | Google Analytics (events) | `funnel.cta_clicks`           | Requires GA4 event `cta_click` on that page. |

---

## 4. GA4 events for Internal Links and CTA

`internal_links_clicked` and `cta_clicks` come from GA4 **event names**:

- **`internal_link_click`** — fires when a user clicks a link in the post that goes to another page on the same site.
- **`cta_click`** — fires when a user clicks a CTA (button/link) in the post.

If these events are not implemented in your site’s GA4 tagging, the backend will return `0` for those fields. To get real data:

1. In your site’s GA4 tag (e.g. gtag or GTM), send events with exactly these names when the corresponding actions happen.
2. Example (gtag):  
   `gtag('event', 'internal_link_click', { page_path: window.location.pathname });`  
   `gtag('event', 'cta_click', { page_path: window.location.pathname });`

---

## 5. Date range

- Frontend should send `startDate` and `endDate` (YYYY-MM-DD). Typical presets: last 7d, 30d, 90d.
- The backend does not apply a default range; always send both parameters.

---

## 6. Errors and edge cases

| Status | Meaning |
|--------|--------|
| **400** | Missing one of: `pageUrl`, `siteUrl`, `propertyId`, `startDate`, `endDate`. Response body includes `error`. |
| **401** | Missing or invalid JWT, or OAuth token expired. If `needsReconnect: true`, prompt the user to reconnect Google (GSC or GA) in settings. |
| **500** | Server or Google API error. Show a generic error and optionally retry. |

**Empty / no data:**  
- If a stage has no data in the date range, the backend returns `0` for that stage (when the corresponding integration is connected).  
- If an integration is not connected, the corresponding funnel fields are `null` and `meta.gsc_connected` or `meta.ga_connected` is `false`.  
Use this for:

- **Empty state:** e.g. “No funnel data yet” when all numeric values are 0 but both are connected.  
- **Connect prompts:** e.g. “Connect Search Console to see search metrics” when `gsc_connected` is false, and similarly for Analytics.

---

## 7. Where to get `siteUrl` and `propertyId`

- **siteUrl:** From your app’s organization/site settings (e.g. primary website URL). Must match the URL style used in the user’s Search Console property (with or without scheme, or `sc-domain:...`).
- **propertyId:** From your app’s settings where the user configures GA4 (e.g. “Connect Analytics” or “GA4 Property ID”). Stored per user or per org depending on your product.

The backend does not infer these; the frontend must pass them on every request.

---

## 8. Checklist for frontend

- [ ] Call **GET** `/api/v1/google/funnel` with `pageUrl`, `siteUrl`, `propertyId`, `startDate`, `endDate` and JWT.
- [ ] Use `funnel.*` for the five stages; treat `null` as “not available (integration not connected)” and numbers as “value (or 0)”.
- [ ] Use `meta.gsc_connected` and `meta.ga_connected` for empty states and “Connect Google” / “Reconnect” prompts.
- [ ] Support at least one date range (e.g. last 30 days); ideally 7d / 30d / 90d.
- [ ] If you want Internal Links and CTA counts, implement GA4 events `internal_link_click` and `cta_click` on the blog/site.

---

## 9. Related

- [Issue #504](https://github.com/Automate-My-Blog/automate-my-blog-frontend/issues/504) — Google OAuth integration and per-post funnel data.
- Backend: `routes/google-integrations.js` (GET `/funnel`), `services/google-search-console.js`, `services/google-analytics.js` (including `getPageEventCount`).
