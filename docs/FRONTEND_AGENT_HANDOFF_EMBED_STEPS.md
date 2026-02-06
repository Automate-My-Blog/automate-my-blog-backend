# Frontend agent handoff: Embed-fetch steps UI and passing data to backend

Use this as the **prompt/instructions for the frontend Cursor agent** (or frontend dev) so the UI shows "thinking" steps for fetching related tweets, videos, and news articles, then passes that data into content generation as the backend expects.

---

## Goal

1. **Show steps in the UI** while the app fetches related content (tweets, YouTube videos, news articles) before or as part of starting blog generation.
2. **Pass the fetched data** into the content-generation API so the backend can insert `[TWEET:0]`, `[ARTICLE:0]`, `[VIDEO:0]` placeholders and return the same arrays for the frontend to render as embeds.

---

## Backend contract (summary)

- **When starting content generation** (e.g. `POST /api/v1/jobs/content-generation` or sync `POST /api/v1/enhanced-blog-generation/generate`), the body must include in **`options`**:
  - `options.preloadedTweets` — array of tweet objects (from tweet search stream)
  - `options.preloadedArticles` — array of article objects (from news-articles search stream)
  - `options.preloadedVideos` — array of video objects (from YouTube search stream)

- If these are **missing or empty**, the backend will **not** add embed instructions to the prompt and the model will **not** output `[TWEET:0]`, `[ARTICLE:0]`, or `[VIDEO:0]` in the post body.

- **blog-result** and **complete** (and sync response `data`) include `preloadedTweets`, `preloadedArticles`, `preloadedVideos` so the frontend can replace `[TWEET:0]` with `preloadedTweets[0]`, etc., in the preview.

- **References:**  
  - `docs/content-generation-stream-frontend-handoff.md` (request body, events)  
  - `docs/blog-content-stream-frontend-handoff.md` (embed placeholders)  
  - Tweet stream: tweet search SSE → `data.tweets`  
  - News stream: `docs/news-articles-search-stream-frontend-handoff.md` → `data.articles`  
  - Video stream: `docs/youtube-videos-search-stream-frontend-handoff.md` → `data.videos`

---

## Frontend agent instructions (copy into Cursor / prompt)

Implement the following in the frontend app.

### 1. Show “thinking” steps for fetching related content

Before or when the user starts blog generation (e.g. from a topic or “Generate post” flow), show a clear **step-by-step UI** that reflects what is being fetched, for example:

- **Step 1:** “Fetching related tweets…” — run the tweet search stream (or API) for the topic; show a spinner or progress until the stream completes.
- **Step 2:** “Fetching related news articles…” — run the news-articles search stream for the topic; show progress until complete.
- **Step 3:** “Fetching related videos…” — run the YouTube videos search stream for the topic; show progress until complete.

Requirements:

- Each step should be **visible** (e.g. list or stepper) and **updated** when that step starts (e.g. “Fetching…”) and when it finishes (e.g. “Found N tweets”, “Found N articles”, “Found N videos”).
- Steps can run in **sequence or in parallel**; the UI should make it obvious which step is active and which are done.
- If a step is skipped (e.g. no tweet search configured), show that too (e.g. “Skipped” or “Not configured”).
- Store the **results** of each stream: `tweets`, `articles`, `videos` (same shape as in the stream `complete` events: `data.tweets`, `data.articles`, `data.videos`).

### 2. Pass fetched data into content generation

When starting content generation (job or sync):

- **Job flow:** `POST /api/v1/jobs/content-generation` with body including:
  - `topic`, `businessInfo`, `organizationId`, `additionalInstructions` as today.
  - `options`: include at least:
    - `preloadedTweets: <array of tweet objects from step 1>`
    - `preloadedArticles: <array of article objects from step 2>`
    - `preloadedVideos: <array of video objects from step 3>`
  - Omit or use `[]` for any type you did not fetch (e.g. if you only ran tweet + news, set `preloadedVideos: []`).

- **Sync flow:** Same `options.preloadedTweets`, `options.preloadedArticles`, `options.preloadedVideos` on `POST /api/v1/enhanced-blog-generation/generate`.

Do **not** start content generation until you have at least attempted the desired fetch steps (or explicitly skipped them) and have the arrays to pass. The backend uses these both to prompt the model for placeholders and to echo them back in **blog-result** / **complete** for replacement in the UI.

### 3. Replace placeholders in the post body

When rendering the post (e.g. from **blog-result** or **complete**):

- Read `content` from the payload and `preloadedTweets`, `preloadedArticles`, `preloadedVideos` from the same payload (blog-result or `result` on complete).
- Replace in the displayed (and optionally saved) body:
  - `[TWEET:0]` → embed for `preloadedTweets[0]`, `[TWEET:1]` → `preloadedTweets[1]`, etc.
  - `[ARTICLE:0]` → embed for `preloadedArticles[0]`, and so on.
  - `[VIDEO:0]` → embed for `preloadedVideos[0]`, and so on.

If you don’t replace them, the user will see literal text like `[TWEET:0]` in the preview.

### 4. Optional: allow user to skip or reorder steps

- Consider letting the user **skip** tweet/article/video fetch (e.g. “Skip tweets”) so the UI shows “Skipped” and passes an empty array for that type.
- Optionally allow **re-running** one step (e.g. “Fetch tweets again”) and then pass the new array on the next generation.

---

## Checklist for the frontend agent

- [ ] Add a “thinking” / steps UI that shows: Fetching tweets → Fetching articles → Fetching videos (or skipped), with clear start/done state per step.
- [ ] Store `tweets`, `articles`, `videos` from each stream’s completion payload.
- [ ] When calling the content-generation endpoint (job or sync), pass `options.preloadedTweets`, `options.preloadedArticles`, `options.preloadedVideos` with those stored arrays.
- [ ] On blog-result and complete, replace `[TWEET:0]`, `[ARTICLE:0]`, `[VIDEO:0]` in the post body using the `preloadedTweets`, `preloadedArticles`, `preloadedVideos` from the same payload.

---

## One-shot prompt you can paste for the frontend Cursor agent

```
We need the blog generation flow to:

1. Show visible "thinking" steps in the UI:
   - Step 1: "Fetching related tweets…" then "Found N tweets" (use tweet search stream; show progress).
   - Step 2: "Fetching related news articles…" then "Found N articles" (use news-articles search stream).
   - Step 3: "Fetching related videos…" then "Found N videos" (use YouTube videos search stream).
   Steps can be sequential or parallel; each step must show running then done (or skipped). Store the results (tweets, articles, videos) from each stream.

2. When starting content generation (POST /api/v1/jobs/content-generation or POST /api/v1/enhanced-blog-generation/generate), pass the fetched data in the request body:
   - options.preloadedTweets = array of tweet objects from tweet stream
   - options.preloadedArticles = array of article objects from news-articles stream
   - options.preloadedVideos = array of video objects from YouTube stream
   If we don't pass these, the backend won't insert [TWEET:0], [ARTICLE:0], [VIDEO:0] in the post. See docs/content-generation-stream-frontend-handoff.md and docs/blog-content-stream-frontend-handoff.md.

3. When we receive blog-result or complete, replace [TWEET:0], [ARTICLE:0], [VIDEO:0] in the post content with the actual embeds using the preloadedTweets, preloadedArticles, preloadedVideos arrays from the same payload (index 0 → first item, etc.).

Implement the steps UI and the wiring so that fetched tweets/articles/videos are passed into the content-generation API and placeholders are replaced in the preview.
```
