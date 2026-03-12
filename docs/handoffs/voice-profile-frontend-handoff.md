# Voice profile — frontend handoff

Short handoff so the frontend **fetches and displays voice profile data correctly** and avoids stale "processing" state. Full API detail: [voice-adaptation-frontend-handoff.md](./voice-adaptation-frontend-handoff.md).

---

## 1. Endpoints to use

| Purpose | Method | URL | Notes |
|--------|--------|-----|--------|
| List samples (and their status) | `GET` | `/api/v1/voice-samples/:organizationId` | Poll this until no sample is `pending` or `processing`. |
| Get aggregated voice profile | `GET` | `/api/v1/voice-samples/:organizationId/profile` | Use this for the "voice profile" UI. Returns `profile: null` when there is no profile yet. |
| Upload samples | `POST` | `/api/v1/voice-samples/upload` | `multipart/form-data`: `organizationId`, `sourceType`, `files[]`. |

All require **JWT**: `Authorization: Bearer <token>`. User must be the **owner** of the organization.

---

## 2. Getting the profile response right

**GET** `/api/v1/voice-samples/:organizationId/profile`

- **200** response shape:
  - `success: true`
  - `profile`: raw profile object or **`null`** (when org has no aggregated profile).
  - `voiceProperties`: array of display sections (only present when `profile` is non-null).
  - `derivedDirectives`: array of rule strings (only present when `profile` is non-null).

When **`profile` is null** (no samples or none completed yet), the backend still returns 200 with `profile: null`. Do not treat that as an error; treat it as "no voice profile yet" and show empty state / upload CTA.

**Profile object** (when non-null) includes:
- `id`, `organization_id`, `sample_count`, `total_word_count`, `confidence_score`
- `style`, `vocabulary`, `structure`, `formatting` (JSON objects)
- `created_at`, `updated_at`

**voiceProperties** (display-ready):
- Array of `{ section: string, items: Array<{ key, label, value }> }`.
- Use `section` as the heading; use `label` and `value` for each trait. Format `value` per type (string, number, array, etc.).

**derivedDirectives**:
- Array of strings: rules applied during blog generation. Show as a "Rules applied" or "Voice rules" list.

---

## 3. Avoiding stale "processing" and showing profile when ready

- **Source of truth for "is analysis done?"** is the **samples list**, not the profile.
- After upload, samples start as `processing_status: "pending"`. The worker then sets `"processing"` and finally `"completed"` or `"failed"`.
- **Do not** rely only on a one-time fetch of the profile or samples. If the user just uploaded or navigated back to the page, **refetch**.

**Recommended behavior:**

1. **After upload:** Refetch the samples list; poll **GET** `/api/v1/voice-samples/:organizationId` (e.g. every 5s) while any sample has `processing_status` in `["pending", "processing"]`. Stop polling when every sample is `completed` or `failed`.
2. **When showing the voice profile:** Once all samples are `completed` or `failed`, call **GET** `/api/v1/voice-samples/:organizationId/profile` and render from that. If `profile` is non-null and `confidence_score >= 50`, consider the profile "ready" for generation.
3. **On page/route focus:** When the user lands on or returns to the voice samples / profile page, **always refetch** the samples list (and profile if you show it). Do not rely on cached list data, or the UI can show "processing" long after the backend has already set samples to `completed`.

**Summary:** Poll the **list** until no sample is in progress; then fetch the **profile** once to display it. Invalidate list (and profile) cache when entering the page or after upload.

---

## 4. Checklist for frontend

- [ ] Use **GET** `/api/v1/voice-samples/:organizationId` for the samples table and for "analysis in progress" state.
- [ ] Use **GET** `/api/v1/voice-samples/:organizationId/profile` for the aggregated voice profile UI.
- [ ] Handle `profile: null` as "no profile yet" (empty state), not as an error.
- [ ] Render profile from `voiceProperties` (sections + items with `label`/`value`) and `derivedDirectives`.
- [ ] After upload, poll the list until no sample is `pending` or `processing`; then fetch profile.
- [ ] Refetch list (and profile) when the user navigates to the voice page so the UI is not stuck on stale "processing".

---

## 5. Quick reference: profile response example

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
    "Use first-person (we, I) and direct address (you) throughout.",
    "Use bullet lists for key points.",
    "ALWAYS end with a personal sign-off on its own line (e.g. -Author Name)."
  ]
}
```

When there is no profile yet:

```json
{
  "success": true,
  "profile": null
}
```

(`voiceProperties` and `derivedDirectives` are omitted when `profile` is null.)
