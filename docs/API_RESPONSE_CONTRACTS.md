# API response contracts and automation

This doc describes how we avoid two classes of API issues that break the frontend: **response shape inconsistency** and **cache-backed endpoints returning empty until something else runs**.

---

## 1. Response shape consistency (same endpoint family)

**Problem:** Endpoints that belong to the same "family" (e.g. `GET /api/v1/google/oauth/status/:service` for `trends`, `search_console`, `analytics`) must return the **same top-level keys** so the frontend can handle them with one code path. If one variant omits a field (e.g. `expires_at` or `scopes`), the frontend can break or show nothing for that service.

**Automation:** Contract tests enforce the shape.

- **Location:** `tests/integration/api/contract.test.js`
- **What it does:** For each service in `['trends', 'search_console', 'analytics']`, calls `GET /api/v1/google/oauth/status/:service` with a valid JWT and asserts the 200 response has required keys: `success`, `connected`, `expires_at`, `scopes` (and types: boolean, boolean, null|string, array).
- **When it runs:** With the rest of integration tests when `DATABASE_URL` is set (e.g. CI, local with test DB).
- **Adding more families:** For other endpoint families that must stay consistent, add a similar `describe` block and `it.each` over variants, asserting the same required keys.

**Guideline:** When adding a new variant to an existing endpoint family (e.g. a new Google service), return the same shape as existing variants (use `null` or `[]` for N/A fields).

---

## 2. Cache-backed read endpoints (empty until populated)

**Problem:** Endpoints that read from a cache (e.g. `GET /api/v1/google/trends/topics` from `google_trends_cache`) can return empty `data` until some other path populates the cache (e.g. POST refresh, daily cron, or a background job). The frontend then shows an empty list with no way to get data on first load.

**Mitigations (choose one or combine):**

1. **Auto-refresh on first empty**  
   When the response would be empty, check if the user has the required data (e.g. strategies with keywords); if yes, run the same logic that populates the cache (e.g. `fetchTrendsForContentCalendar`), then re-query and return. First request may be slower but returns data. Example: `GET /trends/topics` (see `routes/google-integrations.js`).

2. **Hint so the frontend can refresh**  
   When the response is empty, include a flag or message, e.g. `suggestRefresh: true` or `message: 'No data yet. Click Refresh to fetch.'`, so the UI can show a "Refresh" action that calls the refresh endpoint and then re-fetches.

3. **Document the flow**  
   In the route comment or OpenAPI, state that the endpoint is cache-backed and that data appears after the first refresh or cron run, so the frontend can call the refresh endpoint when the user opens the feature.

**Guideline:** For new read endpoints that depend on a cache or background job, prefer (1) or (2) so the first load is useful or the UI can trigger a refresh explicitly.

---

## Summary

| Problem type              | Automation / mitigation |
|---------------------------|--------------------------|
| Same-family response shape| Contract test in `contract.test.js` (required keys + types) |
| Cache-backed empty data   | Auto-refresh when empty + user has data, and/or `suggestRefresh` + docs |
