# Pseudo-anonymous connection for organizationId — check (branch: check/pseudo-anonymous-organizationId)

**Question:** Are we still allowing pseudo-anonymous access (session-based, no JWT) for endpoints that are keyed by `organizationId`?

**Answer: Yes.** Session-based access by `organizationId` is still in place in the relevant routes.

---

## Where it’s allowed

### 1. **routes/analysis.js**

- **extractUserContext**: Reads `sessionId` from `req.headers['x-session-id']`, `req.body?.session_id`, or `req.query?.sessionId`. So GET/EventSource with `?sessionId=...` is supported.
- **getOrganizationForContext(organizationId, userContext)**:
  - Authenticated: `WHERE id = $1 AND owner_user_id = $2`
  - Not authenticated: `WHERE id = $1 AND session_id = $2`  
  → Pseudo-anonymous (session) access by `organizationId` is allowed.
- **Narration SSE endpoints** (`/narration/analysis`, `/narration/audience`, `/narration/topic`, `/narration/content`):
  - Use the same pattern: `orgQuery` uses `session_id = $2` when `!userContext.isAuthenticated`, and params use `userContext.sessionId`.
  - Some flows also call `getOrganizationForContext` then fallback to `getOrganizationById` (org by id only, for anonymous narration).

So analysis/narration streams still allow connection with only `organizationId` + `sessionId` (no JWT).

### 2. **routes/organizations.js**

- **getOrganizationForContext**: For unauthenticated with `sessionId`, uses `WHERE id = $1 AND session_id = $2`, and also binds “unbound” orgs (session_id IS NULL and owner_user_id IS NULL) to the current session.  
→ Pseudo-anonymous access by `organizationId` is still allowed.

### 3. **routes/jobs.js** (job stream)

- Job access is by **jobId + userId or sessionId**, not by organizationId. Stream 404 fix (normalize `sessionId` from query, compare as string) is in place so `GET .../stream?sessionId=...` works for session-owned jobs.

---

## Where it’s not used (auth-only)

- **routes/content-upload.js**, **routes/voice-samples.js**: Organization access is checked only with `owner_user_id` (no `session_id`). These require an authenticated user who owns the org; no pseudo-anonymous by organizationId.

---

## Optional hardening (not done on this branch)

For consistency with `routes/jobs.js`, analysis (and organizations) could normalize `sessionId` from query the same way (e.g. support `req.query?.sessionid`, handle array, trim). Current code already supports `req.query?.sessionId` for GET.
