# Analytics track by URL – backend implementation

**Related:** Issue #202 · Frontend sends analytics for all users (logged in or out) and includes `workflowWebsiteUrl`. This doc summarizes the backend changes that support that behavior.

---

## Checklist (backend)

- [x] `POST /api/v1/analytics/track` and `POST /api/v1/analytics/track-batch` accept requests **without** `Authorization` and do **not** return 401 for missing/invalid auth.
- [x] Events with `userId: null` are stored and keyed by `metadata.sessionId` and, when present, `workflowWebsiteUrl`.
- [x] Events with `userId` set are still associated with that user; `workflowWebsiteUrl` and `metadata.sessionId` are stored when present.
- [ ] **Deploy:** Run migration `database/migrations/034_add_workflow_website_url_analytics.sql` before or with this deploy so `user_activity_events.workflow_website_url` exists.
- [ ] **Optional:** Add or extend dashboards/aggregations by `workflow_website_url` and/or `session_id` for anonymous and per-site analytics.

---

## Changes made

### 1. Optional auth on track endpoints

- **Routes:** `routes/analytics.js`
- **Change:** `POST /track` and `POST /track-batch` use `optionalAuthMiddleware` instead of `authMiddleware`.
- **Effect:** Missing or invalid `Authorization` no longer returns 401; `req.user` is set only when a valid JWT is present.

### 2. User ID and workflow URL from request

- **Single (`/track`):** `userId` = `req.user?.userId ?? req.body.userId ?? null`. `workflowWebsiteUrl` = `req.body.workflowWebsiteUrl ?? req.body.metadata?.workflowWebsiteUrl`.
- **Batch (`/track-batch`):** When a valid JWT is present, all events in the batch are associated with that user (`req.user.userId`). Otherwise each event uses its own `userId`. `workflowWebsiteUrl` is taken from each event’s top-level or `metadata.workflowWebsiteUrl`.

### 3. Persist workflow URL and session

- **Service:** `services/analytics.js`
- **Change:** `trackEvent` accepts `metadata.workflowWebsiteUrl` and inserts it into `user_activity_events.workflow_website_url`. `sessionId` was already stored; it remains the primary key for anonymous session continuity.
- **Bulk:** `bulkTrackEvents` passes each event’s `workflowWebsiteUrl` (from top-level or metadata) and `sessionId` (from top-level or metadata) into `trackEvent`.

### 4. Migration

- **File:** `database/migrations/034_add_workflow_website_url_analytics.sql`
- **Content:** Adds `workflow_website_url TEXT` to `user_activity_events` and an index for non-null values.
- **When:** Run this migration before or with the deploy that includes these code changes; the INSERT in `trackEvent` expects the column to exist.

---

## Request/response (unchanged)

- **Single:** `POST /api/v1/analytics/track` — body: one event object. Responses: 200/201 on success; 4xx only for bad payload or rate limit, **not** 401 for missing auth.
- **Batch:** `POST /api/v1/analytics/track-batch` — body: `{ "events": [ ... ] }`. Same response rules.

Existing fields (`eventType`, `eventData`, `pageUrl`, `metadata.referrer`, `metadata.conversionFunnelStep`, `metadata.revenueAttributed`, etc.) are unchanged.
