# Proposal: Synthesize Related Media into Generated Blog Post Output

**Branch:** `feature/synthesize-related-media-in-blog-output`  
**Status:** Proposal (no implementation yet)  
**Goal:** Improve the quality and cohesion of the generated blog post by better integrating the various related media we already fetch and pass into the output.

---

## 1. Current state: what “related media” we have

The backend already gathers and feeds several kinds of related media into enhanced blog generation:

| Media type | Source | How it reaches the model | How it appears in output |
|------------|--------|---------------------------|---------------------------|
| **Tweets** | Pre-fetched (e.g. tweet search stream) | `options.preloadedTweets` → prompt lists tweets and instructs use of `[TWEET:0]`, `[TWEET:1]`, … | Placeholders in body; frontend replaces with embeds |
| **Articles** | Pre-fetched (news-articles search) | `options.preloadedArticles` → `[ARTICLE:0]`, … | Placeholders; frontend replaces with article cards/links |
| **Videos** | Pre-fetched (YouTube search) | `options.preloadedVideos` → `[VIDEO:0]`, … | Placeholders; frontend replaces with video embeds |
| **Hero image** | Topic image (topic stream) or generated | Prompt asks for `![IMAGE:hero_image:description]`; topic.image as fallback | Single placeholder; async image gen or topic image |
| **CTAs** | Website CTA analysis or request body | `websiteData.ctas` or `options.ctas` in prompt; exact URLs and placement hints | Model weaves links into copy; `result.ctas` returned for UI |
| **Internal links** | Website / sitemap analysis | `websiteData.internal_links` in prompt | Model weaves links; `result.internalLinks` returned |
| **Visual suggestions** | Post-generation (visual service) | Not in main content prompt | `visualContentSuggestions`; images generated via `/api/images/generate-for-blog` |

So we already have: **tweets, articles, videos, hero image, CTAs, internal links, and visual suggestions**. The gap is **synthesis**: making the post feel like one piece where each media type is used in the right place, with the right narrative framing, rather than feeling like separate ingredients dropped in.

---

## 2. What “synthesize” could mean

- **Placement and pacing**  
  Use tweets/articles/videos where they add the most (e.g. tweet for social proof after a claim, article for citation after a stat, video for a “see how” moment). Avoid clustering all embeds in one block.

- **Narrative framing**  
  Short lead-in or lead-out sentences around each embed (e.g. “As X noted,” “For a deeper dive,” “This demo shows”) so the reader knows why it’s there.

- **One hero, one story**  
  Hero image description aligned with the topic and tone; optional tie-in to one key tweet/article/video (e.g. “Cover image reflects the theme of the video below”).

- **CTAs and internal links**  
  Place CTAs at natural decision points (e.g. after value, before next section); use internal links where they extend the topic rather than at random.

- **Consistency with visual suggestions**  
  When we suggest charts/illustrations, their placement and descriptions could be guided by the same “narrative + placement” rules so the final post (after image generation) still feels coherent.

---

## 3. Proposed directions (options)

### Option A: Prompt-only synthesis (lowest effort)

- **Idea:** Keep the same data inputs and response shape (placeholders, `ctas`, `internalLinks`, etc.) but tighten the system/user prompt so the model is explicitly instructed to:
  - Vary placement of `[TWEET:n]`, `[ARTICLE:n]`, `[VIDEO:n]` (e.g. “use at most one per section,” “prefer tweet after a claim, article after a statistic”).
  - Add one short contextual sentence before/after each embed.
  - Place hero image after the intro; align its description with the post and (if useful) one cited source.
  - Use CTAs and internal links at “natural” spots (we already give placement hints; we could add 1–2 sentence-level rules).
- **Pros:** No API or contract change; frontend unchanged.  
- **Cons:** Quality depends entirely on model compliance; no structural guarantee.

### Option B: Structured placement rules in the prompt

- **Idea:** In addition to Option A, give the model a small **placement schema** in the prompt (e.g. “Section 1: intro + hero; Section 2–N: at most one of {tweet, article, video} per section; end with CTA”). Optionally ask for a short “placement map” in the JSON (e.g. which section has which placeholder) so we can validate or post-process.
- **Pros:** More predictable structure; could later drive UI (e.g. “section with video”).  
- **Cons:** Slightly more complex prompt and possible JSON shape; may need to keep placement map optional for backward compatibility.

### Option C: Post-generation synthesis pass (two-step)

- **Idea:** Keep current generation as step 1. Add an optional step 2: a second, smaller LLM call that takes `content` + list of used placeholders and their metadata (tweet text, article title, video title, CTA text, etc.) and returns a revised `content` with:
  - Improved lead-in/lead-out sentences around embeds.
  - No new placeholders; only rewording and reordering within existing structure.
- **Pros:** Can improve narrative without changing the main prompt.  
- **Cons:** Extra latency and cost; need to preserve placeholders and links exactly.

### Option D: Richer result shape (synthesis metadata)

- **Idea:** Keep generation as-is or combine with A/B. Extend the **result** with optional synthesis metadata, e.g.:
  - `embedPlacements`: `[{ type: 'tweet'|'article'|'video', index: number, suggestedLeadIn?: string, sectionHeading?: string }]`
  - `heroImageContext`: `{ description, suggestedCaption?, relatedEmbedIndex?: number }`
  So the frontend (or a future layout engine) can render embeds with suggested captions or order.
- **Pros:** Enables smarter UI and A/B tests.  
- **Cons:** New fields; frontend must opt in; model must output structured synthesis hints (or we derive them in a second pass).

---

## 4. Recommendation (for discussion)

- **Short term:** **Option A** — Improve prompts in `services/enhanced-blog-generation.js` to explicitly require:
  - Spread of embeds (e.g. at most one tweet/article/video per section).
  - One contextual sentence before or after each `[TWEET:n]` / `[ARTICLE:n]` / `[VIDEO:n]`.
  - Hero description aligned with topic and, if possible, one cited source.
  - Natural CTA and internal link placement (we already have placement hints; add one line that says “use at natural break points, not all at the end”).
- **Next step:** If we see clear improvement, consider **Option B** (simple placement rules) or **Option D** (optional synthesis metadata) so the frontend can optionally use placement/captions.

Options C and D can be added later without blocking prompt improvements.

---

## 5. Implementation sketch (if we do Option A first)

- **Files:** `services/enhanced-blog-generation.js` (and possibly `docs/reference/PROMPTS-INVENTORY.md`).
- **Changes:**
  - In the main content prompt section where we describe `[TWEET:n]`, `[ARTICLE:n]`, `[VIDEO:n]`:
    - Add 2–3 sentences: spread across sections, one embed type per section when possible, and always include a short contextual sentence before or after the placeholder.
  - In the hero image instruction block:
    - Add: “Describe the image so it matches the post’s main message and, if relevant, the theme of one cited tweet, article, or video.”
  - In the CTA / internal links block:
    - Add: “Place CTAs and internal links at natural break points (e.g. after a key point or before a new section), not only at the end.”
- **Docs:** Update `docs/handoffs/blog-content-stream-frontend-handoff.md` and `docs/handoffs/content-generation-stream-frontend-handoff.md` only if we change event payloads or result shape (not for Option A alone).
- **Tests:** No change to API contract; optional unit test that the prompt string includes the new “synthesis” instructions.

---

## 6. Out of scope for this proposal

- Changing how we fetch or store tweets/articles/videos/CTAs/internal links.
- Changing the placeholder format (`[TWEET:0]`, etc.) or the image placeholder format.
- Frontend embed UI or layout (only backend prompt/result shape).
- SEO or quality scoring logic (except insofar as better synthesis may improve perceived quality).

---

## 7. References

- `docs/handoffs/blog-content-stream-frontend-handoff.md` — Content stream contract; placeholders and `result.content`.
- `docs/handoffs/content-generation-stream-frontend-handoff.md` — Job stream events; `blog-result`, `complete`, `preloadedTweets`/`Articles`/`Videos`.
- `docs/handoffs/topic-stream-hero-image-handoff.md` — Topic image as hero.
- `services/enhanced-blog-generation.js` — Main prompt construction, CTA/internal link/embed instructions, result shape.
