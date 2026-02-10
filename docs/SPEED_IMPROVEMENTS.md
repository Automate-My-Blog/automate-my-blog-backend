# Speed Improvements

Summary of performance changes and further opportunities.

## Done

### Topic ideas stream (streaming)
- **File:** `services/openai.js` — `generateTrendingTopicsStream()`
- **Change 1:** DALL·E images for topics are generated in parallel via `Promise.all` instead of sequentially. Total image wait ≈ max(per image) instead of sum.
- **Change 2:** Pipeline parallelism — start DALL·E for each topic as soon as that topic is streamed from GPT, instead of waiting for the full GPT stream to finish. Image generation for topic 1 now overlaps with GPT still producing topic 2.
- **Change 3 (speed):** Faster default model for topics (`OPENAI_TOPICS_MODEL` or `OPENAI_MODEL` or `gpt-4o-mini`), shorter system/user prompts to reduce tokens and time-to-first-token, `max_tokens: 1024` (enough for 2 topics), and a shorter DALL·E prompt in `generateTopicImage()`.
- **Impact:** Roughly halves topic-stream time when 2 topics (each with an image); total wall time is now closer to max(GPT stream, one DALL·E) instead of GPT stream + max(DALL·E). Shorter prompts and faster model reduce GPT phase latency further.

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
- **Fast path (related-content):** When the topic title is already search-friendly (2–4 concrete words, no abstract terms), both tweet and YouTube query extractions are skipped and the title is used directly. Saves ~2–5s (two OpenAI calls) on many requests. Same heuristic as news search (`isSearchFriendlyTitle`).
- **Grok timeout:** Grok tweet search timeout is 25s by default so `/related-content` returns sooner when xAI is slow; videos still return. Set `GROK_TWEET_SEARCH_TIMEOUT_MS=60000` if you need to allow longer for tweets.
- **Grok prompt:** Prompt shortened to reduce first model turn; timing logged on every call (`[GROK] Tweet search completed in Xms`). Set `GROK_DEBUG=1` for verbose response-structure logs.

### Why Grok tweet search is slow (10–30+ seconds)

The xAI Agent Tools API does **not** expose a “run this search query, return raw results” endpoint. Every request is **agentic**:

1. **Model turn 1:** Grok reads our prompt, decides to call `x_search`, chooses a search query, and invokes the tool.
2. **Server-side:** `x_search` runs (xAI → X/Twitter backend); latency is outside our control.
3. **Model turn 2:** Grok receives tool results and formats the final JSON.

So we pay for **two full model round-trips** plus one external search. `max_turns: 1` limits to a single tool use but we still need both the “call tool” and “format answer” phases. We use `grok-4-1-fast` (not the reasoning variant), a short prompt, and `max_tokens: 800` to keep things as fast as the API allows. Further gains would require xAI to offer a direct search API or faster tool path.

## Possible next steps

- **`webscraper.scrapeBlogPosts()`** — Currently sequential with 1s delay between posts. Could run with a concurrency limit (e.g. 2 at a time) to reduce total time; each call launches a browser so full parallel would be memory-heavy.
- **`visual-content-generation.batchGenerate()`** — Sequential over requests; could use `Promise.all` with a concurrency cap if batch size grows.
- **Website analysis / content generation** — Already use parallel where applicable (e.g. business + keyword research). Further gains would need profiling (prompt size, model choice, or streaming earlier).
- **Caching** — Consider short-lived caching for repeated same-URL or same-params calls (e.g. topic generation, analysis) if the product allows slightly stale data.
