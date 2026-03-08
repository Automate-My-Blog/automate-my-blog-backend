# Google integrations systems review

Quick audit of Google integration routes and services (Trends, Search Console, Analytics) for consistency, auth, and cache behavior.

---

## 1. OAuth status (GET /api/v1/google/oauth/status/:service)

| Service        | Auth required | Response shape | Notes |
|----------------|---------------|----------------|-------|
| trends         | Yes (JWT)     | success, connected, expires_at, scopes | No OAuth; returns connected: true, expires_at: null, scopes: [] |
| search_console | Yes (JWT)    | same           | credentials?.expires_at ?? null, credentials?.scopes ?? [] (contract test) |
| analytics      | Yes (JWT)     | same           | Same as search_console |

- **Contract test:** `tests/integration/api/contract.test.js` asserts all three return the same keys and types.
- **Doc:** `docs/API_RESPONSE_CONTRACTS.md`.

---

## 2. Trends (no OAuth; cache-backed)

| Endpoint | Auth | Behavior |
|----------|------|----------|
| GET /trends/topics | JWT | Reads from google_trends_cache; if empty, calls fetchTrendsForContentCalendar then re-queries. Default/short keywords ensure data when fallback yields long phrases. |
| POST /trends/refresh | JWT | Always calls fetchTrendsForContentCalendar (even empty strategyIds). |
| GET /trends/preview | token (query) | SSE; uses getRisingQueries (cache + API). |
| GET /trends/rising-queries, related-topics, interest-over-time | Optional | Public-style; no user cache. |

- **Cache:** `google-trends.js` getRisingQueries: cache hit only when rising_queries is non-empty; empty cache triggers refetch.
- **Content calendar:** `content-calendar-service.js` adds default short keywords when fallback yields only long phrases (> 40 chars).

---

## 3. Search Console (OAuth; live API, no cache)

| Endpoint | Auth (before fix) | Auth (after) | Notes |
|----------|-------------------|-------------|-------|
| GET /search-console/top-queries | optionalAuth → req.user.userId | **authMiddleware** | 401 when no JWT instead of 500. |
| GET /search-console/page-performance | same | **authMiddleware** | Same. |

- **Service:** `google-search-console.js` – no cache; calls Search Console API with user’s OAuth tokens.
- **Credentials:** From oauthManager.getCredentials(userId, 'google_search_console'). Service initializeAuth uses env GOOGLE_CLIENT_ID/SECRET with user tokens.

---

## 4. Analytics (OAuth; live API, no cache)

| Endpoint | Auth (before fix) | Auth (after) | Notes |
|----------|-------------------|-------------|-------|
| GET /analytics/page-performance | optionalAuth → req.user.userId | **authMiddleware** | 401 when no JWT. |
| GET /analytics/traffic-sources | same | **authMiddleware** | Same. |
| POST /analytics/compare-trend-performance | same | **authMiddleware** | Same. |

- **Service:** `google-analytics.js` – no cache; calls GA4 Data API with user’s OAuth tokens.
- **Error handling:** 401 / invalid_grant → needsReconnect: true.

---

## 5. Funnel (GSC + GA combined)

| Endpoint | Auth | Notes |
|----------|------|-------|
| GET /funnel | authMiddleware | Already protected; uses userId for GSC and GA credentials. |

---

## 6. Fix applied in this review

- **Search Console and Analytics data routes** were under `optionalAuth` but used `req.user.userId`. Unauthenticated requests would throw (500). They now use `authService.authMiddleware` so missing or invalid JWT returns **401** with a clear error.

---

## Summary

| System         | OAuth | Cache | Auth on data routes | Response contract |
|----------------|-------|-------|---------------------|--------------------|
| Trends         | No    | Yes   | JWT on topics/refresh | N/A (status shape in contract) |
| Search Console | Yes   | No    | JWT enforced        | status in contract |
| Analytics      | Yes   | No    | JWT enforced        | status in contract |

All three OAuth status endpoints share the same response shape (success, connected, expires_at, scopes); Trends cache behavior and empty-data handling are documented and covered by tests.
