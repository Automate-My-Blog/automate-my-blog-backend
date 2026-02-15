# Voice workflow test: "The Captain" persona

Use these files to fully test the parse-voice workflow (upload → analyze → aggregated profile → blog generation with voice).

## Persona: The Captain

A **deliberately distinctive** voice so generated content is easy to compare:

- **Style:** Terse. Short sentences. Nautical metaphors. No fluff.
- **Perspective:** Second person ("you") and "we." Direct address.
- **Vocabulary:** Nautical and action words: ship shape, all hands, steady, bearing, chart, course, anchor, deck.
- **Signature phrases:** "Clear?" "Ship shape." "Steady as she goes." "Plot your course." "All hands."
- **Structure:** Bullets and short paragraphs. Questions to engage. Clear headings.
- **Formatting:** Headings. Bullet lists. Occasional bold for emphasis. No long blocks.

When voice adaptation is working, generated blogs should sound like The Captain. When it's off or generic, they won't.

**Example outputs (same topic, for comparison):**
- `blog-with-voice.md` — with voice adaptation (Captain persona)
- `blog-without-voice.md` — without voice (generic tone)

## Supported source types and files

| sourceType     | File                    | Format | Notes                    |
|---------------|-------------------------|--------|--------------------------|
| blog_post     | persona-blog.md         | .md    | Short blog in Captain voice |
| whitepaper    | persona-whitepaper.md   | .md    | Sectioned “whitepaper”   |
| email         | persona-email.eml       | .eml   | RFC 822 email            |
| newsletter    | persona-newsletter.html | .html  | Newsletter HTML          |
| social_post   | persona-social.json     | .json  | Array of post objects    |
| call_summary  | persona-call-summary.txt| .txt   | Meeting/call notes       |
| other_document| persona-other.txt       | .txt   | General document         |
| social_post   | persona-social.csv     | .csv   | Optional; text column    |

## Full workflow (manual test)

1. **Auth:** Get a JWT for a user that owns an organization.
2. **Upload samples** (one or more per request):
   ```bash
   curl -X POST http://localhost:3001/api/v1/voice-samples/upload \
     -H "Authorization: Bearer YOUR_JWT" \
     -F "organizationId=YOUR_ORG_UUID" \
     -F "sourceType=blog_post" \
     -F "files=@persona-blog.md"
   ```
   Repeat for other source types (or send multiple `files` with one sourceType per request; for different types, send separate requests).
3. **Worker:** Ensure job worker is running (`npm run worker`) so `analyze_voice_sample` jobs run (Redis + DATABASE_URL required).
4. **Profile:** GET `GET /api/v1/voice-samples/:organizationId/profile` to see aggregated profile once analyses complete.
5. **Generate with voice:** Use enhanced blog generation with that organization; context should include voice profile and generated posts should reflect The Captain voice.
6. **Compare:** Call generation with `useVoiceProfile: false` to get generic output and compare.

## Verify fixtures locally

From repo root:

```bash
node fixtures/voice-workflow-test/verify-fixtures.js
```

This runs the real file extractors on each fixture and prints word counts. All should succeed.

## Run full workflow

### Against live staging (API)

Requires staging base URL and auth (email+password or JWT). Worker must be running on staging so `analyze_voice_sample` jobs run.

Staging base URL: `https://automate-my-blog-backend-env-staging-automate-my-blog.vercel.app`

```bash
BASE_URL=https://automate-my-blog-backend-env-staging-automate-my-blog.vercel.app \
STAGING_TEST_EMAIL=you@example.com \
STAGING_TEST_PASSWORD=yourpassword \
node fixtures/voice-workflow-test/run-full-workflow.js
```

Or with a JWT: `BASE_URL=... STAGING_JWT=eyJ... node fixtures/voice-workflow-test/run-full-workflow.js`

The script: logs in (or uses JWT), uploads all Captain fixtures, polls until analyses complete, fetches the aggregated profile, and checks that context includes voice when `useVoiceProfile=true`.

### Local (DB + OpenAI, no HTTP/Redis)

Runs extractors, inserts samples, calls the voice-analyzer service, and checks the aggregated profile. No server or worker needed.

```bash
DATABASE_URL=postgresql://... OPENAI_API_KEY=sk-... \
node fixtures/voice-workflow-test/run-full-workflow-local.js
```

Creates a temporary org and samples, runs analysis, prints profile, then deletes the test org.

## File types accepted by API

- **Extensions:** .txt, .md, .html, .csv, .pdf, .docx, .json, .eml
- **sourceType** is set in the request body; it does not have to match the file extension (e.g. .md can be `blog_post` or `whitepaper`).
