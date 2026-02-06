# Speed Improvements

Summary of performance changes and further opportunities.

## Done

### Topic ideas stream (streaming)
- **File:** `services/openai.js` — `generateTrendingTopicsStream()`
- **Change:** DALL·E images for topics are generated in parallel via `Promise.all` instead of sequentially. Total image wait ≈ max(per image) instead of sum.
- **Impact:** Roughly halves topic-stream time when 2 topics (each with an image).

### Topic ideas (non-streaming)
- **File:** `services/openai.js` — `generateTrendingTopics()`
- **Change:** Same parallel DALL·E image generation for the non-streaming `POST /api/trending-topics` path.
- **Impact:** Same as above for the single-request topic generation flow.

### Blog content analysis
- **File:** `services/blog-analyzer.js` — `analyzeBlogContent()`
- **Change:** Steps 3–5 (analyzeCTAs, analyzeInternalLinking, analyzeContentPatterns) run in parallel with `Promise.all`; they only depend on `detailedPosts` and org/url.
- **Impact:** Blog analysis wall time ≈ max(CTA, linking, content) instead of sum of the three.

### Related tweets / videos search
- **Query extraction:** Tweet, YouTube, and news query-extraction prompts now use `content.substring(0, 1500)` instead of 3000 to reduce token count and latency (same quality for single-query extraction).
- **Combined endpoint:** `POST /api/v1/enhanced-blog-generation/related-content` with `{ topic, businessInfo, maxTweets?, maxVideos? }` runs tweet and video pipelines in parallel: both query extractions in parallel, then both searches in parallel. Use this when the UI needs both tweets and videos for a topic so total time is ~max(tweet path, video path) instead of sum. Response: `{ tweets, videos, searchTermsUsed: { tweets, videos } }`.

## Possible next steps

- **`webscraper.scrapeBlogPosts()`** — Currently sequential with 1s delay between posts. Could run with a concurrency limit (e.g. 2 at a time) to reduce total time; each call launches a browser so full parallel would be memory-heavy.
- **`visual-content-generation.batchGenerate()`** — Sequential over requests; could use `Promise.all` with a concurrency cap if batch size grows.
- **Website analysis / content generation** — Already use parallel where applicable (e.g. business + keyword research). Further gains would need profiling (prompt size, model choice, or streaming earlier).
- **Caching** — Consider short-lived caching for repeated same-URL or same-params calls (e.g. topic generation, analysis) if the product allows slightly stale data.
