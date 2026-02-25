# Content Calendar — Frontend Integration Handoff

Single handoff for integrating the **30-day content calendar** into the frontend. Use this doc for StrategyDetailsView, a dedicated calendar page, or the calendar testbed at `/calendar-testbed`.

**Related:** [Issue #270 — Full 30-Day Content Calendar](https://github.com/Automate-My-Blog/automate-my-blog-backend/issues/270)

---

## Table of contents

1. [Overview](#1-overview)
2. [Auth](#2-auth)
3. [Endpoints & types](#3-endpoints--types)
4. [Content idea schema](#4-content-idea-schema)
5. [UI states & polling](#5-ui-states--polling)
6. [Calendar testbed](#6-calendar-testbed)
7. [Progress streaming (optional)](#7-progress-streaming-optional)
8. [Errors](#8-errors)
9. [Checklist](#9-checklist)

---

## 1. Overview

**Backend flow (already implemented):**

1. User completes Stripe checkout for a strategy (or bundle).
2. Webhook enqueues a `content_calendar` background job.
3. Worker generates 30 SEO-optimized ideas via OpenAI and saves to `audiences.content_ideas`.
4. Frontend fetches calendar via API and displays it.

**Frontend responsibilities:**

- Show 30-day calendar for a strategy (StrategyDetailsView or dedicated view).
- Show “Calendar generating…” + skeleton while data is empty; poll until ready.
- Use “Calendar ready” badge on audiences list via `has_content_calendar`.
- Handle empty (no subscriptions), timeout, and errors.

**Terminology:** `strategy_id` in subscriptions = `audiences.id`. One audience row = one purchasable strategy. Use “strategy” and “audience” interchangeably in UI when referring to the same entity.

---

## 2. Auth

All content calendar endpoints require a logged-in user (JWT).

- **Header:** `Authorization: Bearer <accessToken>`
- **401** if not authenticated → redirect to login or show “Sign in to view your calendar.”

---

## 3. Endpoints & types

**Base URL:** Use `VITE_API_BASE` (or your staging/production backend URL).

| Purpose | Method | URL |
|--------|--------|-----|
| All strategies + calendars | GET | `/api/v1/strategies/content-calendar` |
| Single strategy/audience | GET | `/api/v1/audiences/:id` |
| List audiences (with calendar indicator) | GET | `/api/v1/audiences` |

### GET /api/v1/strategies/content-calendar

Unified 30-day calendar across all **subscribed** strategies. Use for a calendar page or strategy switcher.

**Query (optional):**

- `startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` — reserved for future date filtering (not yet used).
- `testbed=1` — testbed mode (see [§6](#6-calendar-testbed)).

**Response (200):**

```ts
interface ContentCalendarResponse {
  success: boolean;
  strategies: ContentCalendarStrategy[];
  totalStrategies: number;
  _testbed?: boolean;  // present when testbed returned fixture data
}

interface ContentCalendarStrategy {
  strategyId: string;
  targetSegment: { demographics?: string; psychographics?: string; searchBehavior?: string };
  customerProblem: string;
  contentIdeas: ContentIdea[];
  contentCalendarGeneratedAt: string | null;  // ISO when ready; null while generating
  /** Trending topics (query, value) used when this calendar was generated; for "Topics used for this calendar" UI */
  trendingTopicsUsed: TrendingTopicUsed[];
  subscribedAt: string;
}

interface TrendingTopicUsed {
  query: string;
  value: number;  // growth value from Google Trends (e.g. percentage)
}

interface ContentIdea {
  dayNumber: number;   // 1–30
  title: string;
  searchIntent?: string;
  format?: string;     // e.g. 'how-to' | 'listicle' | 'guide' | 'case-study' | 'comparison' | 'checklist'
  keywords?: string[];
}
```

- `contentIdeas`: Up to 30 items. Empty `[]` when still generating or generation failed.
- `contentCalendarGeneratedAt`: `null` until calendar is ready; then ISO timestamp.

### GET /api/v1/audiences/:id

Single audience/strategy including full calendar. Use for StrategyDetailsView when viewing one strategy.

**Response (200):** `audience` includes:

- `content_ideas`: `ContentIdea[] | null` — same shape as `contentIdeas` above; `null` or `[]` when not ready.
- `content_calendar_generated_at`: `string | null` — ISO when generated.
- `content_calendar_trending_topics`: `Array<{ query: string; value: number }> | null` — trending topics used when the calendar was generated; `null` or empty when none were used or calendar not yet generated.

### GET /api/v1/audiences

List of user’s audiences with calendar indicator. Use for list badges and navigation.

**Response (200):** Each audience includes:

- `has_content_calendar`: `boolean` — `true` when `content_ideas` has data.
- `content_calendar_generated_at`: `string | null`.
- `content_calendar_trending_topics`: `Array<{ query: string; value: number }> | null` — trending topics used when the calendar was last generated; `null` when none or not yet generated.

Use `has_content_calendar` to show a “Calendar ready” badge; no badge or “Generating…” when `false`.

### Where trending topics appear

| Endpoint | Field | When populated |
|----------|--------|----------------|
| `GET /api/v1/strategies/content-calendar` | Each strategy: `trendingTopicsUsed` | Snapshot saved when that strategy's calendar was last generated (regenerate or first generation). |
| `GET /api/v1/audiences/:id` | `audience.content_calendar_trending_topics` | Same snapshot. |
| `GET /api/v1/audiences` | Each audience: `content_calendar_trending_topics` | Same snapshot. |

**If trending is always empty after regeneration:** Ensure migration 045 is applied (`content_calendar_trending_topics` on `audiences`). Trending is only saved when the worker had data from strategy keywords (Google Trends cache). Check that the strategy has `seo_keywords` and the worker ran `fetchTrendsForContentCalendar` before generating.

---

## 4. Content idea schema

Each item in `contentIdeas` / `content_ideas`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `dayNumber` | number | yes | 1–30 |
| `title` | string | yes | SEO-optimized blog post title (~50–60 chars ideal) |
| `searchIntent` | string | no | Why the audience searches for this topic |
| `format` | string | no | e.g. `how-to`, `listicle`, `guide`, `case-study`, `comparison`, `checklist` |
| `keywords` | string[] | no | Target keywords for SEO |

---

## 5. UI states & polling

| State | Condition | UI |
|-------|-----------|----|
| **Loading** | Initial fetch | Skeleton / spinner |
| **Generating** | `contentIdeas.length === 0` and `contentCalendarGeneratedAt === null` | “Your 30-day calendar is being generated. This usually takes 15–30 seconds.” + poll every 5–10 s |
| **Ready** | `contentIdeas.length > 0` | Render 30-day calendar (list or grid) |
| **Empty** | `strategies.length === 0` (content-calendar) | “Subscribe to a strategy to get your 30-day content calendar.” |
| **Timeout** | Polling > ~2 min | “Calendar is taking longer than expected. Refresh the page or contact support.” |

**Polling example (when generating):**

```ts
const API_BASE = import.meta.env.VITE_API_BASE;
const pollInterval = 5000;  // 5 s
const maxAttempts = 24;     // 2 min

async function pollContentCalendar(accessToken: string, onReady: (data: ContentCalendarResponse) => void) {
  let attempts = 0;
  const query = window.location.pathname.includes('/calendar-testbed') ? '?testbed=1' : '';

  const poll = async () => {
    const res = await fetch(`${API_BASE}/api/v1/strategies/content-calendar${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    const strategy = data.strategies?.[0];
    if (strategy?.contentIdeas?.length > 0 || strategy?.contentCalendarGeneratedAt) {
      onReady(data);
      return;
    }
    if (++attempts >= maxAttempts) {
      // show timeout state
      return;
    }
    setTimeout(poll, pollInterval);
  };
  poll();
}
```

**Display options for 30 days:** List (one row per day with title, format badge, keywords), calendar grid (e.g. 6×5), or filter by `format`.

---

## 6. Calendar testbed

For development at `https://staging.automatemyblog.com/calendar-testbed` without real purchases or worker:

- **Backend:** Set `ENABLE_CALENDAR_TESTBED=1` in Vercel Preview (staging).
- **Frontend:** Add `?testbed=1` to requests, or header `X-Calendar-Testbed: 1`.

When testbed is on:

- `GET /api/v1/strategies/content-calendar` returns user’s audiences (not only subscribed) and fixture `contentIdeas` when real data is empty.
- `GET /api/v1/audiences` sets `has_content_calendar: true` for all audiences.
- `GET /api/v1/audiences/:id` returns fixture `content_ideas` when empty.

Response may include `_testbed: true` when fixture data was used.

```ts
const isCalendarTestbed = window.location.pathname.includes('/calendar-testbed');
const query = isCalendarTestbed ? '?testbed=1' : '';
fetch(`${API_BASE}/api/v1/strategies/content-calendar${query}`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

---

## 7. Progress streaming (optional)

When the frontend has a **job ID** for a `content_calendar` job (e.g. from a future “Regenerate” endpoint), you can show step-by-step progress instead of a generic spinner.

- **Stream:** `GET /api/v1/jobs/:jobId/stream?token=<accessToken>` (SSE).
- **Events:** `connected`, `progress-update` (e.g. `progress` 0–100, `currentStep`, `phase`), `complete`, `failed`.
- **Fallback:** Poll `GET /api/v1/jobs/:jobId/status` if the stream closes early.

Full details: **[Content Calendar Generation — Progress & Streaming](./content-calendar-generation-progress-frontend-handoff.md)**.

**Google Trends:** When the user has strategies with keywords, the backend runs a one-time "Fetching trending topics…" step before generating the calendar. Progress and job result fields for this are described in **[Content Calendar — Google Trends Integration (Frontend Handoff)](./CONTENT_CALENDAR_GOOGLE_TRENDS_FRONTEND_HANDOFF.md)**.

If you don’t have a job ID (e.g. after Stripe checkout), keep using polling as in [§5](#5-ui-states--polling).

---

## 8. Errors

| Case | HTTP | Frontend behavior |
|------|------|--------------------|
| Not authenticated | 401 | Redirect to login or “Sign in to view your calendar.” |
| Strategy/audience not found | 404 | “Strategy not found.” |
| Server error | 500 | “Something went wrong” + retry. |
| No subscriptions | 200 | `strategies: []` → empty state: “Subscribe to a strategy to get your 30-day content calendar.” |
| Generating | 200 | `contentIdeas: []`, `contentCalendarGeneratedAt: null` → loading + poll. |

---

## 9. Checklist

- [ ] Use `Authorization: Bearer <accessToken>` on all requests.
- [ ] Use `GET /api/v1/strategies/content-calendar` for unified calendar (or strategy switcher).
- [ ] Use `GET /api/v1/audiences/:id` for single-strategy view (StrategyDetailsView).
- [ ] Use `has_content_calendar` from `GET /api/v1/audiences` for “Calendar ready” badge.
- [ ] When `contentIdeas.length === 0` and `contentCalendarGeneratedAt === null`, show “Generating…” and poll every 5–10 s (timeout ~2 min).
- [ ] When `strategies.length === 0`, show empty state CTA to subscribe.
- [ ] On `/calendar-testbed`, add `?testbed=1` (or `X-Calendar-Testbed: 1`) to content-calendar and audiences requests.
- [ ] (Optional) When you have a `jobId`, use job stream for progress UI — see [§7](#7-progress-streaming-optional).
- [ ] (Optional) When showing calendar job progress, display "Fetching trending topics…" when present; when job completes, show "Calendar informed by trending topics" if result has `trendsFetched: true` — see [Content Calendar — Google Trends Integration](./CONTENT_CALENDAR_GOOGLE_TRENDS_FRONTEND_HANDOFF.md).

---

## Quick reference

| Purpose | Endpoint |
|--------|----------|
| All strategies + calendars | `GET /api/v1/strategies/content-calendar` |
| Single strategy/audience | `GET /api/v1/audiences/:id` |
| List audiences + calendar badge | `GET /api/v1/audiences` |

All require `Authorization: Bearer <JWT>`.

**Testing:** `node scripts/test-content-calendar-system.js --staging` (requires `BACKEND_URL`, `TEST_JWT`). See [CONTENT_CALENDAR_TESTING.md](./CONTENT_CALENDAR_TESTING.md) for full test flow.

---

## Backend production hardening (for reference)

- **Duplicate job prevention:** No second `content_calendar` job is enqueued if one is already queued or running for the same user and strategy set (e.g. Stripe webhook retries).
- **Retries:** Content calendar jobs use 3 attempts with exponential backoff (5s base) so transient OpenAI/DB failures are retried.
- **Ownership check:** The worker only generates for audiences that belong to the job’s user.
- **Empty calendar:** If generation returns zero ideas, the backend does not persist; the job fails so it can be retried and the UI stays in “generating” instead of showing an empty calendar.
