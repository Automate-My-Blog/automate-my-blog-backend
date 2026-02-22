# Content Calendar — Frontend Handoff

This document describes how the frontend integrates with the **30-day content calendar** feature. When users subscribe to a strategy, the backend automatically generates a 30-day content calendar (30 unique blog post ideas). The frontend displays this calendar in StrategyDetailsView and supports a unified view across multiple strategies.

**Related:** [Issue #270 — Full 30-Day Content Calendar Generation on Strategy Purchase](https://github.com/Automate-My-Blog/automate-my-blog-backend/issues/270)

---

## 1. Overview

**Backend flow (already implemented):**

1. User completes Stripe checkout for a strategy (or bundle).
2. Webhook handler enqueues a `content_calendar` background job.
3. Worker generates 30 SEO-optimized ideas via OpenAI and writes them to `audiences.content_ideas`.
4. Frontend fetches calendar data via API.

**Frontend responsibilities:**

- Display the 30-day calendar for a single strategy (StrategyDetailsView).
- Show "Calendar generating..." or skeleton while `content_ideas` is empty and `content_calendar_generated_at` is null.
- Optional: unified calendar view across multiple strategies (Phase 2).
- Handle empty/partial calendars and errors gracefully.

---

## 2. Auth

All content calendar endpoints require a **logged-in user** (JWT).

- **Header:** `Authorization: Bearer <JWT>`
- **401** if not authenticated.

---

## 3. API Endpoints

### 3.1 Unified content calendar (all subscribed strategies)

**Request**

- **Method:** `GET`
- **URL:** `${API_BASE}/api/v1/strategies/content-calendar`
- **Query (optional):** `startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` — *not yet used by backend; reserved for future date filtering*

**Response (200)**

```json
{
  "success": true,
  "strategies": [
    {
      "strategyId": "uuid",
      "targetSegment": {
        "demographics": "...",
        "psychographics": "...",
        "searchBehavior": "..."
      },
      "customerProblem": "...",
      "contentIdeas": [
        {
          "dayNumber": 1,
          "title": "SEO-friendly blog post title",
          "searchIntent": "Why they search for this",
          "format": "how-to",
          "keywords": ["keyword1", "keyword2"]
        },
        {
          "dayNumber": 2,
          "title": "Another title",
          "searchIntent": "...",
          "format": "listicle",
          "keywords": []
        }
      ],
      "contentCalendarGeneratedAt": "2026-02-13T19:00:00.000Z",
      "subscribedAt": "2026-02-13T18:55:00.000Z"
    }
  ],
  "totalStrategies": 1
}
```

- `strategies`: All **active** subscribed strategies for the user, ordered by subscription date (newest first).
- `contentIdeas`: Array of up to 30 ideas per strategy. Empty `[]` when calendar is still generating or generation failed.
- `contentCalendarGeneratedAt`: `null` when calendar has not been generated yet; ISO timestamp when ready.
- `subscribedAt`: When the user subscribed to this strategy.

**Use for:** Unified calendar view, strategy switcher, or fetching all calendars in one request.

---

### 3.2 Single strategy / audience (by ID)

**Request**

- **Method:** `GET`
- **URL:** `${API_BASE}/api/v1/audiences/:id`

**Response (200)**

```json
{
  "success": true,
  "audience": {
    "id": "uuid",
    "target_segment": { "demographics": "...", "psychographics": "...", "searchBehavior": "..." },
    "customer_problem": "...",
    "content_ideas": [
      {
        "dayNumber": 1,
        "title": "...",
        "searchIntent": "...",
        "format": "how-to",
        "keywords": []
      }
    ],
    "content_calendar_generated_at": "2026-02-13T19:00:00.000Z",
    "created_at": "...",
    "updated_at": "...",
    "topics": [],
    "keywords": []
  }
}
```

- `content_ideas`: Same structure as `contentIdeas` above. `null` or `[]` when not yet generated.
- `content_calendar_generated_at`: `null` when calendar not ready; ISO timestamp when generated.

**Use for:** StrategyDetailsView when viewing a single strategy by audience ID. Note: `strategy_id` in subscriptions = `audiences.id`.

---

### 3.3 Audiences list (with calendar indicator)

**Request**

- **Method:** `GET`
- **URL:** `${API_BASE}/api/v1/audiences`

**Response (200)**

```json
{
  "success": true,
  "audiences": [
    {
      "id": "uuid",
      "target_segment": { ... },
      "customer_problem": "...",
      "topics_count": 0,
      "keywords_count": 0,
      "content_calendar_generated_at": "2026-02-13T19:00:00.000Z",
      "has_content_calendar": true,
      "created_at": "..."
    },
    {
      "id": "uuid2",
      "has_content_calendar": false,
      "content_calendar_generated_at": null
    }
  ],
  "total": 2
}
```

- `has_content_calendar`: `true` when `content_ideas` is a non-empty array.
- Use this to show a "Calendar ready" badge or hide the calendar section when `false`.

---

## 4. Content idea schema

Each item in `contentIdeas` / `content_ideas` has this shape:

| Field        | Type     | Required | Description                                              |
|-------------|----------|----------|----------------------------------------------------------|
| `dayNumber` | number   | yes      | 1–30, day in the 30-day calendar                        |
| `title`     | string   | yes      | SEO-optimized blog post title (≈50–60 chars ideal)       |
| `searchIntent` | string | no       | Why the audience searches for this topic                 |
| `format`    | string   | no       | `how-to`, `listicle`, `guide`, `case-study`, `comparison`, `checklist`, etc. |
| `keywords`  | string[] | no       | Target keywords for SEO                                  |

---

## 5. Loading and state handling

### 5.1 Strategy just purchased

- `contentIdeas` is `[]` (or `null`).
- `contentCalendarGeneratedAt` is `null`.
- **UI:** Show "Your 30-day content calendar is being generated. This usually takes 15–30 seconds." and a skeleton or spinner.
- **Polling:** Poll `GET /api/v1/strategies/content-calendar` or `GET /api/v1/audiences/:id` every 5–10 seconds until `contentCalendarGeneratedAt` is non-null or `contentIdeas.length > 0`.
- **Timeout:** After ~2 minutes, show "Calendar is taking longer than expected. Refresh the page or contact support."

### 5.2 Calendar ready

- `contentIdeas` has up to 30 items.
- `contentCalendarGeneratedAt` is set.
- **UI:** Render the full 30-day calendar (e.g., day cards or list).

### 5.3 Generation failed (backend)

- `contentIdeas` may remain `[]` and `contentCalendarGeneratedAt` `null`.
- **UI:** After timeout, offer "Retry" or "Contact support." *(Backend does not yet expose a retry endpoint; Phase 2.)*

### 5.4 No subscribed strategies

- `GET /api/v1/strategies/content-calendar` returns `strategies: []`.
- **UI:** Show "Subscribe to a strategy to get your 30-day content calendar."

---

## 6. Suggested UI components and flows

### 6.1 StrategyDetailsView (single strategy)

Reference: Issue #270 mentions *"Display in StrategyDetailsView component"* and *"teaser exists, needs full view"*.

- **If `has_content_calendar` or `content_ideas.length > 0`:** Replace teaser (3 ideas) with full 30-day calendar.
- **Layout options:**
  - **List:** 30 rows (day 1–30) with title, format badge, keywords.
  - **Calendar grid:** 30 days in a monthly-style grid; click day for details.
  - **Kanban:** Columns for content type (how-to, listicle, etc.) with cards.
- **Metadata:** Show `content_calendar_generated_at` as "Generated on [date]" if desired.
- **Empty state:** Use loading/error states from §5.

### 6.2 Unified calendar (Phase 2, optional for MVP)

- Fetch `GET /api/v1/strategies/content-calendar`.
- Merge `contentIdeas` from multiple strategies:
  - Backend does **not** yet perform conflict resolution.
  - Frontend can: (a) show one strategy at a time with a switcher, or (b) flatten all ideas and assign days, with simple conflict handling (e.g., same day = show both, or pick by `subscribedAt`).
- **Color-coding:** Use different colors per `strategyId` when showing multiple strategies.
- **Filters:** Filter by strategy, format, or date range.

### 6.3 Audiences list badges

- Use `has_content_calendar` from `GET /api/v1/audiences` to show a "Calendar ready" badge or icon next to strategies that have a generated calendar.
- Strategies without a calendar can show "Calendar generating..." or no badge.

---

## 7. Terminology: strategy vs audience

- **strategy_id** in `strategy_purchases` = **audiences.id**
- One audience row = one purchasable strategy
- Use "strategy" and "audience" interchangeably in UI copy when referring to the same entity.

---

## 8. Future backend work (Phase 2+)

Per Issue #270, later phases may add:

- **Regeneration:** `POST /api/v1/content-calendar/regenerate` (individual or full)
- **Reordering:** `PUT /api/v1/content-calendar/:id/reorder`
- **Status:** `PATCH /api/v1/content-calendar/:id/status` (e.g., published/skipped)
- **Conflict resolution:** Backend merging of multi-strategy calendars
- **Export:** CSV, Google Calendar, Notion
- **Date filtering:** `startDate` / `endDate` on content-calendar endpoint

Frontend can prepare for these with extensible data structures and placeholder buttons.

---

## 9. Error handling

| Case                               | HTTP | Behavior                                                        |
|------------------------------------|------|-----------------------------------------------------------------|
| Not authenticated                  | 401  | Redirect to login or show "Sign in to view your calendar"       |
| Strategy/audience not found        | 404  | Show "Strategy not found"                                       |
| Server error                       | 500  | Show "Something went wrong" + retry                             |
| Empty strategies (no subscriptions)| 200  | `strategies: []` — show empty state                             |
| Empty contentIdeas, null generated | 200  | Treat as "generating" — show loading state and poll             |

---

## 10. Test data

**Manual test:**

1. Complete a strategy purchase on staging (Stripe test mode).
2. Wait ~15–30 seconds for the worker to generate the calendar.
3. Call `GET /api/v1/strategies/content-calendar` with a valid JWT.
4. Verify `contentIdeas` has 30 items and `contentCalendarGeneratedAt` is set.

**Script:** `node scripts/test-content-calendar-system.js --staging` (requires `BACKEND_URL` and `TEST_JWT`).

---

## 11. CORS and base URL

- Backend allows `*.vercel.app` origins. Use the staging/production backend URL from env (e.g. `VITE_API_BASE` or similar).
- Content calendar endpoints are under `/api/v1/strategies` and `/api/v1/audiences`.

---

## 12. Quick reference

| Purpose                      | Endpoint                                  |
|-----------------------------|-------------------------------------------|
| All strategies + calendars  | `GET /api/v1/strategies/content-calendar` |
| Single strategy/audience    | `GET /api/v1/audiences/:id`               |
| List audiences + has_calendar | `GET /api/v1/audiences`                 |

All require `Authorization: Bearer <JWT>`.

---

## 13. Calendar testbed (staging)

For frontend development at `https://staging.automatemyblog.com/calendar-testbed`, the backend can return fixture content when real data is empty. This bypasses the purchase → webhook → worker flow.

**Enable:** Set `ENABLE_CALENDAR_TESTBED=1` in Vercel Preview environment (staging).

**Use:** Add `?testbed=1` to requests, or send header `X-Calendar-Testbed: 1`.

| Endpoint | Testbed behavior |
|----------|------------------|
| `GET /api/v1/strategies/content-calendar` | Returns user's audiences (not just subscribed) with fixture `contentIdeas` when empty |
| `GET /api/v1/audiences` | Sets `has_content_calendar: true` for all audiences so list shows calendar-ready badges |
| `GET /api/v1/audiences/:id` | Returns fixture `content_ideas` when empty |

Response includes `_testbed: true` when in testbed mode.
