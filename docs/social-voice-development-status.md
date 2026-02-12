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
| **1. Discover social handles** | Done | `services/webscraper.js`: `_parseSocialHandle()`, `_buildSocialHandlesObject()`, `_extractContentAndCTAsFromHTML()` collects social links from `<a href>`, `<meta name="twitter:creator">`, and JSON-LD `sameAs`. All scrape paths return `socialHandles`. Host-aware parsing. Platforms: Twitter/X, LinkedIn, Facebook, Instagram, YouTube, TikTok, GitHub, Reddit, Pinterest, Medium, Substack, Mastodon, Threads, Bluesky, Tumblr, Vimeo, Dribbble, Behance, SoundCloud, Twitch, Telegram, Patreon, Linktree, Snapchat, Ko-fi, Buy Me a Coffee, Discord. Unit tests in `tests/unit/social-handles-parser.test.js`. |
| **2. Store social handles** | Done | Migration `036_add_organizations_social_handles.sql`: `organizations.social_handles` JSONB + GIN index. `website-analysis-pipeline.js` `persistAnalysis()` writes `social_handles` when scrape returns non-empty `socialHandles`. |
| **3. Ingest content from social** | Done | `services/social-voice-ingestion.js`: reads `social_handles`, calls YouTube Data API (channel by handle → recent video titles/descriptions) and Grok x_search (tweets by handle via `from:handle`). Returns one merged text corpus per org. |
| **4. Derive voice from social** | Done | `analyzeVoiceFromSocialCorpus()` in `social-voice-ingestion.js`: corpus → OpenAI → `tone_analysis`, `style_patterns`, `brand_voice_keywords`. Persisted to `social_voice_analysis` (migration 037). |
| **5. When to run (ingestion/voice)** | Done | POST refresh-social-voice runs discovery (scrape → handles) then ingestion + voice analysis when corpus has enough content (≥50 words). |
| **6. API surface** | Done | `routes/organizations.js`: `GET /:organizationId/social-handles`, `PATCH /:organizationId/social-handles`, `POST /:organizationId/refresh-social-voice`. POST now runs discovery + ingestion + voice when applicable. |
| **7. Data flow (partial)** | Done | Website → scrape → handles → store. Refresh: scrape → handles → ingest (YouTube) → build corpus → OpenAI voice analysis → persist to `social_voice_analysis`. Blog merge not yet done. |
| **APIs (YouTube by handle)** | Done | `services/youtube-video-search.js`: `getChannelContentByHandle(handle)` uses channels.list (forHandle/id) + playlistItems + videos for recent titles/descriptions. |
| **APIs (Twitter/X by handle)** | Done | `services/grok-tweet-search.js`: `getRecentTweetsByHandle(handle, maxTweets)` uses xAI Agent Tools x_search with `from:handle` to fetch recent tweets from that user. |

### Not done (next phases)

| Plan item | Status | Notes |
|-----------|--------|--------|
| **Blog generation merge** | Not started | `getOrganizationContext` / brand-context building does not yet read from `social_voice_analysis`. Will merge social-derived voice with website/blog voice once wired. |
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
  → Ingest content (YouTube + Twitter/X by handle via Grok) → build corpus
  → If corpus ≥ 50 words: OpenAI voice analysis → persist to social_voice_analysis
```

**Remaining (future):**

```
social_voice_analysis
  → getOrganizationContext() includes social voice
  → Enhanced blog generation uses combined brand context
```

---

## Deliverables in this branch

- **Migrations:** `036_add_organizations_social_handles.sql`, `037_social_voice_analysis.sql`
- **Discovery:** `services/webscraper.js` (parse + extract + pass through `socialHandles`)
- **Storage:** `services/website-analysis-pipeline.js` (persist in `persistAnalysis`)
- **Ingestion:** `services/social-voice-ingestion.js` (ingest from handles, build corpus, analyze voice, persist)
- **YouTube by handle:** `services/youtube-video-search.js` (`getChannelContentByHandle`)
- **APIs:** `routes/organizations.js` (GET/PATCH social-handles, POST refresh-social-voice with ingestion + voice)
- **Docs:** [social-handles-frontend-handoff.md](./social-handles-frontend-handoff.md), this status doc

---

## Suggested next steps (post-merge)

1. **Blog generation:** In `getOrganizationContext` (or equivalent), read from `social_voice_analysis` when present and merge with existing website/blog brand signals.
2. **Twitter by handle:** Implemented via Grok `getRecentTweetsByHandle` (x_search with from:handle).
3. **Optional:** Cron to refresh social corpus + voice analysis periodically for orgs with `social_handles`.

---

## Testing and lint

- **Tests:** Full unit test suite (`npm run test`) passes (26 test files, 326 tests passed; 6 integration files skipped in default run).
- **Lint:** No ESLint in repo. CI code-quality workflow runs console.log / TODO checks (non-blocking). No new console.log in the new social-handles route handlers.
