# Backend handoff: Topic stream and hero image (SSE)

This document describes how the frontend consumes the **topic ideas stream** and uses topic images as the **hero image** in the blog preview. It is the source of truth for event names, payload shapes, and ordering so backend and frontend stay in sync.

**Related:** [issue-261-backend-implementation.md](./issue-261-backend-implementation.md) (topic stream context), [blog-content-stream-frontend-handoff.md](./blog-content-stream-frontend-handoff.md) (blog content stream; hero image placeholder in content is supplied by the frontend from the selected topic’s `image`).

---

## 1. Topic stream overview

| Step | Contract |
|------|----------|
| **1. POST** | `POST /api/v1/topics/generate-stream` (or trending-topics equivalent) with body `{ businessType, targetAudience, contentFocus }`. Response: `{ connectionId, streamUrl? }`. |
| **2. Open stream** | Client opens the stream (e.g. `EventSource(streamUrl)`) immediately after receiving the POST response. Topic generation starts when the stream connects. |
| **3. Events** | Backend sends `topic-complete` (per topic), optionally `topic-image-start` and `topic-image-complete` (per topic), then `complete`. |

The frontend shows topic cards as each `topic-complete` arrives and uses **topic image URLs** from `topic-image-complete` as the **hero image** in the streaming blog preview (`StreamingPreview` → `heroImageUrl`).

---

## 2. SSE events and payload shapes

All event payloads are JSON in `event.data`. The frontend parses `event.data` and passes the object to the corresponding handler.

### 2.1 `topic-complete`

Emitted when one topic’s text is ready (no image yet).

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `topic` | object | Yes* | Topic payload. Frontend also accepts the event data as the topic if `topic` is missing. |
| `topic.id` | string | Recommended | Used to match this topic when `topic-image-complete` arrives so the selected topic’s hero image can be updated. |
| `topic.title` | string | Yes | Shown on the topic card. |
| `topic.description` | string | No | Shown on the topic card. |
| `topic.category` | string | No | Optional. |
| `topic.image` | string | No | Usually absent here; frontend expects the image URL from `topic-image-complete`. |

\* Frontend uses `data.topic != null ? data.topic : data`, so either `{ topic: { id, title, ... } }` or a single topic object is acceptable.

### 2.2 `topic-image-start`

Emitted when image generation (e.g. DALL·E) starts for a topic. Used by the frontend to show “Generating image for topic N…” and loading state.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `index` | number | Yes | Zero-based index of the topic (matches order of `topic-complete`). |
| `total` | number | No | Total number of topic images. |
| `topic` | object | No | Optional topic snapshot. |

### 2.3 `topic-image-complete`

Emitted when the hero image URL for a topic is ready. **This is the event that supplies the hero image URL** used in the blog preview.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `index` | number | Yes | Zero-based index of the topic. Must match the order of `topic-complete` (same index = same topic). |
| `topic` | object | Yes* | Topic with image URL. Frontend uses `data.topic != null ? data.topic : data`. |
| `topic.id` | string | Recommended | Must match the `id` from the corresponding `topic-complete` so the frontend can update the selected topic’s image when the user has already chosen that topic. |
| `topic.image` | string | Yes | **Hero image URL.** Absolute URL or fallback image URL. Frontend uses this for `StreamingPreview` `heroImageUrl` and topic card thumbnail. |

\* If the backend sends a single object (no wrapper), frontend treats the whole payload as the topic and reads `payload.image` and `payload.id`.

**Example:**

```json
{
  "index": 0,
  "topic": {
    "id": "topic-uuid-1",
    "title": "5 Ways to Improve API Reliability",
    "description": "...",
    "image": "https://cdn.example.com/generated/hero-abc123.png"
  }
}
```

### 2.4 `complete`

Emitted when the topic stream is finished. Frontend resolves the topic-generation Promise with the final list and uses it for `availableTopics` (and thus for selection and hero image).

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `topics` | array | No | Final list of topics. If present, frontend uses it as the base for the resolved list. |

**Important (frontend behavior as of Feb 2026):** The frontend **merges `.image` from earlier `topic-image-complete` events** into the list used to resolve. So:

- If the backend sends `complete` **with** `data.topics` where each topic includes `image`, the frontend uses those images.
- If the backend sends `complete` **with** `data.topics` but **without** `image` on each topic, the frontend still has the images from `topic-image-complete` in an internal `accumulated` array and **copies those image URLs onto the final list**. So the hero image continues to work even when `complete` does not include image URLs.

So the backend may either:

1. Include `image` on each topic in the `complete` payload (recommended for consistency and for clients that don’t merge), or  
2. Omit `image` in `complete`; the frontend will still show the hero image as long as `topic-image-complete` was sent for each topic.

---

## 3. Event order

Recommended order (matches current backend behavior described by frontend):

1. One or more **`topic-complete`** (one per topic, in index order).
2. Zero or more **`topic-image-start`** (optional; for loading UX).
3. One or more **`topic-image-complete`** (one per topic; **should be sent before `complete`** so the frontend has image URLs in hand).
4. One **`complete`** (with optional `data.topics`).

Sending all `topic-image-complete` events before `complete` avoids races where the user selects a topic and starts content generation before the image URL is received; the frontend still updates the selected topic’s image when `topic-image-complete` arrives, but having images before `complete` keeps the resolved topic list correct and avoids depending on that late update.

---

## 4. Hero image in the blog preview

- The **same topic image URL** (`topic.image` from the selected topic) is passed to **StreamingPreview** as **`heroImageUrl`**.
- The streamed blog content may contain a hero placeholder in markdown: `![IMAGE:hero_image:Description.]` (see [blog-content-stream-frontend-handoff.md](./blog-content-stream-frontend-handoff.md)). The frontend renders that slot using `heroImageUrl` when present; otherwise it shows a placeholder/fallback.
- So for the hero to appear in the preview, the selected topic must have `image` set, which comes from `topic-image-complete` (and is now preserved when `complete` uses `data.topics` without images).

---

## 5. Summary for backend

| Item | Contract |
|------|----------|
| **topic-complete** | Send `{ topic: { id, title, description?, category?, ... } }`. `id` should match the same topic in `topic-image-complete`. |
| **topic-image-start** | Send `{ index, total?, topic? }` when image gen starts for a topic. |
| **topic-image-complete** | Send `{ index, topic: { id, image, ... } }`. `topic.image` is the hero image URL; `index` must match topic order; `topic.id` should match `topic-complete`. |
| **complete** | Send `{ topics?: [...] }` optionally. If `topics` is present, including `image` on each topic is recommended but not required; the frontend merges images from `topic-image-complete` if missing. |
| **Order** | Emit all `topic-image-complete` events before `complete` so the final list and UI have image URLs before the stream closes. |

---

## 6. Frontend code references

- **Topic stream connection and handlers:** `src/services/api.js` — `connectToStream`, listeners for `topic-complete`, `topic-image-start`, `topic-image-complete`, `complete`.
- **Topic list accumulation and image merge on complete:** `src/services/workflowAPI.js` — `runTopicStream`, `onTopicComplete`, `onTopicImageComplete`, `onComplete` (with image preservation).
- **Hero URL passed to preview:** `src/components/Dashboard/PostsTab.js` — `heroImageUrl={selectedTopic?.image ?? currentDraft?.topic?.image ?? undefined}` for `StreamingPreview`.
