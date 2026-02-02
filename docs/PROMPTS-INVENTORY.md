# OpenAI prompts: where they live and how to split them up

We’ve got a lot of prompts scattered across the repo. This doc lists them and suggests a way to move them into a `prompts/` folder so they’re easier to find and tweak.

## Quick overview

Most of the heavy lifting is in three places:

- **`services/openai.js`** (~1862 lines) – website analysis, trending topics, blog generation, content diff, plus a bunch of analytics-style prompts (product insights, revenue, funnel, product usage, audience discovery, funnel pitch). Dozens of inline prompts.
- **`services/enhanced-blog-generation.js`** (~2347 lines) – the enhanced blog flow. One big system message and a single huge user prompt built by `buildEnhancedPrompt` (~450 lines of instructions for CTAs, internal links, citations, highlight boxes, images, SEO, etc.).
- **`routes/seo-analysis.js`** (~937 lines) – one system message and `buildComprehensivePrompt` (~290 lines) with a massive JSON schema for the analysis.

Smaller prompt usage: `blog-analyzer.js` (CTA + linking), `founderEmailGenerator.js` (founder welcome), `bundle-subscriptions.js` (bundle overview), `grok-tweet-search.js` (tweet search). Email content comes from the DB (`email_templates`), so nothing to extract there.

---

## 1. `services/openai.js`

**Website analysis** (`analyzeWebsite`) – system: customer psychology expert, strict JSON; user: URL + content + web search/keyword data, analysis framework (business, customer psychology, brand/competitive, keyword/SEO), JSON schema and validation. ~90 lines total.

**Website narrative** (`generateWebsiteAnalysisNarrative`) – system: business consultant, data-driven; user: business basics + customer intel + website/conversion + strategic insights, then “About Your Business” / “Customer Search Patterns” etc., tone/format, JSON. ~75 lines.

**Trending topics** (`generateTrendingTopics`) – system: content strategist, SEO-focused; user: business type/audience/focus, quality rules, per-topic JSON, AVOID/CREATE lists. ~55 lines.

**Blog post** (`generateBlogPost`) – system: content strategist with strict rules (factual accuracy, depth, CTA integrity); user: topic + business info + instructions, quality standards (empathy, depth, accuracy, structure), JSON response and formatting. ~75 lines.

**Content diff** (`analyzeContentChanges`) – system: content analyst, conceptual changes; user: old/new content, JSON (summary, conceptualChanges, improvements). ~25 lines.

**Analytics-style prompts** (product insights, revenue, funnel, product usage) – each has a short system role (expert type) and a user prompt that asks for a few specific insights in JSON. ~25–30 lines each.

**Audience discovery** – system varies (initial vs incremental); user: business analysis, “identify N audience opportunities,” JSON. ~50 lines.

**Funnel pitch** – system: conversion funnel expert; user: audience scenario, step-by-step pitch, JSON. ~15 lines.

**Export** (markdown/HTML) – user-only, short “convert this to markdown/HTML” with title + content. ~10 lines each.

---

## 2. `services/enhanced-blog-generation.js`

**Enhanced blog** – One system message (SEO content strategist, 95+ SEO, 7 requirements). User message is built by `buildEnhancedPrompt`: brand voice, internal links, citation rules, CTA block (or “no CTAs”), target audience, SEO instructions, data completeness, highlight box instructions (8 types + examples + anti-redundancy), image/tweet instructions, then the main “write a high-quality blog post” template and JSON schema. That one function is ~450 lines.

Splitting that into sections (e.g. `prompts/enhanced-blog/sections/` for CTAs, highlight boxes, SEO, etc.) and a small composer would make it much easier to iterate on one piece at a time.

There are also discovery/outline prompts in this file (system + user for a few steps) and something around visual structure – same idea, extract when you touch that flow.

---

## 3. `routes/seo-analysis.js`

**Comprehensive SEO analysis** – Short system message (“expert content strategist, educational SEO for solopreneurs, valid JSON in exact structure”). User is `buildComprehensivePrompt(content, context)`: intro, content to analyze, business context, scoring/tone rules, then the big JSON schema (titleAnalysis, contentFlow, engagementUX, authorityEAT, technicalSEO, conversionOptimization, contentDepth, mobileAccessibility, socialSharing, contentFreshness, competitiveDifferentiation, overallAssessment). ~290 lines.

Moving that to something like `prompts/seo-analysis.js` (system + `buildComprehensivePrompt`) would keep the route thin and put the prompt in one place. You could split the schema into a constant or separate file later if it gets in the way.

---

## 4. Other files

- **blog-analyzer.js** – CTA pattern analysis (system: conversion optimization expert; user: CTA summary + JSON). Linking pattern analysis if present.
- **founderEmailGenerator.js** – Founder welcome: James persona, tone, goal; user: user context, email requirements, avoid list, JSON.
- **emailContentGenerator.js** – Prompts from DB; nothing to extract.
- **bundle-subscriptions.js** – Short system + user for outcome-focused bundle copy.
- **grok-tweet-search.js** – System + user for tweet search/ranking (Grok; same pattern for consistency).

---

## 5. Suggested `prompts/` layout

```
prompts/
  README.md
  index.js
  website-analysis.js       # done – analyzeWebsite
  website-narrative.js
  trending-topics.js
  blog-post.js
  content-diff.js
  analytics/
    product-insights.js
    revenue-insights.js
    funnel-insights.js
    product-usage-insights.js
  audiences.js              # discoverAudiences + funnel pitch
  enhanced-blog/
    system.js
    sections/
      ctas.js
      internal-links.js
      citations.js
      highlight-boxes.js
      images.js
      seo-instructions.js
    buildEnhancedPrompt.js  # composer
  seo-analysis.js
  blog-analyzer.js
  founder-email.js
  bundle-overview.js
```

Per module: export something like `getSystemMessage()` (or a plain string) and `buildUserMessage(data)` with clear params. Optional: schema, default model/temperature if you want consistency.

---

## 6. Order of operations

1. **One example in place** – e.g. `website-analysis.js` wired into `openai.js` so the pattern is real and imports work.
2. **SEO analysis** – Move `buildComprehensivePrompt` + system into `prompts/seo-analysis.js`, call from the route.
3. **Enhanced blog** – System into `enhanced-blog/system.js`; pull out one or two sections (CTAs, highlight boxes) into `sections/`, add a composer, then switch `enhanced-blog-generation.js` over.
4. **Rest of openai.js** – Narrative, trending topics, blog post, diff, analytics, audiences, funnel pitch – one prompt at a time.
5. **Smaller services** – Founder email, blog-analyzer, bundle, grok when you want everything in one place.

---

## 7. Naming

- Id-style names: `website-analysis`, `seo-analysis`, `enhanced-blog`.
- System: `getSystemMessage()` or a string; if it depends on context, `getSystemMessage(context)`.
- User: `buildUserMessage(params)` or `buildPrompt(params)` with explicit params rather than a single giant context object.
- Optional: `responseSchema` or version/date in a comment for A/B or rollback.

Keeping prompts in one place makes them easier to read, edit, and test (e.g. snapshot the built prompt or assert on structure/length). This inventory and the README in `prompts/` are there so we know what exists and how to add more.
