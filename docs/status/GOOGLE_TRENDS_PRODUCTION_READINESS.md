# Google Trends Integration — Production Readiness Check

**Date:** 2025-02-25  
**Scope:** `google-trends-api` usage, cache, jobs, routes, and operational concerns.

---

## Summary

| Area | Status | Notes |
|------|--------|--------|
| **Data source** | ⚠️ Risk | Unofficial API; no SLA; rate limits ~1400/4h; 429s possible |
| **Auth on API** | ❌ Gap | `/trends/rising-queries`, `/related-topics`, `/interest-over-time` are unauthenticated |
| **Cache** | ❌ Gaps | No unique constraint (ON CONFLICT ineffective); `cleanExpiredCache` never scheduled |
| **Rate limiting** | ⚠️ Partial | Job has 2s delay; no retry on 429; no HTTP rate limit on endpoints |
| **Input validation** | ⚠️ Partial | `keyword` required but length/geo/timeframe not validated |
| **Tests** | ❌ Missing | No unit or integration tests for Google Trends |
| **Observability** | ⚠️ Partial | Console logs only; no metrics or alerting on 429/failures |

---

## 1. Data Source and Rate Limits

- **Package:** `google-trends-api` (v4.9.2) — **unofficial**; scrapes Google Trends (no official API key).
- **Implications:**
  - Google can throttle or block; no contractual SLA.
  - Reported limit ~**1400 requests per 4 hours**; 429 (Too Many Requests) is common under load.
  - Reset behavior is variable (reports of blocks lasting 16+ hours).
- **References:** [npm](https://www.npmjs.com/package/google-trends-api), [GitHub issues on 429](https://github.com/pat310/google-trends-api/issues), [Stack Overflow quota](https://stackoverflow.com/questions/39108077/google-trends-api-npm-quota-exceeded).

**Recommendation:** Document in runbooks that Trends is best-effort and may 429; consider fallback messaging in UI when trends are temporarily unavailable.

---

## 2. Authentication and Authorization

- **Mount:** `/api/v1/google` uses `optionalAuthMiddleware` — auth is optional.
- **Endpoints:**
  - **Authenticated:** `/trends/preview` (token in query), OAuth flows, Search Console/Analytics (use `req.user`).
  - **Unauthenticated:**  
    - `GET /api/v1/google/trends/rising-queries?keyword=...`  
    - `GET /api/v1/google/trends/related-topics?keyword=...`  
    - `GET /api/v1/google/trends/interest-over-time?keyword=...&startDate=...&endDate=...`

**Risk:** Anyone can hit these endpoints and consume shared Google Trends quota (and DB cache rows), leading to 429s for real users.

**Recommendation:** Require auth for all three data endpoints (e.g. `authMiddleware`) so only logged-in users can trigger live/cache fills. Optionally keep a short public cache TTL for anonymous reads if product requires it, with strict rate limiting.

**On-demand refresh:** `POST /api/v1/google/trends/refresh` (JWT required) forces a fetch of emerging topics for the current user's strategy keywords and populates the cache. Use this so the frontend can offer "Refresh emerging topics" instead of waiting for the daily cron.

---

## 3. Cache Layer

**Schema:** `database/migrations/042_google_data_cache.sql` — `google_trends_cache` (keyword, geo, timeframe, user_id, rising_queries, related_topics, expires_at).

**Issues:**

1. **No unique constraint**  
   - Code uses `INSERT ... ON CONFLICT DO NOTHING` but the table has **no UNIQUE** on (user_id, keyword, geo, timeframe).  
   - So `ON CONFLICT` never triggers; every fetch inserts a new row → unbounded growth and duplicate logical entries.

2. **Expired cache never pruned**  
   - `GoogleTrendsService.cleanExpiredCache()` exists but is **never called** from the scheduler (`jobs/scheduler.js`).  
   - Expired rows remain indefinitely.

**Recommendation:**

- Add a unique constraint, e.g. `UNIQUE (user_id, keyword, geo, timeframe)` (use `COALESCE(user_id, '00000000-0000-0000-0000-000000000000')` or a separate unique index that allows one NULL user_id per (keyword, geo, timeframe) if you want shared anonymous cache).
- Change insert to `ON CONFLICT (...) DO UPDATE SET rising_queries = EXCLUDED.rising_queries, related_topics = EXCLUDED.related_topics, expires_at = EXCLUDED.expires_at, fetched_at = NOW()` so cache refreshes in place.
- Schedule `cleanExpiredCache()` (e.g. daily after the Google data fetch job in `scheduler.js`).

---

## 4. Rate Limiting and Retries

**Batch job** (`jobs/googleDataFetcher.js` → `fetchTrendsDataForAllUsers`):

- 2 second delay between keyword requests ✅  
- No retry on 429 or transient errors ❌  
- Failures per keyword are logged and counted; job continues ✅  

**HTTP endpoints:**

- No per-user or global rate limit on `/trends/*` ❌  
- Unauthenticated access (see above) allows unlimited calls ❌  

**Recommendation:**

- In the job, on 429 (or parse error from Google), back off (e.g. exponential backoff or wait 2+ hours as suggested by library issues) and retry once or twice; then skip remaining keywords and log for follow-up.
- Add rate limiting for Trends endpoints (e.g. per user or per IP when unauthenticated) to protect shared quota.

---

## 5. Input Validation

- **rising-queries / related-topics:** `keyword` required; `geo`, `timeframe` defaulted but not validated (e.g. geo length/codes, timeframe format).
- **interest-over-time:** `keyword`, `startDate`, `endDate` required; dates not validated (format, range, max range).
- No max length on `keyword` (could be very long or abusive).

**Recommendation:** Validate `keyword` length (e.g. 1–200 chars), validate `geo` (e.g. 2–5 char codes), validate `timeframe` against an allowlist, and validate `startDate`/`endDate` (format YYYY-MM-DD, end ≥ start, range e.g. ≤ 1 year).

---

## 6. Error Handling and Resilience

- **Service** (`services/google-trends.js`): On exception, `getRisingQueries` / `getRelatedTopics` / `getInterestOverTime` return `[]` and log. No distinction between “no data” and “API error” or 429.
- **Routes:** 500 with `error.message` on throw; no structured error codes for client to detect 429 vs other failures.

**Recommendation:** Where feasible, detect 429 (or “rate limit” in error message) and return 503 or 429 with a Retry-After–style message; otherwise return 200 with empty data and an optional `warning` field (e.g. “Trends temporarily unavailable”) so UI can degrade gracefully.

---

## 7. Tests

- No tests under `tests/` for Google Trends (service, routes, or job).

**Recommendation:** Add unit tests for `GoogleTrendsService` (cache hit/miss, parse logic, error → empty array). Add integration tests for authenticated Trends endpoints (and optionally unauthenticated if kept), with mocked `google-trends-api` to avoid hitting Google.

---

## 8. Observability

- Logging: `console.log` / `console.error` only.
- No metrics (e.g. request count, cache hit rate, 429 count, latency) or alerting.

**Recommendation:** Add metrics (e.g. trends_requests_total, trends_cache_hits_total, trends_errors_total with reason), and alert on high error rate or 429s so the team can react to quota issues.

---

## 9. Documentation and Configuration

- `.env.example`: `GOOGLE_TRENDS_API_KEY=` — current implementation does **not** use an API key (uses unofficial package). Comment or remove to avoid confusion.
- `docs/issues/issue-269-trending-integration-comment.md`: Notes that Google Trends is unofficial and to document cost/rate limits before Phase 2 — aligned with this checklist.

**Recommendation:** Update `.env.example` to state that Trends uses the unofficial package and does not require an API key; link to this doc or a short “Trends” section in a runbook.

---

## 10. Scheduler and Jobs

- **Google Data Fetch** runs daily at 6:00 AM (`fetchAllGoogleData()` → includes `fetchTrendsDataForAllUsers()`). ✅  
- **cleanExpiredCache** is not scheduled. ❌  

**Recommendation:** Schedule `googleTrendsService.cleanExpiredCache()` (e.g. daily after the Google data fetch, or weekly).

---

## Action Items (Priority Order)

1. **Auth:** Require authentication for `GET /trends/rising-queries`, `GET /trends/related-topics`, and `GET /trends/interest-over-time`.
2. **Cache:** Add unique constraint on cache table, switch to upsert, and schedule `cleanExpiredCache()`.
3. **Rate limiting:** Add per-user (and/or per-IP for unauthenticated) rate limiting on Trends endpoints; add retry/backoff for 429 in the batch job.
4. **Input validation:** Validate keyword length, geo, timeframe, and date range on all Trends endpoints.
5. **Tests:** Add unit tests for the service and integration tests for the routes (mocked Trends API).
6. **Observability:** Add metrics and optional alerting for errors/429s; consider returning 503/429 and Retry-After when rate limited.
7. **Docs/config:** Clarify in `.env.example` that Trends does not use an API key; document rate limits and best-effort behavior in runbook or README.

---

## Files Touched by This Integration

| File | Role |
|------|------|
| `services/google-trends.js` | Core service; cache read/write; cleanExpiredCache |
| `routes/google-integrations.js` | Trends preview + rising-queries, related-topics, interest-over-time |
| `jobs/googleDataFetcher.js` | Daily batch fetch with 2s delay |
| `jobs/scheduler.js` | Schedules Google data fetch; does not schedule cache cleanup |
| `database/migrations/042_google_data_cache.sql` | Cache table; no unique constraint |
| `services/google-content-optimizer.js` | Reads from google_trends_cache for content calendar |
| `services/content-calendar-service.js` | Uses optimizer for trending topics |
| `package.json` | `google-trends-api` ^4.9.2 |
