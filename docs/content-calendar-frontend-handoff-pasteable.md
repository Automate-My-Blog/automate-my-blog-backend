# Content Calendar — Frontend Handoff (Copy-Paste Ready)

Handoff for integrating the 30-day content calendar UI at `https://staging.automatemyblog.com/calendar-testbed` and StrategyDetailsView.

---

## 1. Base URL and Auth

- **Base:** `${VITE_API_BASE}` or your staging/production backend URL
- **Auth:** All requests need `Authorization: Bearer <accessToken>`

---

## 2. Endpoints

| Purpose | Method | URL |
|---------|--------|-----|
| All strategies + calendars | GET | `/api/v1/strategies/content-calendar` |
| Single strategy/audience | GET | `/api/v1/audiences/:id` |
| List audiences (with `has_content_calendar`) | GET | `/api/v1/audiences` |

---

## 3. Calendar testbed (`/calendar-testbed`)

On this page, add `?testbed=1` to all API calls (or header `X-Calendar-Testbed: 1`). The backend then returns fixture data when real data is empty, so you can develop without purchases or worker.

**Implementation:**

```ts
// When on calendar-testbed page:
const isCalendarTestbed = window.location.pathname.includes('/calendar-testbed');

// Append to all content-calendar / audiences requests:
const query = isCalendarTestbed ? '?testbed=1' : '';
// or: headers['X-Calendar-Testbed'] = '1';

fetch(`${API_BASE}/api/v1/strategies/content-calendar${query}`, {
  headers: { Authorization: `Bearer ${token}` }
});
```

Backend must have `ENABLE_CALENDAR_TESTBED=1` (staging only).

---

## 4. Response shapes

### GET /api/v1/strategies/content-calendar

```ts
interface ContentCalendarResponse {
  success: boolean;
  strategies: Array<{
    strategyId: string;
    targetSegment: { demographics?: string; psychographics?: string; searchBehavior?: string };
    customerProblem: string;
    contentIdeas: ContentIdea[];
    contentCalendarGeneratedAt: string | null;  // ISO timestamp when ready
    subscribedAt: string;
  }>;
  totalStrategies: number;
  _testbed?: boolean;  // present when testbed mode returned fixture data
}

interface ContentIdea {
  dayNumber: number;      // 1-30
  title: string;
  searchIntent?: string;
  format?: 'how-to' | 'listicle' | 'guide' | 'case-study' | 'comparison' | 'checklist';
  keywords?: string[];
}
```

### GET /api/v1/audiences/:id

```ts
interface AudienceDetailResponse {
  success: boolean;
  audience: {
    id: string;
    target_segment: object;
    customer_problem: string;
    content_ideas: ContentIdea[] | null;   // null when empty
    content_calendar_generated_at: string | null;
    // ... other fields
  };
}
```

### GET /api/v1/audiences

```ts
interface AudiencesListResponse {
  success: boolean;
  audiences: Array<{
    id: string;
    has_content_calendar: boolean;  // true when content_ideas has data
    content_calendar_generated_at: string | null;
    // ...
  }>;
  total: number;
}
```

---

## 5. UI flows

| State | Condition | UI |
|-------|-----------|-----|
| Loading | Fetching | Skeleton / spinner |
| Generating | `contentIdeas.length === 0` and `contentCalendarGeneratedAt === null` | "Your 30-day calendar is being generated. This usually takes 15–30 seconds." + poll every 5–10s |
| Ready | `contentIdeas.length > 0` | Render 30-day calendar (list or grid) |
| Empty | `strategies.length === 0` | "Subscribe to a strategy to get your 30-day content calendar." |
| Timeout | Polling > 2 min | "Calendar is taking longer than expected. Refresh or contact support." |

---

## 6. Polling (when generating)

```ts
const pollInterval = 5000;  // 5 seconds
const maxAttempts = 24;     // 2 minutes
let attempts = 0;

const poll = async () => {
  const res = await fetch(`${API_BASE}/api/v1/strategies/content-calendar?testbed=1`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (data.strategies?.[0]?.contentIdeas?.length > 0 || data.strategies?.[0]?.contentCalendarGeneratedAt) {
    setCalendar(data);
    return;
  }
  if (++attempts >= maxAttempts) {
    setState('timeout');
    return;
  }
  setTimeout(poll, pollInterval);
};
poll();
```

---

## 7. 30-day calendar display

Use `contentIdeas` (or `content_ideas`) as an array of 30 items. Suggested layout:

- **List:** One row per day with `dayNumber`, `title`, `format` badge, `keywords`
- **Grid:** 30-day grid (e.g. 6 columns × 5 rows) with day number and title
- **Filter:** By `format` (how-to, listicle, etc.)

---

## 8. Quick checklist

- [ ] Add `?testbed=1` when `pathname.includes('/calendar-testbed')`
- [ ] Use `GET /api/v1/strategies/content-calendar` for unified calendar
- [ ] Use `GET /api/v1/audiences/:id` for single-strategy detail
- [ ] Use `has_content_calendar` from list to show "Calendar ready" badge
- [ ] Handle `contentIdeas === []` with loading/polling state
- [ ] Handle `strategies === []` with empty state CTA
