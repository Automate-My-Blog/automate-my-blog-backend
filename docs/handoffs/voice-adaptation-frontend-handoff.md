# Voice adaptation — frontend handoff

This document describes how the frontend integrates with the **voice adaptation** workflow: uploading writing samples, viewing the aggregated voice profile, and generating blog content in the user's voice. It also covers the "your voice vs generic voice" comparison feature.

**Related:** [voice-comparison-api.md](./voice-comparison-api.md) (generate/context options and comparison UI), [frontend-job-queue-handoff.md](./frontend-job-queue-handoff.md) (job polling/streaming).

---

## 1. Overview

**Workflow:**

1. User uploads writing samples (blog posts, emails, newsletters, etc.) via **POST /api/v1/voice-samples/upload**.
2. Backend extracts text from each file, inserts a `voice_samples` row, and enqueues an `analyze_voice_sample` job.
3. A worker processes each job (OpenAI voice analysis) and updates the sample with style/vocabulary/structure/formatting. The worker then recomputes the **aggregated voice profile** for the org.
4. Frontend can **list samples** (and poll for `processing_status`: `pending` → `processing` → `completed` or `failed`) and **get the aggregated profile** when analyses complete.
5. Blog generation uses the voice profile by default. The frontend can pass **`options.useVoiceProfile: false`** to get generic output and show a **"your voice vs generic"** comparison.

---

## 2. Auth

All voice-samples endpoints require **logged-in user** (JWT). Session / anonymous users are not supported for voice samples.

- **Header:** `Authorization: Bearer <JWT>`
- **Org access:** User must be the **owner** of the organization (`owner_user_id = userId`). Other org members cannot access voice samples.
- **401** if not authenticated; **404** if org not found or access denied.

---

## 3. Voice samples API

Base path: **`/api/v1/voice-samples`**

### 3.1 Upload samples

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/voice-samples/upload`
- **Content-Type:** `multipart/form-data`
- **Body:**
  - `organizationId` (required): UUID of the org
  - `sourceType` (required): one of `blog_post`, `whitepaper`, `email`, `newsletter`, `social_post`, `call_summary`, `other_document`
  - `files`: one or more files (max 10 per request)
  - `title` (optional): sample title (used for all files if one sourceType)
  - `weight` (optional): 0.1–5.0, default 1.0 (influence in aggregation)

**Allowed file types:** `.txt`, `.md`, `.html`, `.csv`, `.pdf`, `.docx`, `.json`, `.eml`

**Response (201)**

```json
{
  "success": true,
  "samples": [
    {
      "id": "uuid",
      "source_type": "blog_post",
      "file_name": "my-post.md",
      "word_count": 133,
      "processing_status": "pending",
      "weight": 1,
      "created_at": "2026-02-12T...",
      "jobId": "job-uuid"
    }
  ]
}
```

- `jobId` may be omitted if job enqueue failed (sample still created; status remains `pending`).
- Per-file extraction errors: sample omitted from `samples`, or a partial error object in the array (check `error` field).

**Errors:** `400` (missing orgId, invalid sourceType, no files), `404` (org not found), `500` (server error).

---

### 3.2 List samples

**Request**

- **Method:** `GET`
- **URL:** `${API_BASE}/api/v1/voice-samples/:organizationId`

**Response (200)**

```json
{
  "success": true,
  "samples": [
    {
      "id": "uuid",
      "source_type": "blog_post",
      "file_name": "my-post.md",
      "title": "My Post",
      "word_count": 133,
      "quality_score": 80,
      "processing_status": "completed",
      "is_active": true,
      "weight": 1,
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

- `processing_status`: `pending` | `processing` | `completed` | `failed`
- Poll this endpoint (e.g. every 5s) until all samples are `completed` or `failed` before showing the aggregated profile as ready.

---

### 3.3 Get aggregated profile

**Request**

- **Method:** `GET`
- **URL:** `${API_BASE}/api/v1/voice-samples/:organizationId/profile`

**Response (200)**

```json
{
  "success": true,
  "profile": {
    "id": "uuid",
    "organization_id": "uuid",
    "style": { "voice_perspective": "second", "sentence_length_distribution": "short", ... },
    "vocabulary": { "formality_level": "casual", "signature_phrases": ["Clear?", "Ship shape."], ... },
    "structure": { ... },
    "formatting": { ... },
    "sample_count": 7,
    "total_word_count": 644,
    "confidence_score": 90,
    "created_at": "...",
    "updated_at": "..."
  },
  "voiceProperties": [
    {
      "section": "Writing style",
      "items": [
        { "key": "voice_perspective", "label": "Voice perspective", "value": "second" },
        { "key": "sentence_length_distribution", "label": "Sentence length", "value": "short" }
      ]
    },
    {
      "section": "Vocabulary & tone",
      "items": [
        { "key": "formality_level", "label": "Formality level", "value": "casual" },
        { "key": "signature_phrases", "label": "Signature phrases", "value": ["Clear?", "Ship shape."] }
      ]
    }
  ],
  "derivedDirectives": [
    "Use first-person (we, I) and direct address (you) throughout; prefer \"we have\" and \"I meet\" over third person.",
    "Use bullet lists for key points, milestones, and enumerations — do not use only paragraph prose.",
    "ALWAYS end with a personal sign-off on its own line (e.g. -Author Name).",
    "Prefer active voice; avoid passive constructions where possible."
  ]
}
```

- `profile` is `null` when the org has no aggregated profile yet (no samples or all pending/failed). When `profile` is `null`, `voiceProperties` and `derivedDirectives` are omitted.
- `confidence_score` (0–100): use to decide whether to show "voice ready" (e.g. ≥ 50).
- **`voiceProperties`**: Display-ready sections for rendering the voice profile in the UI. Each section has `section` (category label), and `items` with `key`, `label` (human-readable), and `value` (string, number, array, or object).
- **`derivedDirectives`**: Array of rule strings applied during blog generation. These are the "MANDATORY voice rules" derived from the profile. Show them in a "Rules applied" or "Generation rules" list.

---

### 3.4 Delete sample (soft delete)

**Request**

- **Method:** `DELETE`
- **URL:** `${API_BASE}/api/v1/voice-samples/:sampleId`

**Response (200)**

```json
{
  "success": true,
  "message": "Sample deactivated"
}
```

- Sample is soft-deleted (`is_active = false`). Aggregated profile is recomputed automatically.

---

### 3.5 Reanalyze sample

**Request**

- **Method:** `POST`
- **URL:** `${API_BASE}/api/v1/voice-samples/:sampleId/reanalyze`

**Response (200)**

```json
{
  "success": true,
  "message": "Reanalysis queued",
  "jobId": "job-uuid"
}
```

- Resets sample to `pending` and enqueues a new analysis job. Poll list endpoint to see when `processing_status` becomes `completed` again.

---

## 4. Context and generation (voice comparison)

Use **GET /api/v1/enhanced-blog-generation/context/:organizationId** to check if voice comparison is available:

- **Query:** `useVoiceProfile=false` — response `data.voiceProfile` is `null` (context as used for generic generation).
- **Response shape:**
  - `data`: full context (includes `voiceProfile` when `useVoiceProfile` not false).
  - `metadata.voiceComparisonSupported` (boolean): `true` when org has a usable voice profile (confidence ≥ 50).
  - `metadata.voiceProfileSummary`: when supported, `{ confidenceScore, sampleCount }`; otherwise `null`.

Use `metadata.voiceComparisonSupported` to show/hide the "Compare your voice vs generic" UI.

**Generate endpoints** accept `options.useVoiceProfile` (default `true`):

- `true`: use voice profile (your voice).
- `false`: omit voice profile (generic voice).

Response includes `voiceAdaptationUsed` and `voiceProfileConfidence` for labeling.

**Full details:** [voice-comparison-api.md](./voice-comparison-api.md).

---

## 5. Voice properties schema

All voice properties from the profile are surfaced via `profile.style`, `profile.vocabulary`, `profile.structure`, `profile.formatting`, and the display-ready `voiceProperties` array. Use `voiceProperties` for rendering—it provides human-readable labels and grouped sections.

### 5.1 Property keys and labels

| Category | Key | Label | Value type | Notes |
|----------|-----|-------|------------|-------|
| **style** | voice_perspective | Voice perspective | string | first / second / third |
| | sentence_length_distribution | Sentence length | string | short / medium / long or description |
| | paragraph_length_preference | Paragraph length | string | e.g. short, medium |
| | active_vs_passive_ratio | Active vs passive voice | string | description |
| | question_frequency | Question usage | string | e.g. occasional, frequent |
| | list_usage | List usage | string | e.g. frequent, moderate |
| **vocabulary** | formality_level | Formality level | string | casual to academic |
| | complexity_score | Vocabulary complexity | string/number | Flesch-Kincaid or description |
| | industry_terms | Industry terms | array/string | domain-specific terms |
| | signature_phrases | Signature phrases | array | e.g. ["Clear?", "Ship shape."] |
| | metaphor_humor_style | Tone and style | string | celebratory, warm, dry, etc. |
| **structure** | opening_hook_type | Opening style | string | anecdote, question, statistic, quote |
| | section_organization | Section organization | string | description |
| | transition_phrases | Transition phrases | array/string | connecting phrases |
| | evidence_style | Evidence and facts style | string | concrete milestones, numbers, etc. |
| | conclusion_type | Conclusion type | string | personal sign-off, summary, CTA |
| | personal_sign_off | Personal sign-off | boolean/string | whether author signs with name |
| **formatting** | heading_frequency | Heading frequency | string | e.g. frequent, moderate |
| | bullet_vs_numbered | List style | string | bullet vs numbered preference |
| | emphasis_style | Emphasis (bold/italic) | string | patterns used |
| | blockquote_usage | Blockquote usage | string | e.g. occasional, none |

### 5.2 derivedDirectives

`derivedDirectives` is an array of strings. Each string is a rule that the blog generator applies when producing content. Examples:

- "Use first-person (we, I) and direct address (you) throughout; prefer \"we have\" and \"I meet\" over third person."
- "Use bullet lists for key points, milestones, and enumerations — do not use only paragraph prose."
- "ALWAYS end with a personal sign-off on its own line (e.g. -Author Name)."
- "Prefer active voice; avoid passive constructions where possible."
- "Optionally weave in signature phrases such as: Clear?, Ship shape."

These map to profile traits (e.g. `voice_perspective: "first"` → first-person rule; `personal_sign_off: true` → sign-off rule). Display them in a "Rules applied to generation" or "Voice rules" section.

### 5.3 Suggested UI rendering

1. **Profile summary**: `sample_count`, `total_word_count`, `confidence_score`.
2. **Voice traits**: Iterate `voiceProperties`—each section gets a heading, each item shows `label` and `value` (format arrays as comma-separated or bullets).
3. **Rules**: Render `derivedDirectives` as a bullet list or checklist-style list.
4. **Empty state**: When `profile` is null or `voiceProperties` is empty, show "No voice profile yet" or "Upload samples to build your voice profile."

---

## 7. Suggested UI flow

1. **Voice samples page/section**
   - Upload: multipart form with `organizationId`, `sourceType` dropdown, file picker (multiple).
   - List: table of samples with `file_name`, `source_type`, `word_count`, `processing_status`, actions (delete, reanalyze).
   - Poll list every 5s while any sample has `processing_status` in `pending` | `processing`.
   - Show aggregated profile summary when `GET .../profile` returns non-null: `sample_count`, `total_word_count`, `confidence_score`. Use `voiceProperties` for the full trait list (by section) and `derivedDirectives` for rules applied during generation.

2. **Source type dropdown options**
   - `blog_post`, `whitepaper`, `email`, `newsletter`, `social_post`, `call_summary`, `other_document`

3. **File type validation**
   - Allow only: `.txt`, `.md`, `.html`, `.csv`, `.pdf`, `.docx`, `.json`, `.eml`. Show error before upload if user selects unsupported type.

4. **Voice comparison (optional)**
   - On blog generation screen: if `metadata.voiceComparisonSupported` is true, show "Compare your voice vs generic" toggle or button.
   - When enabled: call generate twice (once with `useVoiceProfile: true`, once with `false`) and display side-by-side. Use `voiceAdaptationUsed` / `voiceProfileConfidence` to label columns.

---

## 8. Job behavior

- Upload creates `analyze_voice_sample` jobs. A **worker** must be running (Redis + DATABASE_URL) to process them.
- Frontend does not need to poll job status directly. Poll **GET .../voice-samples/:organizationId** instead; `processing_status` on each sample reflects progress.
- If `jobId` is returned on upload, frontend could optionally subscribe to `GET /api/v1/jobs/:jobId/stream?token=...` for real-time updates, but polling the samples list is sufficient.

---

## 9. Test fixtures

Example persona and documents for testing the full workflow are in:

**`fixtures/voice-workflow-test/`**

- **The Captain** persona: terse, nautical, second-person voice for clear differentiation.
- Files: `persona-blog.md`, `persona-whitepaper.md`, `persona-email.eml`, `persona-newsletter.html`, `persona-social.json`, `persona-call-summary.txt`, `persona-other.txt`.
- Example outputs: `blog-with-voice.md` (Captain voice) vs `blog-without-voice.md` (generic).
- Run `node fixtures/voice-workflow-test/run-full-workflow.js` against staging (with `STAGING_TEST_EMAIL` / `STAGING_TEST_PASSWORD`) to verify end-to-end.

---

## 10. Errors and edge cases

| Case | Behavior |
|------|----------|
| Empty org, no samples | `GET .../profile` returns `profile: null`. `voiceComparisonSupported` is false. |
| All samples pending | Profile may be null or from a previous run. Poll list until analyses complete. |
| Sample extraction failed | Upload response may omit that sample or include `error` field. Do not retry same file without user fix. |
| Worker not running | Samples stay `pending`. Profile never updates. Show "Analysis in progress" and consider messaging if pending > 5 min. |
| Delete last sample | Profile is recomputed and may become empty (aggregation excludes inactive samples). |
