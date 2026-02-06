# Backend handoff: Blog content streaming (SSE)

This document describes how the frontend consumes the **blog content stream** and what the backend should send so the preview shows only the post body during streaming, with correct newlines and no JSON/title/meta in the UI.

---

## Context

- **Stream**: SSE connection for blog content generation (e.g. after `startBlogStream` / connection for content-generation job).
- **Events**: `content-chunk` (streaming fragments), `complete` (final result).
- **Frontend**: Appends chunks to the preview during stream; on `complete`, replaces with `result.content` and saves the post.

---

## Current problem (what we're working around)

Today the frontend sometimes receives:

1. **Wrapper JSON as "content"**  
   Chunks with `field: "content"` that are actually fragments of the outer JSON (e.g. `"cta"`, `"seo"`, `"Suggestions"`, `"Optimization"`, `"Score"`, punctuation like `\":`, ` }\n`, `[]\n`). The frontend filters these so they are not appended to the preview.

2. **Title / metaDescription as "content"**  
   Chunks where the value is the title or meta description but still use `field: "content"`. The frontend uses heuristics (e.g. skip literal `"json"`, `"metaDescription"`, and some title-case phrases) to avoid showing them in the preview.

3. **Literal `\n`**  
   If the backend sends the two-character sequence backslash + `n` instead of a real newline, the frontend unescapes it so the preview has proper line breaks.

These workarounds are fragile. **Changing the backend contract is the preferred fix.**

---

## Recommended backend contract

### 1. `content-chunk` events: only the post body

- **Rule:** For `content-chunk`, send **only** the markdown that belongs in the **post body** (the same text that will appear in `result.content`).
- **Do not** stream as "content":
  - Title
  - Meta description
  - Wrapper keys/values (e.g. `ctaSuggestions`, `seoOptimizationScore`, tags, etc.)

**Example (good):** Stream body fragments only.

```json
{ "field": "content", "content": "# How to Test the Streaming API\n\n" }
{ "field": "content", "content": "In today's digital landscape, streaming APIs play a pivotal role." }
```

**Example (avoid):** Do not send title/meta/wrapper as content-chunk.

```json
{ "field": "content", "content": "Mastering Streaming API Testing" }
{ "field": "content", "content": "metaDescription" }
{ "field": "content", "content": "Learn how to test streaming APIs effectively." }
{ "field": "content", "content": "cta" }
{ "field": "content", "content": "Suggestions" }
```

### 2. If you must send multiple parts in chunks: use `field`

If the backend streams title, meta, and body as separate chunks, use **`field`** so the frontend can filter without heuristics:

| `field` value   | Frontend behavior |
|-----------------|-------------------|
| `"content"`     | Append to preview (body only). |
| `"text"` / `"body"` | Same: append. |
| `"title"`       | Do **not** append. |
| `"metaDescription"` | Do **not** append. |
| `"subtitle"`    | Do **not** append. |

**Example:**

```json
{ "field": "title", "content": "Mastering Streaming API Testing" }
{ "field": "metaDescription", "content": "Learn how to test streaming APIs effectively." }
{ "field": "content", "content": "# How to Test the Streaming API\n\nIn today's digital landscape..." }
```

The frontend already ignores chunks when `field` is `title`, `metaDescription`, or `subtitle`; it only appends when `field` is `content`, `text`, or `body`.

### 3. `complete` event: full result with `result.content`

Send the full result. The frontend uses **`result.content`** as the final body (and for saving the post).

**Example:**

```json
{
  "result": {
    "title": "Mastering Streaming API Testing",
    "subtitle": "Ensure Seamless Data Flow with Effective API Testing",
    "metaDescription": "Learn how to test streaming APIs effectively.",
    "content": "# How to Test the Streaming API\n\nIn today's digital landscape, streaming APIs play a pivotal role. ...",
    "tags": ["API testing", "streaming APIs"],
    "seoOptimizationScore": "95+",
    "ctaSuggestions": []
  }
}
```

- **Newlines:** Use normal JSON escaping. So `"\n"` in JSON becomes a real newline in the string. Do not double-escape (e.g. avoid sending `"\\n"` in the JSON string so the frontend sees literal `\n`).

### 4. Tweet placeholders in body

The backend may emit `[TWEET:0]`, `[TWEET:1]`, … inside the streamed body. The frontend replaces these with tweet content when the tweet stream completes. No change needed for this handoff beyond keeping placeholders in the body and sending tweets on the tweet stream.

---

## Summary

| Item | Recommendation |
|------|----------------|
| **content-chunk** | Send only post-body markdown in `content`, or use `field: "content"` only for body and `field: "title"` / `"metaDescription"` for the rest. |
| **No wrapper JSON in content** | Do not stream keys/values like `cta`, `seo`, `Score`, `Suggestions`, or JSON punctuation as content-chunk. |
| **complete** | Send `result.content` as the full body with normal JSON newlines (`\n`). |
| **field** | Use `field` so the frontend can distinguish title, metaDescription, and body without heuristics. |

Once the backend follows this contract, the frontend can rely on it and simplify or remove the current filtering heuristics.

---

## Backend implementation

- **Stream:** `POST /api/v1/enhanced-blog-generation/generate-stream` (client opens `GET /api/v1/stream?token=...` first, then POSTs with `connectionId`).
- **Logic:** `services/enhanced-blog-generation.js` — `generateBlogPostStream()` accumulates the raw OpenAI stream, extracts only the `"content"` field value from the partial JSON via `_extractContentValueFromStreamBuffer()`, and emits `content-chunk` with `field: "content"` for that body text only. On completion, parses full JSON and sends `complete` with `result` (including `result.content` with normal newlines).

---

## Frontend reference

- **Stream handling:** `src/services/api.js` (`connectToStream`, `content-chunk` / `complete` listeners).
- **Chunk extraction / filtering:** `src/utils/streamingUtils.js` (`extractStreamChunk`, `extractStreamCompleteContent`, `isAppendableContentChunk`).
- **Preview:** `StreamingPreview` → `HTMLPreview`; content is also run through `replaceTweetPlaceholders` (see `docs/RELEVANT_TWEETS_FLOW.md`).
