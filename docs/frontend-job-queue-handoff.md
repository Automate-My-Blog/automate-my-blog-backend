# Frontend handoff: switching to async job queue APIs

**Audience:** Frontend team  
**Purpose:** Step-by-step instructions to switch from sync endpoints to the new job-queue APIs for website analysis and content generation.  
**Related:** Backend spec and implementation — `docs/backend-queue-system.md`, `docs/backend-audit.md` (§ queue).

---

## 1. What’s changing

| Current (sync) | New (async) |
|----------------|-------------|
| `POST /api/analyze-website` → long wait, then full response | `POST /api/v1/jobs/website-analysis` → `201 { jobId }`; poll `GET /api/v1/jobs/:jobId/status` for result |
| `POST /api/generate-audiences` + `generate-pitches` + `generate-audience-images` (multi-step sync) | Same as above: one job runs **analyze → audiences → pitches → images**; result in `status.result` when `succeeded` |
| `POST /api/v1/enhanced-blog-generation/generate` → long wait, then full response | `POST /api/v1/jobs/content-generation` → `201 { jobId }`; poll `GET /api/v1/jobs/:jobId/status` for result |

The **response shapes** when a job has `status === "succeeded"` match what you get today from the sync endpoints. You can reuse the same UI and state logic; only the “trigger → wait → consume result” flow changes.

---

## 2. Base URL and auth

- **Base path:** ` /api/v1/jobs` (same host as today).
- **Auth:**  
  - **Website analysis:** optional auth. Use **JWT** (Bearer) when logged in, or **`x-session-id`** for anonymous.  
  - **Content generation:** **JWT required** (same as current generate endpoint).
- **CORS:** Unchanged. `x-session-id` is already allowed.

---

## 3. Website analysis (full pipeline)

### 3.1 Start job

```http
POST /api/v1/jobs/website-analysis
Content-Type: application/json
Authorization: Bearer <accessToken>   // optional, if logged in
x-session-id: <sessionId>             // optional, if anonymous

{ "url": "https://example.com" }
```

**Success:** `201` → `{ "jobId": "uuid" }`  
**Errors:** `400` (e.g. missing `url`), `401` (no auth and no `x-session-id`), `503` (queue unavailable).

### 3.2 Poll status

```http
GET /api/v1/jobs/:jobId/status
Authorization: Bearer <accessToken>   // when logged in
x-session-id: <sessionId>             // when anonymous
```

**Success:** `200` →

```json
{
  "jobId": "uuid",
  "status": "queued" | "running" | "succeeded" | "failed",
  "progress": 0,
  "currentStep": "Analyzing website...",
  "estimatedTimeRemaining": 30,
  "error": null,
  "errorCode": null,
  "result": null,
  "createdAt": "2026-01-29T12:00:00Z",
  "updatedAt": "2026-01-29T12:01:15Z"
}
```

- **`status === "succeeded"`** → `result` has the **same shape** as the current combined website-analysis response (analysis, scenarios with `imageUrl`, CTAs, `organizationId`, etc.). Use it exactly like today.
- **`status === "failed"`** → `error` (and optionally `errorCode`) for user-facing message or debugging.
- **`status === "running"`** → use `progress`, `currentStep`, and `estimatedTimeRemaining` for progress UI (e.g. step-based progress bar).

**Errors:** `404` when `jobId` not found or not owned by current user/session.

### 3.3 Progress steps (for UX)

You’ll see `currentStep` values such as:

1. `"Analyzing website..."`
2. `"Generating audiences..."`
3. `"Generating pitches..."`
4. `"Generating images..."`

You can map these to a 4-step progress bar or similar.

### 3.4 Retry and cancel

- **Retry (failed jobs only):**  
  `POST /api/v1/jobs/:jobId/retry`  
  → `200 { "jobId": "uuid" }`. Keep polling the same `jobId`.
- **Cancel (queued or running):**  
  `POST /api/v1/jobs/:jobId/cancel`  
  → `200 { "cancelled": true }`. Eventually `status` will move to `failed` with `error: "Cancelled"`.

Use the same auth/session headers as for create and status.

---

## 4. Content generation

### 4.1 Start job

```http
POST /api/v1/jobs/content-generation
Content-Type: application/json
Authorization: Bearer <accessToken>

{
  "topic": { "title": "...", ... },
  "businessInfo": { "businessType": "...", "targetAudience": "...", ... },
  "organizationId": "uuid",
  "additionalInstructions": "...",
  "options": { "includeVisuals": true, "autoSave": true, "status": "draft" }
}
```

Same payload as `POST /api/v1/enhanced-blog-generation/generate`.

**Success:** `201` → `{ "jobId": "uuid" }`  
**Errors:** `400` (e.g. missing required fields), `401` (no JWT), `503` (queue unavailable).

### 4.2 Poll status

Same as website analysis:  
`GET /api/v1/jobs/:jobId/status` with JWT.

- **`status === "succeeded"`** → `result` matches the current **generate** API response (`data`, `savedPost`, `metadata`, `imageGeneration`, etc.). Reuse your existing result handling.
- **`status === "failed"`** → show `error` (and `errorCode` if useful).

Progress is optional; you may see a single “running” step or simple 0–100 `progress`.

---

## 5. Suggested client flow

1. **Create job**  
   - Website analysis: `POST /api/v1/jobs/website-analysis` with `{ url }` + auth or `x-session-id`.  
   - Content generation: `POST /api/v1/jobs/content-generation` with same body as current generate endpoint + JWT.

2. **Persist `jobId`**  
   - e.g. in component state + `localStorage` (or your state layer) so you can resume after refresh.

3. **Poll**  
   - `GET /api/v1/jobs/:jobId/status` every **2–3 seconds** until `status` is `succeeded` or `failed`.

4. **On `succeeded`**  
   - Read `result` and feed it into your existing UI logic (same shape as current sync responses).

5. **On `failed`**  
   - Show `error` (and optionally `errorCode`).  
   - Offer **Retry** via `POST /api/v1/jobs/:jobId/retry` if you want.

6. **Optional**  
   - **Cancel** via `POST /api/v1/jobs/:jobId/cancel` for queued/running jobs.  
   - Use `progress` / `currentStep` / `estimatedTimeRemaining` for progress UI.

---

## 6. Resumption after refresh

- Store active `jobId`s (e.g. in `localStorage`) when you start a job.
- On load, resume polling for any stored `jobId`s (same `GET /api/v1/jobs/:jobId/status`).
- Stop polling and clear storage when `status` is `succeeded` or `failed`.

---

## 7. Checklist

- [ ] Switch website analysis to `POST /jobs/website-analysis` → poll `GET /jobs/:jobId/status`; use `result` on success.
- [ ] Switch content generation to `POST /jobs/content-generation` → poll `GET /jobs/:jobId/status`; use `result` on success.
- [ ] Add progress UI using `progress` / `currentStep` (and optionally `estimatedTimeRemaining`).
- [ ] Persist `jobId` and support resumption on refresh.
- [ ] Handle `failed` (show `error`; optional retry via `POST /jobs/:jobId/retry`).
- [ ] Optional: cancel via `POST /jobs/:jobId/cancel` for running jobs.
- [ ] Keep using the same auth (JWT) and `x-session-id` behavior as today.

---

## 8. When to switch

- Backend deploys the new job queue and runs the worker (`npm run worker`).
- Redis and migrations are in place (see `docs/backend-queue-system.md`).
- You can run E2E against staging that uses the new async APIs.

Until then, existing sync endpoints remain available. Once you’ve fully migrated, those can be deprecated or redirected.

---

## 9. Reference

- **Backend queue system:** `docs/backend-queue-system.md`  
- **API base:** same as current (e.g. `https://your-api-host/api/v1/jobs`).
