# Voice comparison: "Your voice" vs "Generic voice"

The backend supports generating two variants of the same post so the UI can show a **visual comparison** of "your voice" (adapted) vs "generic voice" (default AI).

**Full integration:** [voice-adaptation-frontend-handoff.md](./voice-adaptation-frontend-handoff.md) — upload samples, list, profile, context, and comparison UI.

## How it works

1. **With voice (default)**  
   Use the normal generate flow with no extra options. If the org has an aggregated voice profile with confidence ≥ 50, the prompt includes the VOICE & STYLE section and the model follows it.

2. **Without voice ("generic")**  
   Pass **`options.useVoiceProfile: false`** on generate. The prompt is built without the voice profile section, so the output is "generic" style. Same topic and other inputs; only voice adaptation is turned off.

3. **Response metadata**  
   Every generation response includes:
   - **`voiceAdaptationUsed`** (boolean): `true` when the prompt included the user’s voice profile and it was used; `false` for generic or when no profile exists.
   - **`voiceProfileConfidence`** (number | null): When `voiceAdaptationUsed` is true, the profile’s confidence score (0–100); otherwise `null`.

Use these to label the two columns in the comparison UI (e.g. "Your voice" vs "Generic voice").

## API

### Generate (POST)

- **POST /api/v1/enhanced-blog-generation/generate**  
  Body: `{ topic, businessInfo, organizationId, additionalInstructions?, ctas?, options? }`  
  - **options.useVoiceProfile** (boolean, default `true`):  
    - `true`: use voice profile if available (your voice).  
    - `false`: omit voice profile (generic voice).

- **POST /api/v1/enhanced-blog-generation/generate-stream**  
  Same body; same **options.useVoiceProfile**.

- **POST /api/v1/jobs/content-generation**  
  Same body; **options** (including **useVoiceProfile**) are stored in the job and passed through to generation.

Response (and stream `complete.result`) includes:
- `voiceAdaptationUsed: boolean`
- `voiceProfileConfidence: number | null`

### Context (GET)

- **GET /api/v1/enhanced-blog-generation/context/:organizationId**  
  - **Query:** `useVoiceProfile=false` — response `data` has `voiceProfile: null` (context as used for "generic" generation).
  - **Response metadata:**
    - **voiceComparisonSupported** (boolean): `true` when the org has a usable voice profile (confidence ≥ 50). Use this to show/hide the "Compare your voice vs generic" UI.
    - **voiceProfileSummary**: when `voiceComparisonSupported` is true, `{ confidenceScore, sampleCount }`; otherwise `null`.

## Frontend flow for comparison UI

1. Call **GET .../context/:organizationId**. If **metadata.voiceComparisonSupported** is true, show a "Compare your voice vs generic" control.
2. When the user asks for a comparison:
   - Call generate **twice** for the same topic/inputs:
     - Once with **options.useVoiceProfile: true** (or omit) → "Your voice".
     - Once with **options.useVoiceProfile: false** → "Generic voice".
   - Or run one job with `useVoiceProfile: true` and one with `useVoiceProfile: false`.
3. Display the two outputs side by side. Use **voiceAdaptationUsed** and **voiceProfileConfidence** in each result to label the columns and show confidence when relevant.

## Credits

Generating two posts (your voice + generic) consumes two credits unless you implement a dedicated "comparison" mode that returns both without saving (e.g. preview-only with `autoSave: false` for both).
