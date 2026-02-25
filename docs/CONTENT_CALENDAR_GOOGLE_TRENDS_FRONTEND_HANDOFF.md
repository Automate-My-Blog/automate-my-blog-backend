# Content Calendar — Google Trends Integration (Frontend Handoff)

When a user has **Google Trends** set up (strategies with SEO keywords), the backend runs a **one-time trends fetch** before generating their 7-day (or 30-day) content calendar so the calendar is informed by fresh trending topics. This doc describes how to surface that in the UI.

**Related:** [Content Calendar — Frontend Integration Handoff](./CONTENT_CALENDAR_FRONTEND_INTEGRATION_HANDOFF.md) (endpoints, polling, testbed), [Content Calendar Generation — Progress & Streaming](./content-calendar-generation-progress-frontend-handoff.md) (job stream).

---

## Table of contents

1. [Overview](#1-overview)
2. [When trends run](#2-when-trends-run)
3. [Progress: “Fetching trending topics…”](#3-progress-fetching-trending-topics)
4. [Job result: trends fields](#4-job-result-trends-fields)
5. [UI suggestions](#5-ui-suggestions)
6. [Checklist](#6-checklist)

---

## 1. Overview

**Backend behavior:**

- Before generating the content calendar, the worker checks whether the user’s strategies have **SEO keywords**. If they do, it runs a **one-time Google Trends fetch** (rising queries for those keywords, cached per user), then generates the calendar. The calendar ideas are generated with this trending data so they align with current search trends.
- If there are no keywords, the worker skips the trends step and generates the calendar as before.
- **No new endpoints.** The same content calendar endpoints and job stream apply; we only add an optional progress step and new fields on the **job result** when the job completes.

**Frontend responsibilities:**

- When showing progress for a `content_calendar` job (via stream or status poll), show **“Fetching trending topics…”** when the backend sends that step.
- When the job completes, optionally show that the calendar was **informed by trending topics** (e.g. “Calendar informed by X trending topics”) using the job result fields below.

---

## 2. When trends run

Trends are fetched only when **all** of the following are true:

- The job is a `content_calendar` job.
- The user has at least one strategy in the job that has **SEO keywords** (from website analysis / strategy setup).

If the user has no keywords for the strategies in the job, the backend skips the trends step and does not set the trends-related result fields (or sets them to default values). The calendar is still generated; it just isn’t informed by a fresh trends fetch.

---

## 3. Progress: “Fetching trending topics…”

When the backend runs the one-time trends fetch, it sends a **progress-update** with:

- **`currentStep`:** `"Fetching trending topics..."`
- **`phase`:** `"trends"`
- **`progress`:** e.g. `8` (early in the job)
- **`trendsKeywordCount`** (optional): number of keywords we’re fetching trends for
- **`trendsFetchedCount`** (optional): number of keywords for which we successfully cached trends (may be less than `trendsKeywordCount` if some calls failed)

**Where you see it:**

- **Job stream:** `GET /api/v1/jobs/:jobId/stream?token=...` — listen for `progress-update` events. When `data.currentStep === 'Fetching trending topics...'` (or `data.phase === 'trends'`), show that label in your progress UI.
- **Job status (polling):** `GET /api/v1/jobs/:jobId/status` — response can include the same `currentStep` and optional `trendsKeywordCount` / `trendsFetchedCount` while the job is running.

**Example (stream):**

```ts
// Event: progress-update
// data:
{
  "progress": 8,
  "currentStep": "Fetching trending topics...",
  "estimatedTimeRemaining": 55,
  "phase": "trends",
  "trendsKeywordCount": 5,
  "trendsFetchedCount": 4
}
```

You can show a single line: **“Fetching trending topics…”** (and optionally “Using 5 keywords” from `trendsKeywordCount`). You do not need to show `trendsFetchedCount` during progress unless you want to.

---

## 4. Job result: trends fields

When a **content_calendar** job **completes successfully**, the job **result** object includes optional trends fields. Use these to show “Calendar informed by trending topics” (or similar) after the calendar is ready.

**Result shape (relevant fields):**

| Field | Type | When present | Description |
|-------|------|----------------|-------------|
| `trendsFetched` | boolean | Always | `true` if we ran a trends fetch (user had keywords); `false` otherwise. |
| `trendsKeywordCount` | number | When `trendsFetched === true` | Number of keywords we fetched trends for. |
| `trendsFetchedCount` | number | When `trendsFetched === true` | Number of keywords for which we successfully cached rising queries. |

**Where to read the result:**

- **Stream:** On the **`complete`** event, the payload may include the job result. Check your backend’s event schema for `complete.data.result` (or equivalent).
- **Status poll:** After the job finishes, `GET /api/v1/jobs/:jobId/status` returns `status: 'succeeded'` and a `result` object that includes `success`, `strategyCount`, `succeeded`, `failed`, `results`, and the trends fields above.

**Example (job result when trends were fetched):**

```ts
{
  "success": true,
  "strategyCount": 2,
  "succeeded": 2,
  "failed": 0,
  "results": [ { "strategyId": "...", "success": true, "ideaCount": 7 }, ... ],
  "trendsFetched": true,
  "trendsKeywordCount": 5,
  "trendsFetchedCount": 5
}
```

**Example (no keywords / trends not run):**

```ts
{
  "success": true,
  "strategyCount": 1,
  "succeeded": 1,
  "failed": 0,
  "results": [ ... ],
  "trendsFetched": false,
  "trendsKeywordCount": 0,
  "trendsFetchedCount": 0
}
```

---

## 5. UI suggestions

- **During progress (when you have a job stream or status):**  
  When `currentStep === 'Fetching trending topics...'` or `phase === 'trends'`, show that as the current step (e.g. under the progress bar or in a step list). No need to change the overall “Generating your calendar” message.

- **After job completes:**  
  If `result.trendsFetched === true`, you can show a short line near the calendar, e.g.:
  - “Calendar informed by trending topics.”
  - “Informed by X trending topics.” (using `trendsFetchedCount` or `trendsKeywordCount`)

  If `trendsFetched === false`, do nothing extra; the calendar is still valid.

- **Calendar payload unchanged:**  
  The shape of `contentIdeas` / `content_ideas` and the rest of the content calendar API is unchanged. Trends are already reflected in the generated titles and keywords; the new fields only let you **tell the user** that their calendar was informed by trends.

---

## 6. Checklist

- [ ] When showing progress for a `content_calendar` job, if `currentStep === 'Fetching trending topics...'` or `phase === 'trends'`, display that step (e.g. “Fetching trending topics…”).
- [ ] When the job completes, read the job result (`complete.data.result` or `GET /api/v1/jobs/:jobId/status` → `result`). If `result.trendsFetched === true`, optionally show “Calendar informed by trending topics” (or “Informed by X trending topics” using `trendsFetchedCount`).
- [ ] If you don’t have a job ID (e.g. post–Stripe checkout polling only), no change required; the calendar still gets trends on the backend, you just don’t show the extra copy.

---

## Quick reference

| What | Where |
|------|--------|
| Progress step | `progress-update.currentStep` = `"Fetching trending topics..."`, `phase` = `"trends"`; optional `trendsKeywordCount`, `trendsFetchedCount` |
| Job result trends | On job completion: `result.trendsFetched`, `result.trendsKeywordCount`, `result.trendsFetchedCount` |
| Calendar payload | Unchanged; trends are baked into the generated ideas. |

All content calendar and job endpoints remain as in the [Content Calendar Frontend Integration Handoff](./CONTENT_CALENDAR_FRONTEND_INTEGRATION_HANDOFF.md).
