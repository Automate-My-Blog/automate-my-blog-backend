# Social voice / brand voice from social media — development status

This document maps **current implementation** to the full plan in [brand-voice-from-social-media-proposal.md](./brand-voice-from-social-media-proposal.md) and states what is done, what is next, and what is out of scope for the current phase.

---

## Plan summary (from proposal)

| # | Item | Description |
|---|------|--------------|
| 1 | Discover social handles | Extract social links from website scrape; normalize to handles per platform. |
| 2 | Store social handles | Persist on organization (e.g. `organizations.social_handles` JSONB). |
| 3 | Ingest content from social | Fetch posts/captions from APIs or limited scrape. |
| 4 | Derive voice from social | OpenAI analysis of social corpus → tone_analysis, style_patterns, brand_voice_keywords. |
| 5 | When to run | Discovery during analysis; ingestion/voice on “Refresh social voice” or cron. |
| 6 | API surface | GET/PATCH social-handles, POST refresh-social-voice. |
| 7 | Data flow | Website → scrape → handles → (future) ingest → voice analysis → blog context. |
| 8 | Risks | ToS, rate limits, low-quality content; mitigations in proposal. |
| 9 | Implementation order | Migration → discovery → APIs → ingestion service → voice-from-social → blog merge → endpoints. |

---

## Current status (this PR / branch)

### Done (implemented)

| Plan item | Status | Where |
|-----------|--------|--------|
| **1. Discover social handles** | Done | `services/webscraper.js`: `_parseSocialHandle()`, `_buildSocialHandlesObject()`, `_extractContentAndCTAsFromHTML()` collects social links from all `<a href>`. All scrape paths (Cheerio fast path, Cheerio fallback, Browserless, Puppeteer, Playwright) return `socialHandles`. Platforms: Twitter/X, LinkedIn company, Facebook, Instagram, YouTube (c / @ / channel), TikTok. |
| **2. Store social handles** | Done | Migration `036_add_organizations_social_handles.sql`: `organizations.social_handles` JSONB + GIN index. `website-analysis-pipeline.js` `persistAnalysis()` writes `social_handles` when scrape returns non-empty `socialHandles`. |
| **6. API surface** | Done | `routes/organizations.js`: `GET /:organizationId/social-handles`, `PATCH /:organizationId/social-handles`, `POST /:organizationId/refresh-social-voice`. POST re-scrapes `website_url` and overwrites `social_handles` (discovery only; no ingestion or voice analysis yet). |
| **7. Data flow (partial)** | Done | Website URL → scrape → extract social links → normalize handles → store in `organizations.social_handles`. Manual override via PATCH. Refresh via POST (re-run discovery). |

### Not done (next phases)

| Plan item | Status | Notes |
|-----------|--------|--------|
| **3. Ingest content from social** | Not started | Need `social-voice-ingestion.js` (or similar): read `social_handles`, call Twitter/YouTube APIs (and optionally limited scrape), build one text corpus per org. |
| **4. Derive voice from social** | Not started | New function: social corpus → OpenAI → `tone_analysis`, `style_patterns`, `brand_voice_keywords`. Persist (e.g. `social_voice_analysis` or merge into `content_analysis_results`). |
| **5. When to run (ingestion/voice)** | Partial | Discovery runs in website analysis and via POST refresh. Ingestion + voice analysis not implemented; POST refresh currently only re-runs **discovery** (scrape → handles), not “fetch social content → analyze voice.” |
| **Blog generation merge** | Not started | `getOrganizationContext` / brand-context building does not yet read social-derived voice. Will do once step 4 exists. |
| **APIs (Twitter/YouTube by handle)** | Not started | Proposal step 3: “fetch recent tweets by handle,” “fetch channel info + recent titles/descriptions.” To be added in ingestion phase. |
| **Optional: manual input type** | Not started | `user_manual_inputs` with `input_type = 'social_handles'` for override; optional and can stay as PATCH-only. |

---

## Data flow: current vs full

**Current (this branch):**

```
Website URL
  → Scrape (existing + social link extraction)
  → Normalize to handles
  → Store in organizations.social_handles

GET/PATCH social-handles  → read/update handles
POST refresh-social-voice → re-scrape website_url → overwrite social_handles
```

**Full plan (future):**

```
… (current flow) …

social_handles
  → Ingest content (APIs + optional scrape)
  → Build “social corpus” text

Social corpus
  → OpenAI “analyze voice”
  → tone_analysis, style_patterns, brand_voice_keywords (social)

Persist social voice
  → getOrganizationContext() includes social voice
  → Enhanced blog generation uses combined brand context
```

---

## Deliverables in this branch

- **Migration:** `database/migrations/036_add_organizations_social_handles.sql`
- **Discovery:** `services/webscraper.js` (parse + extract + pass through `socialHandles`)
- **Storage:** `services/website-analysis-pipeline.js` (persist in `persistAnalysis`)
- **APIs:** `routes/organizations.js` (GET/PATCH social-handles, POST refresh-social-voice)
- **Docs:** [social-handles-frontend-handoff.md](./social-handles-frontend-handoff.md), this status doc

---

## Suggested next steps (post-merge)

1. **Ingestion service:** Implement `services/social-voice-ingestion.js`: given `organizationId`, read `social_handles`, call Twitter API (and/or YouTube Data API) for recent posts/titles/descriptions, return one merged text corpus.
2. **Voice-from-social:** Add function (in ingestion service or blog-analyzer) to analyze corpus with OpenAI and produce `tone_analysis`, `style_patterns`, `brand_voice_keywords`; persist to a dedicated table or merge into `content_analysis_results`.
3. **POST refresh-social-voice behavior:** Extend so that when “refresh” is requested, it can optionally run discovery **and** ingestion + voice analysis (or add a separate “Refresh social voice analysis” endpoint).
4. **Blog generation:** In `getOrganizationContext` (or equivalent), include social-derived voice and merge with existing website/blog/manual brand signals.

---

## Testing and lint

- **Tests:** Full unit test suite (`npm run test`) passes (26 test files, 326 tests passed; 6 integration files skipped in default run).
- **Lint:** No ESLint in repo. CI code-quality workflow runs console.log / TODO checks (non-blocking). No new console.log in the new social-handles route handlers.
