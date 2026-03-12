# Brand Voice from Social Media — Proposal

## Goal

Tailor generated blog posts to the brand’s voice by discovering the brand’s social profiles, scraping (or otherwise ingesting) their content, and using it to enrich existing brand-voice signals (website analysis, blog content analysis, manual inputs).

## Current State

- **Brand voice today** is derived from:
  1. **Website analysis** (`prompts/website-analysis.js`) → `organizations.brand_voice` (short label, e.g. “Professional, friendly”).
  2. **Blog content analysis** (`services/blog-analyzer.js` → `analyzeContentPatterns`) → intended for `content_analysis_results.tone_analysis`, `style_patterns`, `brand_voice_keywords` (when that row is persisted).
  3. **Manual inputs** (`user_manual_inputs` with `input_type = 'brand_voice'`).
- **Blog generation** (`services/enhanced-blog-generation.js`) builds brand context in this order: `websiteData.tone_analysis` → `manualData.brand_voice` → fallback from `businessType` + `brandVoice`.
- **Existing infra**: `webscraper` (Puppeteer/Playwright + Cheerio), `website_pages.external_links`, CTA extraction with `href`s. No dedicated “social link” extraction or social content ingestion.

---

## Proposed Approach

### 1. Discover social handles from the website

**Where:** Extend the existing scrape/analysis flow so we collect “social” links as well as CTAs.

- **During scrape** (e.g. in `webscraper` when processing homepage/footer/contact or all discovered pages):
  - Collect all `<a href="...">` whose `href` matches known social base domains.
- **Patterns to recognize** (and parse handle/ID from URL):
  - **Twitter/X:** `twitter.com/*`, `x.com/*` → username or `/company/...`
  - **LinkedIn:** `linkedin.com/company/*` → company slug
  - **Facebook:** `facebook.com/*`, `fb.com/*`, `fb.me/*` → page username or ID
  - **Instagram:** `instagram.com/*` → username
  - **YouTube:** `youtube.com/c/*`, `youtube.com/@*`, `youtube.com/channel/*` → channel handle or ID
  - **TikTok:** `tiktok.com/@*` → username

**Output:** A list of normalized social profiles, e.g.:

```json
{
  "twitter": ["@acme"],
  "linkedin": ["company/acme"],
  "instagram": ["acme"],
  "facebook": ["acme"],
  "youtube": ["@acme"]
}
```

**Optional:** Allow **manual override** via `user_manual_inputs` (e.g. `input_type = 'social_handles'`) or a dedicated org field so users can add/correct handles.

---

### 2. Store social handles

**Option A (recommended):** Add a JSONB column on `organizations`:

- `social_handles JSONB DEFAULT '{}'`
- Example: `{ "twitter": ["@acme"], "linkedin": ["company/acme"], "instagram": ["acme"] }`
- One source of truth; easy to merge with manual overrides in app logic.

**Option B:** New table `organization_social_profiles (organization_id, platform, handle, discovered_at, source)` for finer auditing and history.

**Suggestion:** Start with Option A; add a migration and optionally an index (e.g. GIN on `social_handles`) if you query by platform.

---

### 3. Ingest content from social (how to get “copy” for voice)

Voice is inferred from **text** (posts, captions, bios). Options:

| Method | Pros | Cons |
|--------|------|------|
| **Official APIs** | Stable, ToS-friendly, structured | API keys, quotas, cost; some platforms limited (e.g. LinkedIn, Instagram) |
| **Scraping** | No keys for public profiles | Fragile (markup changes, anti-bot), ToS/legal risk, rate limits |
| **User-provided copy** | No ToS/blocking issues | Manual; not “auto” discovery |

**Recommendation:**

- **Prefer APIs where you already have or can add keys:**
  - **Twitter/X:** Twitter API v2 (tweets from a user) — you already have `grok-tweet-search.js`; could add “fetch recent tweets by handle” for the org’s handle.
  - **YouTube:** YouTube Data API (channel → recent video titles/descriptions) — you have `youtube-video-search.js`; could fetch by channel handle.
- **Scraping as fallback or for limited use:**
  - Use existing `webscraper` (or a light Cheerio flow) only for **public profile pages** (e.g. one landing page per platform) to grab visible bio + recent post text, with strict rate limiting and clear boundaries (e.g. “last N posts” or “profile + 1 page of feed”).
  - Prefer **RSS/public feeds** if available (e.g. blog links from Twitter profile, YouTube channel description).
- **Optional manual path:** Let users paste “sample social copy” or upload a text file; store as manual input and feed into the same voice-analysis step (same as below).

**Implementation sketch:**

- New **service** (e.g. `services/social-voice-ingestion.js`):
  - Input: `organizationId` (or `organization` row with `website_url`, `social_handles`).
  - For each platform in `social_handles`:
    - If API available and configured: fetch recent posts/captions/titles/descriptions (e.g. last 20–50 items).
    - Else (or in addition): optional lightweight scrape of profile page + recent feed snippet.
  - Output: **one merged text corpus** per organization (e.g. concatenate posts with platform labels so the model can weight by platform if needed).

---

### 4. Derive voice from social content

- **New function** (in the new service or in `blog-analyzer`): “analyze voice from social corpus.”
  - Input: Aggregated social text (and optionally existing `tone_analysis` / `brand_voice_keywords` from blog/website).
  - Call OpenAI (same style as `analyzeContentPatterns`) with a prompt that asks for:
    - **Tone:** e.g. professional / casual / witty / inspirational.
    - **Style:** sentence length, use of questions, pronouns, emojis, hashtags.
    - **brand_voice_keywords:** recurring phrases, topic clusters, vocabulary.
  - Output: Same shape as current blog-derived analysis: `tone_analysis` (JSONB), `style_patterns` (JSONB), `brand_voice_keywords` (array).

**Merge strategy:**

- **Option 1:** Write to the same `content_analysis_results` row (or the same logical “current” row) and **merge** with existing blog/website analysis (e.g. average or “social overrides when present”).
- **Option 2:** Add a dedicated row or table (e.g. `social_voice_analysis`) and have **blog generation** merge in `getOrganizationContext`: when building `brandContext`, combine `websiteData.tone_analysis` + `websiteData.social_voice` (or `websiteData.brand_voice_keywords` + social keywords).

Recommendation: **Option 2** so you keep “website/blog voice” and “social voice” separate and can weight or A/B test later (e.g. “prefer social when available”).

---

### 5. When to run discovery and ingestion

- **Discovery (find handles):**
  - Run once during **website analysis** (e.g. after scraping homepage/footer in `website-analysis-pipeline.js`), or
  - Run as part of **content discovery** (`POST /api/v1/analysis/discover-content`) so handles are found when you already scrape the site.
- **Ingestion + voice analysis:**
  - **Trigger:** After discovery, or on a **“Refresh social voice”** action (e.g. `POST /api/v1/organizations/:id/refresh-social-voice`).
  - **Recurring (optional):** Cron job to refresh social corpus and re-run voice analysis every N days for orgs that have `social_handles` set.

---

### 6. API surface (suggested)

| Endpoint | Purpose |
|----------|--------|
| `GET /api/v1/organizations/:id/social-handles` | Return discovered + manual social handles. |
| `PATCH /api/v1/organizations/:id/social-handles` | Manual set/override of handles (e.g. from onboarding). |
| `POST /api/v1/organizations/:id/refresh-social-voice` | Re-run: fetch social content → analyze voice → persist (and optionally update `data_availability.has_brand_voice`). |

---

### 7. Data flow summary

```
Website URL
    → Scrape (existing + new: extract social links)
    → Normalize to handles
    → Store in organizations.social_handles (or manual override)

social_handles
    → Ingest content (APIs first, optional scrape)
    → Build “social corpus” text

Social corpus (+ optional existing tone_analysis)
    → OpenAI “analyze voice”
    → tone_analysis, style_patterns, brand_voice_keywords (social)

Persist (e.g. social_voice_analysis or merged into content_analysis_results)
    → getOrganizationContext() includes social voice
    → Enhanced blog generation uses combined brand context
```

---

### 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Scraping breaks (ToS, markup changes) | Prefer APIs; limit scraping to profile page only; rate limit; document “best effort.” |
| Rate limits / API quotas | Cache social corpus per org; refresh on demand or on a slow cron (e.g. weekly). |
| Low-quality or sparse social content | Require minimum token count before running voice analysis; fall back to existing website/blog voice. |
| PII in social content | Do not store raw posts long-term if not needed; store only derived tone/keywords, or short excerpts. |

---

### 9. Implementation order

1. **Migration:** Add `organizations.social_handles` (JSONB).
2. **Discovery:** In webscraper (or pipeline), extract links matching social domains and parse handles; write to `social_handles`.
3. **APIs:** Implement “fetch recent tweets by handle” (Twitter) and “fetch channel info + recent titles/descriptions” (YouTube) in existing or new service.
4. **Social ingestion service:** `social-voice-ingestion.js` that takes `organizationId`, reads `social_handles`, calls APIs (and optionally limited scrape), returns one text corpus.
5. **Voice-from-social:** Function that takes corpus → OpenAI → `tone_analysis` + `style_patterns` + `brand_voice_keywords`; persist to new table or merged into existing analysis.
6. **Blog generation:** In `getOrganizationContext` / brand-context building, include social-derived voice and merge with existing signals.
7. **Endpoints:** GET/PATCH social handles, POST refresh-social-voice.
8. **(Optional)** Manual input type `social_handles` and UI for override.

This keeps the existing brand-voice pipeline intact and adds social as an optional, enrichable layer that fits your current architecture.
