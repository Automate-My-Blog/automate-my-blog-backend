# Website analysis narrative — frontend changes

Backend now returns a **short opening narrative** (1–2 sentences, ~140 chars) plus **insight cards** on the narrative stream. If your frontend already handles the narrative stream and/or loads analysis from the API, here’s what to do.

**Related:** [website-analysis-narrative-stream-frontend-handoff.md](./website-analysis-narrative-stream-frontend-handoff.md) (full stream contract).

---

## 1. Summary of backend changes

- **Opening narrative:** The analysis “narrative” is now a short consultant-style opening (e.g. “I analyzed Acme and learned you’re a B2B SaaS positioned as …”). No long paragraph.
- **Insight cards:** After the opening, the backend streams **4–6 insight cards** as separate events. Cards are still generated and stored; they are delivered via the narrative stream and via the REST API.
- **Stored data:** `narrative_analysis` in the DB = short opening text. `key_insights` in the DB = array of card objects (same shape as before: `category`, `heading`, `body`, `takeaway`).

---

## 2. Narrative stream (SSE) — what to implement

If you use `GET /api/v1/jobs/:jobId/narrative-stream`:

| Change | What to do |
|--------|------------|
| **Event order** | After `analysis-chunk` (short opening), you now get **`insight-card`** events (one per card), then **`narrative-complete`**. |
| **analysis-chunk** | Still word-by-word. Content is now a **short** opening (1–2 sentences). Use it as the first line of “Moment 2”; don’t expect a long paragraph. |
| **New: insight-card** | Listen for event type **`insight-card`**. `data.content` is a **JSON string** of one card: `{ category, heading, body, takeaway }`. Parse it and append to a list; render as cards (e.g. title = heading, body + takeaway below). |
| **Optional: business-profile** | You may receive **`business-profile`** with a JSON summary; handle if you show a profile block. |
| **narrative-complete** | Fires after the opening and **all** insight cards. Then transition to “Moment 3” (audiences from the main stream). |

**Minimal frontend changes:**

1. Add an event listener for **`insight-card`**; parse `data.content` and append to state (e.g. `insightCards`).
2. Render **two parts** in Moment 2: (a) the opening text from `analysis-chunk`, (b) the list of cards from `insight-card` events.
3. Keep using **`narrative-complete`** to switch to audiences; no change there.

See the [handoff doc](./website-analysis-narrative-stream-frontend-handoff.md) for payload shapes and an example.

---

## 3. REST / API — loading analysis

When you load analysis (e.g. from `GET /api/narrative/:organizationId`, or from the analysis/org endpoints that return `narrative` and `keyInsights`):

| Field | Before | After |
|-------|--------|-------|
| **narrative** | Long text (sometimes concatenation of card content). | **Short opening** (1–2 sentences). |
| **keyInsights** | Array of card objects. | **Unchanged** — still an array of `{ category, heading, body, takeaway }`. |

**What to do:**

- Use **`narrative`** as the short opening line (e.g. above the cards or as a subtitle).
- Use **`keyInsights`** to render the same insight cards you may have rendered from the stream. If you only had a single “narrative” block before, split into: opening line + card list from `keyInsights`.

---

## 4. Reconnect / replay

On reconnect, the server replays stored narrative events. Replayed events now include **`insight-card`** entries (and the short opening in **`analysis-chunk`**). No extra frontend logic is needed if you already handle `insight-card` and append to your cards list; replay will repopulate opening + cards in order.

---

## 5. Checklist

- [ ] Listen for **`insight-card`** on the narrative stream and parse `content` as JSON.
- [ ] In Moment 2, show **opening text** (from `analysis-chunk`) plus **cards** (from `insight-card`).
- [ ] When loading analysis from API, use **`narrative`** as short opening and **`keyInsights`** for the card list.
- [ ] (Optional) Handle **`business-profile`** if you display a business summary block.
