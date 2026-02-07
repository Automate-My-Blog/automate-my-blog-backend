# Issue #261 — Backend implementation summary

Backend work completed to align with [GitHub Issue #261](https://github.com/Automate-My-Blog/automate-my-blog-frontend/issues/261) (Guided Funnel Redesign). This doc summarizes what was implemented for the frontend handoff.

---

## 1. Terminology: “scraping-thought” → “analysis-status-update”

- **Narrative stream** (e.g. `GET /api/v1/jobs/:jobId/narrative-stream`): All events that were previously named `scraping-thought` are now **`analysis-status-update`**. Payload shape unchanged: `{ content: string, progress?: number }`.
- **Code/docs updated:** `services/website-analysis-pipeline.js`, `jobs/job-worker.js`, `services/job-queue.js`, `routes/jobs.js`, `database/migrations/033_add_jobs_narrative_stream.sql`, and docs: `website-analysis-narrative-stream-frontend-handoff.md`, `job-stream-sse.md`, `RECENT_UPDATES.md`.

---

## 2. Analysis confirm & edit (organization)

- **Migration:** `database/migrations/035_organization_analysis_confirm_edit.sql` adds to `organizations`:
  - `analysis_confirmed_at` (TIMESTAMP)
  - `analysis_edited` (BOOLEAN, default false)
  - `edited_fields` (JSONB, default `[]`)
- **Confirm endpoint:** `POST /api/v1/analysis/confirm`  
  - Body: `{ organizationId, analysisConfirmed?, analysisEdited?, editedFields?: string[], ...analysisUpdates }`  
  - Verifies org ownership (user or session). Sets `analysis_confirmed_at`, `analysis_edited`, `edited_fields`, and optionally updates org fields (e.g. `businessName`, `targetAudience`, `contentFocus`).
- **Cleaned-edit endpoint:** `POST /api/v1/analysis/cleaned-edit`  
  - Body: `{ editedFields: { businessName?, targetAudience?, contentFocus?, ... } }`  
  - Returns: `{ suggested: { businessName?, ... } }` — LLM-cleaned strings for “Apply suggestion”.

---

## 3. Streaming narrations (audience, topic, content)

- **OpenAI helpers** (in `services/openai.js`):
  - `generateAudienceNarration(context)` — first-person paragraph before audience carousel.
  - `generateTopicNarration(context)` — first-person paragraph before topic carousel.
  - `generateContentGenerationNarration(context)` — first-person paragraph before content generation.
- **SSE endpoints** (under `GET /api/v1/analysis/narration/...`):
  - `GET /api/v1/analysis/narration/audience?organizationId=xxx`  
    Events: `audience-narration-chunk` `{ text }`, `audience-narration-complete` `{ text }`.
  - `GET /api/v1/analysis/narration/topic?organizationId=xxx&selectedAudience=...`  
    Events: `topic-narration-chunk`, `topic-narration-complete`.
  - `GET /api/v1/analysis/narration/content?organizationId=xxx&selectedTopic=...`  
    Events: `content-narration-chunk`, `content-narration-complete`.  
  Auth: same as analysis (optional auth + session). Org must be owned by user or session.

---

## 4. Analysis card icons

- **Helper:** `utils/analysis-icons.js` — `getAnalysisIconUrls(analysis)` returns:
  - `{ businessType, targetAudience, contentFocus, keywords, description, brandVoice }` → Iconify SVG URLs.
- **Payload:** `analysis-result` and final job `result.analysis` now include **`iconUrls`** with the same keys. Frontend can pass `analysis.iconUrls.businessType` (etc.) to `AnalysisCard` `iconUrl` / `iconFallback`.

---

## 5. Result shape (analysis + scenarios)

- **Complete event:** For `website_analysis` jobs, the worker now ensures **`result.analysis.scenarios`** is set when `result.scenarios` exists, so the frontend can use either `result.scenarios` or `result.analysis.scenarios` in `mapWebsiteAnalysisResult(result)`.
- **analysis-result:** Already included `scenarios` when emitted from cache (with backfill). Live run emits `analysis-result` before audiences; `audiences-result` / `scenarios-result` and `complete` provide scenarios.

---

## 6. Checklist (from handoff)

| # | Item | Done |
|---|------|------|
| 1 | Ensure `analysis-result` and final `result.analysis` include `scenarios` when ready (or emit `audiences-result` / `scenarios-result`) | ✅ Worker adds `result.analysis.scenarios`; pipeline already emits audiences/scenarios events. |
| 2 | Emit `audience-narration-chunk` / `audience-narration-complete` | ✅ Via `GET /api/v1/analysis/narration/audience`. |
| 3 | Emit `topic-narration-chunk` / `topic-narration-complete` | ✅ Via `GET /api/v1/analysis/narration/topic`. |
| 4 | Emit `content-narration-chunk` / `content-narration-complete` | ✅ Via `GET /api/v1/analysis/narration/content`. |
| 5 | PATCH organization: `analysis_confirmed_at`, `analysis_edited`, `edited_fields` | ✅ Via `POST /api/v1/analysis/confirm`. |
| 6 | generateCleanedEdit (LLM-cleaned suggestion) | ✅ `POST /api/v1/analysis/cleaned-edit`. |
| 7 | generateAnalysisIcons / icon URLs for analysis cards | ✅ `analysis.iconUrls` in analysis payload. |
| 8 | Rename “scraping-thought” → “analysis-status-update” | ✅ Events and docs. |

---

## 7. Run migration

Before using confirm/edit fields:

```bash
psql $DATABASE_URL -f database/migrations/035_organization_analysis_confirm_edit.sql
```

(Or run your usual migration runner.)
