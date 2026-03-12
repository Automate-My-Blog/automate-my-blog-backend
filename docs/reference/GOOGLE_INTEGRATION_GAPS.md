# Google integration — backend gaps and recommendations

Quick audit of what’s **in place** vs **missing or recommended** for Google (Trends, Search Console, Analytics). See also: [GOOGLE_INTEGRATIONS_REVIEW.md](./GOOGLE_INTEGRATIONS_REVIEW.md), [GOOGLE_TRENDS_PRODUCTION_READINESS.md](./GOOGLE_TRENDS_PRODUCTION_READINESS.md).

---

## In good shape

| Area | Status |
|------|--------|
| **OAuth flow** | GET authorize → callback → store tokens; credentials from per-user → platform → env. |
| **Credential store** | Encrypted (per-user + platform); no env vars required if super_admin sets platform creds. |
| **Token refresh** | `oauth-manager` refreshes when expired/expiring; uses same credential resolution (per-user → platform → env). |
| **GSC / GA data routes** | All use `authMiddleware`; 401 + `needsReconnect: true` on invalid_grant/401. |
| **Funnel** | GET /funnel with pageUrl, siteUrl, propertyId, dates; partial funnel when only GSC or only GA connected. |
| **OAuth status contract** | Same shape (success, connected, expires_at, scopes) for trends/search_console/analytics; contract test in place. |
| **Redirect URI** | `GOOGLE_REDIRECT_URI` trimmed, query string stripped; must match Google Cloud Console exactly. |
| **Docs** | GOOGLE_OAUTH_CREDENTIALS_ISSUE_504, google-oauth-per-client-frontend-handoff, issue-504-backend-evaluation. |

---

## Gaps and recommendations

### 1. Unauthenticated Trends data endpoints (quota / abuse)

**Current:** These run under `optionalAuth` and do **not** require JWT:

- `GET /api/v1/google/trends/rising-queries?keyword=...`
- `GET /api/v1/google/trends/related-topics?keyword=...`
- `GET /api/v1/google/trends/interest-over-time?keyword=...&startDate=...&endDate=...`

**Risk:** Anyone can hit them and burn shared Trends quota (and DB cache), leading to 429s for real users.

**Recommendation:** Require JWT for these three (e.g. use `authService.authMiddleware` and pass `req.user.userId` into the Trends service for cache keying). If you need a public read path, add strict rate limiting and/or short TTL for anonymous cache.

**Ref:** [GOOGLE_TRENDS_PRODUCTION_READINESS.md §2](./GOOGLE_TRENDS_PRODUCTION_READINESS.md).

---

### 2. Google Trends cache: no unique constraint

**Current:** `google_trends_cache` has **no UNIQUE** on `(user_id, keyword, geo, timeframe)`. The service uses `INSERT ... ON CONFLICT DO NOTHING`, but without a unique constraint that does nothing, so every call can insert a new row.

**Effects:** Duplicate cache rows, unnecessary growth, and no real “update in place” for the same key.

**Recommendation:** Add a migration, e.g.:

```sql
-- Optional: add unique constraint so ON CONFLICT works
CREATE UNIQUE INDEX IF NOT EXISTS uq_google_trends_cache_key
  ON google_trends_cache (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), keyword, geo, timeframe);
```

Then in `google-trends.js` use `ON CONFLICT` on that unique key and `DO UPDATE SET ...` to refresh existing rows instead of inserting duplicates. (Postgres 15+ supports `ON CONFLICT (columns)` with a unique index; if you need to support null `user_id`, the expression above coalesces to a sentinel UUID so one row per “global” key.)

---

### 3. Expired Trends cache never cleaned

**Current:** `google-trends.js` defines `cleanExpiredCache()` but it is **never called** from any job or cron.

**Effect:** `google_trends_cache` grows indefinitely.

**Recommendation:** Run `cleanExpiredCache()` periodically, e.g. from the same place that runs the daily Google Data Fetch (e.g. `jobs/scheduler.js` or `jobs/googleDataFetcher.js`) or a small cron route.

---

### 4. (Optional) Rate limiting and retries for Trends

**Current:** No HTTP-level rate limit on Trends endpoints; no retry on 429 from the unofficial Trends API.

**Recommendation (from GOOGLE_TRENDS_PRODUCTION_READINESS):** Document that Trends is best-effort and may 429; consider retry with backoff on 429 and a clear UI message when trends are temporarily unavailable.

---

### 5. (Optional) OAuth state signing

**Current:** OAuth `state` is base64-encoded `{ userId, service }` with no signature.

**Risk:** In theory someone could forge state to associate a code with another user; in practice the callback runs server-side and the code is one-time, so impact is limited.

**Recommendation:** Low priority; if you want to harden, sign state (e.g. HMAC or JWT) and verify in the callback.

---

## Summary table

| Item | Priority | Effort |
|------|----------|--------|
| Require auth for rising-queries, related-topics, interest-over-time | High | Low |
| Add unique constraint + ON CONFLICT DO UPDATE for google_trends_cache | High | Low (migration + small code change) |
| Schedule cleanExpiredCache (cron/job) | Medium | Low |
| Rate limit / retry for Trends | Medium | Medium |
| Sign OAuth state | Low | Low |

---

## Env checklist (for deploy)

- **GOOGLE_REDIRECT_URI** — Required; exact callback URL (no query string).
- **OAUTH_ENCRYPTION_KEY** — Required for encrypted credential/token store.
- **GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET** — Optional if platform (or per-user) credentials are set via POST /oauth/credentials.

Frontend does not need Google env vars; backend handles OAuth and credential resolution.
