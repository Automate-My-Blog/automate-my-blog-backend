# Issue #446 – Scoping answers (comment for GitHub)

Post the following as a comment on https://github.com/Automate-My-Blog/automate-my-blog-backend/issues/446

---

**Cloudflare plan**  
We don’t have a Cloudflare Browser Rendering account yet. Free tier (10 min browser time/day) is fine for staging and low-volume prod; for real traffic we’ll need Workers Paid (10 hrs/month included, then $0.09/browser-hour). Worth confirming whether “browser time” is wall-clock per crawl or CPU time—affects how many analyses we can run per day.

**Page limit**  
Start with **5 pages** per analysis: homepage + about, services, pricing, contact (or similar). That’s enough for “richer business analysis” without blowing time/cost. We can make it configurable (env or per-org) and bump to 10–20 later if needed.

**Output format**  
Use **markdown** from the crawl API for the main content we send to OpenAI. We already build a text blob from `title`, `metaDescription`, `headings`, `content` in the pipeline; swapping in markdown will reduce tokens and often improve structure. Keep HTML available only if we need it for CTA/selector logic, or do CTA extraction from the same markdown/structured response if the API supports it.

**Blog pages**  
**Exclude** blog from the initial crawl (no `includePatterns` for `/blog/**`). Blog discovery is already a separate path (`discoverBlogPages` / sitemap, etc.); mixing blog into the main analysis crawl increases cost and scope without clear product need. We can add optional “include blog sample” later.

**Full replacement vs hybrid**  
**Full replacement** for the pipeline’s single-page scrape. Keep the existing **Cheerio fast path** as a pre-check: if a quick GET returns enough content, skip the Cloudflare call. So order is: Cheerio fast path → Cloudflare crawl (multi-page) → no in-process Puppeteer/Playwright. That removes the heavy deps and serverless brittleness while preserving a cheap path for static sites.

**Pipeline / SSE impact**  
- **Step timing:** “Analyzing website” (step 0) today gets progress from `onScrapeProgress` (phases like “Trying Puppeteer”, “Launching browser”, “Extracting content”). With Cloudflare we won’t have browser-launch; we’ll have “Requesting crawl”, “Waiting for crawl”, “Processing results”. We should add a small set of phases (e.g. `cf-request`, `cf-wait`, `cf-parse`) and map them in `SCRAPE_PROGRESS` in `website-analysis-pipeline.js` so the same `report(0, ...)` and `phase` in SSE still drive the same UX.
- **Data shape:** `scrapeWebsite()` should still return the same contract: `{ title, metaDescription, content, headings, ctas, socialHandles, … }`. For multi-page, we can either merge into one `content` + one `headings` array and aggregate CTAs with `page_url` set per CTA, or add a `pages: [{ url, title, content, ctas, … }]` and derive the “main” content from the homepage entry. Pipeline and `persistAnalysis` already support `page_url` on CTAs; we’d add writing to `website_pages` for non-homepage entries if we want cache/navigation by page later.
- **SSE events:** No change to event types; only the labels and optional `phase`/`detail` values need to reflect Cloudflare steps instead of Puppeteer/Playwright.

---
