# GAN Writing Voice Profile Test

Scientific test: ingest a prospective client's blog collection (GAN Writing - 2024.docx), build a voice profile, generate a post in their tone, and score it against the original.

## Document

**Source:** `/Users/samhilll/Downloads/GAN Writing - 2024.docx` (or set `GAN_DOCX_PATH`)

**Content:** ffVC's GAN newsletter – weekly founder/VC updates with personal intros from Katie Weiss, structured sections (Gives, Asks, News, Reads, Detours), conversational tone, bullet lists, milestones.

**Reference excerpt:** `REFERENCE_EXCERPT.md` – Feb 8, 2026 intro used for scoring.

## Modes

### Local (recommended for clean scientific test)

Uses a **fresh org with only the GAN sample** so the profile is not diluted by other samples.

```bash
DATABASE_URL=postgresql://... OPENAI_API_KEY=sk-... \
GAN_DOCX_PATH=/path/to/GAN\ Writing\ -\ 2024.docx \
node scripts/gan-voice-test/run-gan-voice-test-local.js
```

Output:
- `scripts/gan-voice-test/output/gan-generated-post-local.md` – generated post
- `scripts/gan-voice-test/output/gan-voice-test-report-local.json` – scores and metadata

### Staging API

Uses existing org. Profile will merge with any existing samples (e.g. Captain fixtures) – may dilute GAN voice.

```bash
BASE_URL=https://automate-my-blog-backend-env-staging-automate-my-blog.vercel.app \
STAGING_TEST_EMAIL=... STAGING_TEST_PASSWORD=... \
GAN_DOCX_PATH=/path/to/GAN\ Writing\ -\ 2024.docx \
node scripts/gan-voice-test/run-gan-voice-test.js
```

## Scoring rubric

| Criterion | 1–10 | Description |
|-----------|------|-------------|
| **Tone match** | | Conversational, founder-friendly, celebratory |
| **Structure match** | | Bullet usage, sections, personal sign-off |
| **Vocabulary consistency** | | Similar phrases, we/I/you usage, milestones style |
| **Overall voice match** | | Holistic fit to reference |

Scoring is done via OpenAI (gpt-4o) comparing the generated post to the reference excerpt.

## Extract text only

```bash
node scripts/gan-voice-test/extract-docx.js
```

Saves to `scripts/gan-voice-test/gan-writing-extracted.txt`.
