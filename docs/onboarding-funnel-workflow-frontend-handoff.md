# Onboarding funnel workflow — frontend handoff

This document describes the **full onboarding funnel**: from entering a website URL through website analysis, audience selection, topic selection, and blog post generation. Use it to implement or refactor the guided funnel UI and to wire each step to the correct APIs and streams.

**Related docs:**  
[website-analysis-stream-frontend-handoff.md](./website-analysis-stream-frontend-handoff.md) · [website-analysis-narrative-stream-frontend-handoff.md](./website-analysis-narrative-stream-frontend-handoff.md) · [narration-stream-frontend-handoff.md](./narration-stream-frontend-handoff.md) · [topics-stream-frontend-handoff.md](./topics-stream-frontend-handoff.md) · [content-generation-stream-frontend-handoff.md](./content-generation-stream-frontend-handoff.md) · [frontend-job-queue-handoff.md](./frontend-job-queue-handoff.md) · [sse-stream-auth-frontend-handoff.md](./sse-stream-auth-frontend-handoff.md) · [voice-adaptation-frontend-handoff.md](./voice-adaptation-frontend-handoff.md) · [issue-261-backend-implementation.md](./issue-261-backend-implementation.md)

---

## 1. Funnel overview

The funnel has **four main steps** (plus optional confirm/edit and narration):

| Step | User action | Backend (summary) |
|------|-------------|--------------------|
| **0. Entry** | Optional: create session (anonymous). Enter website URL. | `POST /api/v1/session/create`; store `session_id`. |
| **1. Website analysis** | Start analysis; see progress, narrative, then analysis + audiences + pitches + images. | Job: `POST /api/v1/jobs/website-analysis`; streams: main job stream + optional narrative stream. |
| **2. Confirm / edit (optional)** | Confirm analysis or edit fields; optionally “Apply suggestion.” | `POST /api/v1/analysis/confirm`; `POST /api/v1/analysis/cleaned-edit`. |
| **3. Audience** | See audience cards; select one. Optional typing narration before cards. | Narration: `GET /api/v1/analysis/narration/audience`. Data from Step 1 result. |
| **4. Topic** | See topics for selected audience; select one. Optional narration. | Narration: `GET /api/v1/analysis/narration/topic`; topics: `POST /api/v1/topics/generate-stream` → SSE. |
| **5. Content** | Generate blog post for selected topic. Optional narration. | Narration: `GET /api/v1/analysis/narration/content`; job: `POST /api/v1/jobs/content-generation` → SSE. |

**Auth:** Steps 0–4 work with **anonymous session** (`x-session-id` / `sessionId`) or **JWT**. Step 5 (content generation) **requires JWT**. If the user is anonymous at Step 5, prompt sign-up/login, then call **session adoption** and retry content generation.

---

## 2. Step 0: Entry and session (anonymous)

**When:** User has not logged in and you want to persist analysis to a session so it can be adopted after sign-up.

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/session/create`
- **Auth:** None.

**Response**

```json
{
  "success": true,
  "session_id": "uuid",
  "expires_at": "2026-02-11T12:00:00.000Z"
}
```

**Frontend:** Store `session_id` (e.g. in memory or localStorage). Send it as `x-session-id` on all subsequent requests that support session auth (website analysis, topics stream, etc.), and as `?sessionId=...` when opening SSE connections (EventSource cannot send headers).

---

## 3. Step 1: Website analysis

User enters a URL and starts analysis. The backend runs: scrape → analysis + narrative → audiences → pitches → scenario images. The frontend can show progress, narrative “thinking,” and partial results (analysis, then audience cards, then pitches, then images).

### 3.1 Create the job

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/jobs/website-analysis`
- **Auth:** `Authorization: Bearer <JWT>` (if logged in) or `x-session-id: <sessionId>` (anonymous).
- **Body:**

```json
{
  "url": "https://example.com"
}
```

**Response:** `201` → `{ "jobId": "uuid" }`

**Errors:** `400` (missing/invalid `url`), `401` (no auth/session), `503` (queue unavailable).

### 3.2 Main job stream (progress + results)

Open the SSE stream to receive progress and partial results. Auth via query (EventSource cannot send headers): `?token=<JWT>` or `?sessionId=<sessionId>`.

**Request**

- **Method:** `GET`
- **URL:** `${API_BASE}/api/v1/jobs/${jobId}/stream?token=...` or `?sessionId=...`

**Events (in order):** `connected` → `progress-update` (with `phase` during “Analyzing website”) → `scrape-result` → `analysis-result` → `audience-complete` (per item) → `audiences-result` → `pitch-complete` (per item) → `pitches-result` → `scenario-image-complete` (per item) → `scenarios-result` → `complete` (or `failed`).

From **analysis-result** you get `organizationId`, analysis summary, CTAs, metadata. From **audiences-result** / **pitches-result** / **scenarios-result** (or per-item events) you get the audience scenarios (with pitch and `imageUrl` at the end). From **complete** you get the full `data.result` (same shape as the old sync response): `organizationId`, `analysis`, `scenarios`, `ctas`, etc.

**Reference:** [website-analysis-stream-frontend-handoff.md](./website-analysis-stream-frontend-handoff.md), [job-stream-sse.md](./job-stream-sse.md).

### 3.3 Optional: Narrative stream (typing effect)

For a conversational “thinking” experience during analysis, open a **second** SSE stream for the same job:

**Request**

- **Method:** `GET`
- **URL:** `${API_BASE}/api/v1/jobs/${jobId}/narrative-stream?token=...` or `?sessionId=...`

**Events:** `connected` → `analysis-status-update` (scraping/status copy) → `transition` → `analysis-chunk` (word-by-word **short opening**) → `insight-card` (one per card, 4–6 total) → `narrative-complete` → `complete`. Use these for “Moment 1” (status) and “Moment 2” (opening + insight cards); then transition to “Moment 3” (audience cards from the **main** stream).

**Reference:** [website-analysis-narrative-stream-frontend-handoff.md](./website-analysis-narrative-stream-frontend-handoff.md). **Recent changes (short narrative + cards):** [website-analysis-narrative-frontend-changes.md](./website-analysis-narrative-frontend-changes.md).

### 3.4 After Step 1

Store at least:

- `organizationId` (from `analysis-result` or `complete.result`)
- `analysis` (for confirm/edit and for topic stream body)
- `scenarios` (audience cards with pitch and `imageUrl`)
- `ctas` (optional; for content generation and CTAs in the post)

You need these for confirm/edit, narration params, topics stream, and content-generation job.

---

## 4. Step 2: Confirm / edit analysis (optional)

User can confirm the analysis as-is or edit fields (e.g. business name, target audience, content focus). Optionally use “Apply suggestion” to get an LLM-cleaned version of their edit.

### 4.1 Save confirmation and/or edits

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/analysis/confirm`
- **Auth:** JWT or session (same as analysis).
- **Body:**

```json
{
  "organizationId": "uuid",
  "analysisConfirmed": true,
  "analysisEdited": false,
  "editedFields": [],
  "businessName": "Acme Inc",
  "targetAudience": "Small business owners",
  "contentFocus": "Productivity tips"
}
```

Allowed body fields: `organizationId` (required), `analysisConfirmed`, `analysisEdited`, `editedFields` (array of field names), and any of `businessName`, `businessType`, `websiteUrl`, `targetAudience`, `brandVoice`, `description`, `businessModel` to update the org.

**Response:** `200` → `{ "success": true, "message": "...", "organizationId": "..." }`

### 4.2 Apply suggestion (cleaned edit)

When the user has typed raw edits and you want an LLM-cleaned suggestion:

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/analysis/cleaned-edit`
- **Body:**

```json
{
  "editedFields": {
    "businessName": "user typed text",
    "targetAudience": "user typed text"
  }
}
```

**Response:** `200` → `{ "success": true, "suggested": { "businessName": "...", "targetAudience": "..." } }`

Use `suggested` to populate an “Apply suggestion” action; then persist via **confirm** with the chosen values.

---

## 5. Step 3: Audience selection

Show the audience cards (from Step 1 `scenarios`). Optionally play a short typing narration before showing the cards.

### 5.1 Optional: Audience narration stream

**Request**

- **Method:** `GET`
- **URL:** `${API_BASE}/api/v1/analysis/narration/audience?organizationId=${organizationId}&sessionId=...` (or send JWT via `fetch` and read stream).

**Events:** `audience-narration-chunk` (`data.text` = word/whitespace), `audience-narration-complete` (`data.text` = full narration). Use for a typing effect, then reveal the audience cards.

**Reference:** [narration-stream-frontend-handoff.md](./narration-stream-frontend-handoff.md).

### 5.2 User selects an audience

No API call. Store the selected audience (e.g. `scenarios[index]` or the segment label) for the topic step. You’ll use it for:

- `selectedAudience` in the topic narration URL.
- Topic stream body: `targetAudience` can be the selected segment (or org’s `target_audience`).

---

## 6. Step 4: Topic selection

Generate topics for the selected audience (and org context), then let the user pick one. Optionally play the topic narration before or while topics load.

### 6.1 Optional: Topic narration stream

**Request**

- **Method:** `GET`
- **URL:** `${API_BASE}/api/v1/analysis/narration/topic?organizationId=${organizationId}&selectedAudience=${encodeURIComponent(selectedAudience)}` (+ auth query if needed).

**Events:** `topic-narration-chunk`, `topic-narration-complete`. Use for typing effect before or alongside the topic list.

### 6.2 Topics stream

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/topics/generate-stream` (or `POST /api/v1/trending-topics/stream`)
- **Auth:** JWT or `x-session-id`.
- **Body:**

```json
{
  "businessType": "from analysis",
  "targetAudience": "selected audience segment or org target_audience",
  "contentFocus": "from analysis or org"
}
```

**Response:** `200` → `{ "connectionId": "uuid", "streamUrl": "..." }`. Open `streamUrl` with EventSource (it already has `?token=` or `?sessionId=`).

**Events:** `connected` → `topic-complete` (per topic) → `topic-image-start` / `topic-image-complete` (per topic) → `complete` with full `data.topics`, or `error`.

**Reference:** [topics-stream-frontend-handoff.md](./topics-stream-frontend-handoff.md).

### 6.3 User selects a topic

No API call. Store the selected topic object (e.g. `{ title, subheader, ... }`) for the content-generation step.

---

## 7. Step 5: Content generation

Generate a blog post for the selected topic. **Requires a logged-in user (JWT).** If the user is still anonymous, prompt sign-up/login, then run **session adoption** (Section 8), then start content generation.

### 7.1 Optional: Content narration stream

**Request**

- **Method:** `GET`
- **URL:** `${API_BASE}/api/v1/analysis/narration/content?organizationId=${organizationId}&selectedTopic=${encodeURIComponent(selectedTopic.title)}` (+ auth query if needed).

**Events:** `content-narration-chunk`, `content-narration-complete`. Use for typing effect before the post appears.

### 7.2 Create content-generation job and stream

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/jobs/content-generation`
- **Auth:** `Authorization: Bearer <JWT>` (required).
- **Body:** Same as `POST /api/v1/enhanced-blog-generation/generate`. Include `topic` (selected topic), `businessInfo` (from analysis/org), `organizationId`, and `options` (e.g. `includeVisuals`, `autoSave`, `status`, `preloadedTweets`, `preloadedArticles`, `preloadedVideos`). Optional top-level `ctas` array for the business’s CTAs.

**Response:** `201` → `{ "jobId": "uuid" }`

**Stream:** `GET ${API_BASE}/api/v1/jobs/${jobId}/stream?token=${accessToken}`. Events: `connected` → `progress-update` → `context-result` → `blog-result` (show post immediately) → `visuals-result` → `seo-result` → `complete` (or `failed`). Use `blog-result` and `complete.result` for the post; replace `[TWEET:0]`, `[ARTICLE:0]`, `[VIDEO:0]` with embeds using `preloadedTweets`, `preloadedArticles`, `preloadedVideos` from the same payload.

**Reference:** [content-generation-stream-frontend-handoff.md](./content-generation-stream-frontend-handoff.md), [FRONTEND_AGENT_HANDOFF_EMBED_STEPS.md](./FRONTEND_AGENT_HANDOFF_EMBED_STEPS.md).

---

## 8. Session adoption (anonymous → logged-in)

When the user completes sign-up or login **after** doing analysis (and optionally topics) as anonymous, attach their session data to their account so the same `organizationId` and analysis are available under their user.

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/analysis/adopt-session`
- **Auth:** `Authorization: Bearer <JWT>` (user must be logged in).
- **Body:**

```json
{
  "session_id": "session_id from Step 0"
}
```

**Response:** `200` with adoption summary (e.g. organizations/intelligence adopted). The backend transfers organization(s) and intelligence from `session_id` to the current user. After this, use the same `organizationId` (or the one returned in the response) for content generation and other authenticated calls.

**When to call:** Once, right after login/signup when you have a stored `session_id` that was used for website analysis (or topics). Then discard or clear the anonymous session in the UI and continue with JWT.

---

## 9. Resume / return visit (logged-in)

For a user who left and comes back later (or refreshes), you can load their most recent analysis so they can resume from audience, topic, or content step.

**Request**

- **Method:** `GET`
- **URL:** `${API_BASE}/api/v1/user/recent-analysis` or `${API_BASE}/api/v1/analysis/recent`
- **Auth:** `Authorization: Bearer <JWT>` (required).

**Response:** `200` → `{ "success": true, "analysis": { ... } }` (or `analysis: null` if none). The shape and presence of `scenarios` may differ by endpoint; see API docs. Use `analysis` and any `organizationId` to restore funnel state and, if needed, re-fetch or persist scenarios from your own cache or from a dedicated endpoint if available.

---

## 10. Auth summary

| Step / endpoint              | JWT | Session (x-session-id / ?sessionId) |
|-----------------------------|-----|-------------------------------------|
| Session create              | —   | N/A (you get session_id here).     |
| Website analysis job + stream| ✅  | ✅                                  |
| Narrative stream            | ✅  | ✅                                  |
| Analysis confirm / cleaned-edit | ✅ | ✅ (org by session or organizationId). |
| Narration (audience/topic/content) | ✅ | ✅ (query param for EventSource).  |
| Topics generate-stream     | ✅  | ✅                                  |
| Content-generation job + stream | ✅ (required) | ❌ |
| Adopt-session               | ✅ (required) | ❌                |
| Recent analysis             | ✅ (required) | ❌                |

For **EventSource** (all SSE GETs), auth is **only via query**: `?token=<JWT>` or `?sessionId=<sessionId>`.

---

## 11. Suggested frontend flow (single path)

1. **Entry:** If anonymous, `POST /api/v1/session/create` and store `session_id`. User enters URL.
2. **Analysis:** `POST /api/v1/jobs/website-analysis` with `url` and auth. Open main stream (`GET /jobs/:jobId/stream?token=...|sessionId=...`) and optionally narrative stream (`GET /jobs/:jobId/narrative-stream?token=...|sessionId=...`). On **complete**, store `organizationId`, `analysis`, `scenarios`, `ctas`.
3. **Confirm (optional):** If user edits, optionally `POST /api/v1/analysis/cleaned-edit` for suggestion, then `POST /api/v1/analysis/confirm` with final values.
4. **Audience:** Optionally open `GET /api/v1/analysis/narration/audience?organizationId=...`. Show audience cards from `scenarios`; user selects one.
5. **Topic:** Optionally open `GET /api/v1/analysis/narration/topic?organizationId=...&selectedAudience=...`. `POST /api/v1/topics/generate-stream` with `businessType`, `targetAudience`, `contentFocus`; open `streamUrl`. On **complete**, user selects a topic.
6. **Content:** If anonymous, show sign-up/login; after login call `POST /api/v1/analysis/adopt-session` with stored `session_id`. Optionally open `GET /api/v1/analysis/narration/content?organizationId=...&selectedTopic=...`. `POST /api/v1/jobs/content-generation` with topic, businessInfo, organizationId, options; open `GET /jobs/:jobId/stream?token=...`. On **blog-result** show post; on **complete** set final state and replace embed placeholders.
7. **Resume:** On app load for logged-in user, `GET /api/v1/user/recent-analysis` (or `/api/v1/analysis/recent`) and, if `analysis` exists, restore funnel state and allow jumping to audience/topic/content as appropriate.

---

## 12. Reference: doc index

| Doc | Purpose |
|-----|--------|
| [website-analysis-stream-frontend-handoff.md](./website-analysis-stream-frontend-handoff.md) | Main job stream events and payloads for website analysis. |
| [website-analysis-narrative-stream-frontend-handoff.md](./website-analysis-narrative-stream-frontend-handoff.md) | Narrative stream (analysis-status-update, analysis-chunk, etc.). |
| [narration-stream-frontend-handoff.md](./narration-stream-frontend-handoff.md) | Audience/topic/content narration SSE endpoints. |
| [topics-stream-frontend-handoff.md](./topics-stream-frontend-handoff.md) | Topics generate-stream and events. |
| [content-generation-stream-frontend-handoff.md](./content-generation-stream-frontend-handoff.md) | Content-generation job and blog-result / complete. |
| [frontend-job-queue-handoff.md](./frontend-job-queue-handoff.md) | Job create, poll status, retry, cancel. |
| [sse-stream-auth-frontend-handoff.md](./sse-stream-auth-frontend-handoff.md) | JWT vs sessionId for SSE. |
| [voice-adaptation-frontend-handoff.md](./voice-adaptation-frontend-handoff.md) | Voice samples upload, profile, and "your voice vs generic" comparison. |
| [job-stream-sse.md](./job-stream-sse.md) | Full job stream event schema. |
| [issue-261-backend-implementation.md](./issue-261-backend-implementation.md) | Backend summary for guided funnel (confirm, cleaned-edit, narration, icons). |
