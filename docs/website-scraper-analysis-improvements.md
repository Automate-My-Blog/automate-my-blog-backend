# Website Scraper & Analysis — Comprehensive Analysis and Improvement Recommendations

This document analyzes the website scraping and analysis portions of the application (webscraper service, website-analysis pipeline, and OpenAI analysis) with a focus on **speed** and **quality**, and recommends concrete improvements.

**Key files:**
- `services/webscraper.js` — scraping (Puppeteer, Playwright, Browserless, Cheerio)
- `services/website-analysis-pipeline.js` — pipeline: scrape → analyze → persist → audiences → pitches → images
- `services/openai.js` — `analyzeWebsite`, `generateWebsiteAnalysisNarrative`, web research
- `prompts/website-analysis.js` — system/user prompts for analysis

---

## 1. Executive Summary

| Area | Current state | Main opportunities |
|------|----------------|--------------------|
| **Scraping speed** | Puppeteer-first, long waits, sequential fallbacks | Try fast path (Cheerio/HEAD) first for static sites; reduce fixed waits; parallel fallbacks where safe |
| **Scraping quality** | Good main-content extraction; CTAs missing on Browserless path; headings shape inconsistency | Add CTA extraction to Browserless; normalize headings for pipeline |
| **Analysis speed** | Web research parallelized; analysis is single blocking call | Truncate very long content before API; optional streaming/chunking for huge pages |
| **Analysis quality** | Rich prompts; no content cap; narrative and analysis model mix | Cap/prioritize content sent to analysis; align model usage; fix headings in analysis input |

---

## 2. Scraping — Speed

### 2.1 Method order and “fast path”

**Current behavior:**  
`scrapeWebsite()` always tries **Puppeteer first**, then Playwright → Browserless → Cheerio. For static or server-rendered sites, launching a browser adds 3–10+ seconds before any HTML is fetched.

**Recommendation:**
- **Option A — Cheerio-first for same-origin GET:**  
  For a first request, do a single `axios.get(url)` with a short timeout (e.g. 3–5 s). If the response is HTML and has substantial text (e.g. `$(body).text()` or main-content selectors > 500 chars), run the existing Cheerio extraction and return. If the response is empty, redirects to a login, or looks like a SPA shell, fall back to the current order (Puppeteer → …).
- **Option B — Configurable strategy:**  
  Allow an option (e.g. `preferStatic: true` or `scrapeStrategy: 'fast'`) that tries Cheerio (or Browserless) before Puppeteer so that known-static domains or internal tools can skip browser launch.

**Impact:** Large latency reduction for static/SSR sites (often 10–25 s → 2–5 s).

### 2.2 Timeouts and wait strategy

**Current behavior:**
- `ANALYSIS_TIMEOUT` defaults to **10 s** for `page.goto()`.
- After `goto`, there is a **fixed 5 s** `setTimeout` (Puppeteer line ~203, Playwright ~592).
- Then `waitForFunction(…, { timeout: 15000 })` (up to 15 s) for “enough” paragraphs/body text.

So in the best case, **at least 5 s** is spent sleeping after load; in the worst case, **5 s + 15 s** after goto. For many sites, `domcontentloaded` or `load` plus a shorter conditional wait (e.g. 2–3 s) would be enough.

**Recommendations:**
- Make the post-goto delay **configurable** (e.g. `SCRAPE_WAIT_AFTER_LOAD_MS`, default 1500–2000) and reduce the default from 5000 to 2000 or 2500.
- Use a **shorter** `waitForFunction` timeout (e.g. 5–8 s) so slow SPAs don’t hold the pipeline for 15 s every time.
- Consider `waitUntil: 'domcontentloaded'` or `'load'` instead of `networkidle0` for the first attempt; reserve `networkidle0` for a retry or for domains known to need it. Many sites never reach `networkidle0`, which can cause unnecessary timeouts and fallback chains.

**Impact:** Saves 3–20+ seconds per scrape when the page is ready earlier or when networkidle is too strict.

### 2.3 Fallback chain

**Current behavior:**  
Fallbacks are **sequential**: Puppeteer → Playwright → Browserless → Cheerio. Each failure adds full timeout + waits before the next method runs.

**Recommendation:**  
Keep the chain for correctness, but:
- **Shorten** timeouts and waits as above so each step fails faster.
- Optionally, **detect** “no browser” or “Chrome not found” at startup and skip Puppeteer/Playwright (or go straight to Browserless/Cheerio) to avoid repeated long failures in serverless.

**Impact:** Faster feedback when browser isn’t available; less wasted time on bad URLs.

---

## 3. Scraping — Quality

### 3.1 CTA extraction missing on Browserless path

**Current behavior:**  
`scrapeWithBrowserService()` returns `content` with **no `ctas`**. The pipeline and CTA normalizer then see `scrapedContent.ctas` as undefined/empty, so **no CTAs are stored** when the active method is Browserless.

**Recommendation:**  
Reuse the same CTA logic used in Cheerio: after loading HTML with Cheerio in `scrapeWithBrowserService`, run the same selector/classification steps (or a shared `extractCTAsFromCheerio($, url)` helper) and attach `content.ctas` before `cleanContent(content)`.

**Impact:** CTA quality and “hasSufficientCTAs” behavior become consistent across Puppeteer, Playwright, Browserless, and Cheerio.

### 3.2 Headings shape and pipeline input

**Current behavior:**
- **Puppeteer/Playwright:** `headings` is an array of **strings** (from `h1..h6`).
- **Cheerio:** `headings` is an array of **objects** `{ text, level, id }` (see webscraper.js ~958–969).
- **cleanContent** normalizes so that cleaned headings can be either strings or `{ text, level, id }`.
- **Pipeline** builds the analysis input as:  
  `Headings: ${(scrapedContent.headings || []).join(', ')}`  
  If `headings` contains objects, `.join(', ')` yields `" [object Object], [object Object]"`, so the model receives useless text and structure is lost.

**Recommendation:**  
In the pipeline, when building `fullContent`, normalize headings to strings before joining:

```js
const headingStrings = (scrapedContent.headings || []).map(h =>
  typeof h === 'string' ? h : (h?.text ?? '')
).filter(Boolean);
// ...
`Headings: ${headingStrings.join(', ')}`
```

Optionally, in `cleanContent`, always output a **single** shape (e.g. always `{ text, level, id }` or always strings) so every consumer can rely on one contract.

**Impact:** Analysis and narrative get correct heading context; no “[object Object]” in prompts.

### 3.3 Duplicate extraction logic

**Current behavior:**  
Puppeteer and Playwright each have a large inline `page.evaluate()` for:
- Content extraction (selectors, fallbacks, TreeWalker)
- CTA extraction (selectors, navigation filter, placement)

Roughly 300+ lines are duplicated between the two. Cheerio and Browserless use different code paths again.

**Recommendation:**  
- Extract a **single** “content + CTAs” extraction that accepts **HTML string** (and optionally URL for context). Implement it once using Cheerio (or a small in-memory DOM), and call it from:
  - `scrapeWithCheerio` (already has HTML),
  - `scrapeWithBrowserService` (after getting HTML from Browserless),
  - and optionally from Puppeteer/Playwright by passing `await page.content()` so they only handle navigation/wait, not extraction logic.
- That reduces drift, ensures CTAs and content rules are identical everywhere, and makes it easier to add Browserless CTAs.

**Impact:** Consistent quality across methods; one place to tune selectors and CTA rules; fewer bugs.

---

## 4. Analysis — Speed

### 4.1 Content length and token usage

**Current behavior:**  
The pipeline builds `fullContent` as:

```js
const fullContent = [
  `Title: ${scrapedContent.title}`,
  `Meta Description: ${scrapedContent.metaDescription}`,
  `Headings: ${(scrapedContent.headings || []).join(', ')}`,
  `Content: ${scrapedContent.content}`
].join('\n').trim();
```

There is **no truncation**. Very long pages (e.g. 100k+ chars) are sent entirely to `analyzeWebsite()` and then into the OpenAI user message. That increases cost, latency, and risk of hitting context limits or timeouts.

**Recommendation:**
- **Cap total length** (e.g. `WEBSITE_ANALYSIS_MAX_CONTENT_CHARS` default 40_000–60_000). If `fullContent.length` exceeds the cap, truncate **content** (keep title, meta, headings full) and append e.g. `"\n\n[Content truncated for analysis.]"`.
- Optionally **prioritize** by taking the first N chars and the last M chars of `scrapedContent.content` (intro + conclusion) when truncating, to preserve narrative bookends.

**Impact:** More predictable latency and cost; fewer context-related failures on huge pages.

### 4.2 Web research

**Current behavior:**  
Business research and keyword research run **in parallel** when `SKIP_WEBSITE_WEB_RESEARCH` is not set. Optional timeout `WEBSITE_WEB_RESEARCH_TIMEOUT_MS` exists. This is already a good pattern.

**Recommendation:**  
Keep as is; consider documenting the env vars in `.env.example` (e.g. `WEBSITE_WEB_RESEARCH_TIMEOUT_MS`) so operators can tune speed vs. depth.

---

## 5. Analysis — Quality

### 5.1 Headings in analysis input

Same as §3.2: fixing the pipeline so headings are normalized to strings (and not `[object Object]`) improves the quality of the text the model sees and thus analysis and narrative accuracy.

### 5.2 Model and token limits

**Current behavior:**
- Main website analysis uses `OPENAI_MODEL` or falls back to `gpt-3.5-turbo`, with `max_tokens: 2000`. Truncation is detected and an error is thrown.
- Narrative generation uses **gpt-4o** and `response_format: { type: 'json_object' }`.

**Recommendation:**  
- Use a **single** documented default for analysis (e.g. `gpt-4o` or `gpt-4o-mini`) in `.env.example` so behavior is consistent and truncation handling (already in place) remains.
- If keeping a smaller model for cost, consider raising `max_tokens` slightly (e.g. 2500) and/or truncating input (see §4.1) to reduce truncation risk while staying within budget.

### 5.3 Prompt and parsing

**Current behavior:**  
Structured JSON is requested; `parseOpenAIResponse` strips code fences and parses JSON. Truncation and invalid JSON are handled with errors and fallbacks.

**Recommendation:**  
No major change needed. Optionally add a **content-quality check** before analysis: if `fullContent` is very short (e.g. < 500 chars after trimming), log a warning or set a flag so the UI can show “limited content” and the model prompt can mention that the page may be JS-heavy or thin.

---

## 6. Pipeline integration

### 6.1 Cache and backfill

**Current behavior:**  
Cache (e.g. 30 days) and backfill for narrative/scenarios are implemented. Scraping and analysis are skipped on cache hit.

**Recommendation:**  
No change for speed/quality of the scraper itself. If you add “scrape only” or “re-scrape same URL” flows, consider caching raw scraped result (e.g. by URL + date) so repeated analyses can reuse scrape without re-running the full pipeline.

### 6.2 Progress and cancellation

**Current behavior:**  
`onScrapeProgress` and pipeline `report()` give clear phases; `isCancelled` is supported.

**Recommendation:**  
Keep. If you add a fast Cheerio path, report a distinct phase (e.g. “Fetching with HTTP (fast path)”) so the UI can reflect the faster path.

---

## 7. Prioritized action list

| Priority | Action | Effort | Impact |
|----------|--------|--------|--------|
| P0 | Fix headings in pipeline: normalize to strings before `fullContent` | Low | Quality (correct analysis input) |
| P0 | Add CTA extraction to Browserless path (reuse Cheerio logic) | Low | Quality (CTAs on all paths) |
| P1 | Reduce post-load fixed wait (e.g. 5s → 2s) and shorten waitForFunction timeout | Low | Speed |
| P1 | Truncate `fullContent` to a configurable max length before analysis | Low | Speed + cost + stability |
| P2 | Try Cheerio (or HEAD + Cheerio) first with short timeout; fall back to Puppeteer if content thin | Medium | Speed (static/SSR) |
| P2 | Relax `waitUntil` (e.g. domcontentloaded first) and reserve networkidle for retry | Low | Speed + reliability |
| P3 | Extract shared “HTML → content + CTAs” and use from Cheerio, Browserless, and optionally browser methods | Medium | Quality + maintainability |
| P3 | Document ANALYSIS_TIMEOUT, SCRAPE_WAIT_*, WEBSITE_WEB_RESEARCH_*, WEBSITE_ANALYSIS_MAX_CONTENT_CHARS in .env.example | Low | Operability |

---

## 8. References

- **Scraper:** `services/webscraper.js` — `scrapeWebsite`, `scrapeWithPuppeteer`, `scrapeWithPlaywright`, `scrapeWithBrowserService`, `scrapeWithCheerio`, `cleanContent`
- **Pipeline:** `services/website-analysis-pipeline.js` — `runWebsiteAnalysisPipeline`, `fullContent` construction, `persistAnalysis`
- **Analysis:** `services/openai.js` — `analyzeWebsite`, `generateWebsiteAnalysisNarrative`, `performBusinessResearch`, `performKeywordResearch`
- **Prompts:** `prompts/website-analysis.js` — `getWebsiteAnalysisSystemMessage`, `buildWebsiteAnalysisUserMessage`
- **Config:** `.env.example` — `USER_AGENT`, `ANALYSIS_TIMEOUT`, `SKIP_WEBSITE_WEB_RESEARCH`, `WEBSITE_WEB_RESEARCH_TIMEOUT_MS`
