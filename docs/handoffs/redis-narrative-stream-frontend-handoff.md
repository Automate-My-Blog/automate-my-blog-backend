# Redis narrative stream backend change — frontend handoff

**TL;DR: No frontend code changes are required.** The narrative stream API is unchanged. This doc is for awareness and optional verification.

**Related:** [website-analysis-narrative-stream-frontend-handoff.md](./website-analysis-narrative-stream-frontend-handoff.md) (full narrative stream contract).

---

## 1. What changed (backend only)

The backend now uses a **single shared Redis subscriber** for all narrative-stream clients instead of opening one Redis connection per client. This reduces Redis usage (e.g. on Upstash) while keeping the same behavior.

- **Endpoint:** Still `GET /api/v1/jobs/:jobId/narrative-stream?token=...` or `?sessionId=...`
- **Events:** Unchanged — `connected`, `analysis-status-update`, `transition`, `analysis-chunk`, `narrative-complete`, `complete`
- **Replay on connect:** Unchanged — server still replays stored narrative events from the DB, then streams live events
- **Auth, errors, payload shapes:** Unchanged

---

## 2. Frontend action required

**None.** Existing frontend code that uses the narrative stream can stay as-is. No URL, headers, event types, or payload handling need to change.

---

## 3. Optional verification

If you want to confirm behavior after the backend is deployed:

1. **Single client:** Start a website-analysis job, open the narrative stream, and confirm you receive `connected`, then `analysis-status-update` / `analysis-chunk` / etc., then `complete`.
2. **Reconnect:** Open the narrative stream, let a few events arrive, close it, then reopen for the same job — you should get the same replayed events plus any new ones (unchanged replay behavior).
3. **404 / 503:** Unchanged — 404 when job not found or not `website_analysis`; 503 when Redis is unavailable.

---

## 4. Reference

- Backend PR: [perf: reduce Redis usage by sharing narrative stream subscriber](https://github.com/Automate-My-Blog/automate-my-blog-backend/pull/189)
- Full narrative stream contract: [website-analysis-narrative-stream-frontend-handoff.md](./website-analysis-narrative-stream-frontend-handoff.md)
