# Backend handoff: Dashboard audiences and recent analysis

This document describes how the **returning-user dashboard** uses audiences (strategies) and recent website analysis. It defines the API contracts and response shapes so the backend can support the dashboard carousel, "no strategies" fallback, and local development.

**Related:** [API_SPECIFICATION.md](./API_SPECIFICATION.md), [STRATEGY_ROUTES_AUTH_FRONTEND_HANDOFF.md](./STRATEGY_ROUTES_AUTH_FRONTEND_HANDOFF.md).

---

## 1. Dashboard flow summary

| Step | What the frontend does |
|------|------------------------|
| Load | Calls **GET /api/v1/audiences** to populate the strategy carousel. |
| If empty | Calls **GET /api/v1/user/recent-analysis** and, if analysis exists, derives 1–N strategy-shaped items (from `analysis.scenarios` or from analysis fields) so the user sees strategies even when no audiences are persisted yet. |
| Subscribe / pricing | Uses **GET /api/v1/strategies/subscribed**, **GET /api/v1/strategies/{id}/pricing**, and **GET /api/v1/strategies/overview** for subscriptions and copy. |
| Create audience | Elsewhere (e.g. Audience step after generating scenarios), frontend calls **POST /api/v1/audiences** to persist each strategy; later **GET /api/v1/audiences** returns them. |

For the message **"No strategies found. Complete website analysis to generate strategies"** to go away after a user has completed analysis, either:

- **GET /api/v1/audiences** returns at least one audience (preferred: backend persists audiences when analysis completes or when user generates strategies), or  
- **GET /api/v1/user/recent-analysis** returns an analysis object with enough data for the frontend fallback (see §3).

---

## 2. GET /api/v1/audiences

**Purpose:** Return the list of audience strategies for the current user (or anonymous session) so the dashboard carousel can show them.

### Request

| Detail | Contract |
|--------|----------|
| Method | `GET` |
| Auth | **JWT:** `Authorization: Bearer <token>`. **Anonymous:** `x-session-id: <sessionId>`. Frontend sends both when available; backend should prefer JWT. |
| Query params | Optional: `organization_intelligence_id`, `project_id`, `limit`, `offset`, `testbed=1`. |

### Response

Frontend normalizes on **`audiences`** as an array. It accepts either top-level or nested:

- `response.audiences` (array), or  
- `response.data.audiences` (array).

If neither is present, frontend treats as no audiences.

### Audience object shape (per item in `audiences`)

Frontend maps each item with `transformAudienceToStrategy`. Backend should provide at least:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | Yes | Unique audience ID (UUID or string). |
| `pitch` | string | No | Marketing pitch; can be empty. |
| `image_url` or `imageUrl` | string | No | Card image URL. |
| `target_segment` | object or string | No | If string, frontend tries to JSON-parse; else expects `{ demographics, psychographics?, searchBehavior? }`. |
| `customer_problem` | string | No | Shown as pain point / focus. |
| `customer_language` or `customer_language` | array | No | Keywords / phrases. |
| `conversion_path` | string | No | |
| `business_value` | object | No | `{ searchVolume?, conversionPotential?, priority?, competition? }`. |
| `seo_keywords` | array | No | |
| `content_ideas` | array | No | |
| Pricing (optional) | | | `pricing_monthly`, `pricing_annual`, `posts_recommended`, `posts_maximum`, etc., for display. |

Missing optional fields are defaulted in the frontend (e.g. empty string, empty array).

---

## 3. GET /api/v1/user/recent-analysis

**Purpose:** Return the user's most recent website analysis. Used by the dashboard when **GET /api/v1/audiences** returns empty so the frontend can show strategies derived from analysis ("strategies from recent analysis" fallback).

### Request

| Detail | Contract |
|--------|----------|
| Method | `GET` |
| Auth | JWT (frontend sends for logged-in users). Anonymous users may get 404 or empty. |

### Response and 404

- **200:** Body must expose the analysis object as either `response.analysis` or `response.data.analysis`.
- **404:** Treated as "no cached analysis." Frontend catches 404 and resolves with `{ success: false, analysis: null, message: 'No cached analysis found' }`. Backend should return 404 when the user has no stored analysis (no need for a special error body).

### Analysis object shape (for dashboard fallback)

The frontend uses this only when audiences are empty. It needs **one** of:

**Option A – Scenarios (preferred)**  
Include a `scenarios` array. Each element can use snake_case or camelCase; frontend reads both:

| Field | Type | Notes |
|-------|------|--------|
| `targetSegment` or `target_segment` | object | `demographics`, `psychographics`, `searchBehavior` (or `search_behavior`). |
| `customerProblem` or `customer_problem` | string | |
| `pitch` | string | |
| `imageUrl` or `image_url` | string | |
| `customerLanguage` / `customer_language`, `seoKeywords` / `seo_keywords` | array | |
| `conversionPath` / `conversion_path` | string | |
| `businessValue` / `business_value` | object | |
| `contentIdeas` / `content_ideas` | array | |

Frontend maps each scenario to a carousel strategy with IDs like `analysis-scenario-0`, `analysis-scenario-1`, etc.

**Option B – No scenarios (fallback)**  
If there is no `scenarios` array but the analysis has at least one of `businessName`, `targetAudience`, or `contentFocus`, the frontend builds 1–2 synthetic strategies from:

- `targetAudience` or `decisionMakers` → primary segment demographics  
- `endUsers` → secondary segment  
- `customerProblems` (array) → pain points  
- `contentFocus`, `customerLanguage`, `keywords` → copy and keywords  

So for the fallback to work, **recent-analysis** should return an analysis object that either has `scenarios` or has basic fields such as `businessName`, `targetAudience` / `decisionMakers`, `contentFocus`, and optionally `customerProblems`, `endUsers`, `customerLanguage`, `keywords`.

---

## 4. POST /api/v1/audiences

**Purpose:** Create a new audience (strategy). Used when the user has generated strategies (e.g. from the Audience step or from analysis scenarios) and the frontend persists them so that **GET /api/v1/audiences** returns them on next load.

### Request

| Detail | Contract |
|--------|----------|
| Method | `POST` |
| Auth | JWT preferred; if no JWT, frontend sends `session_id` in body and may send `x-session-id` header. |
| Body | JSON. Fields the frontend sends include: `pitch`, `image_url`, `target_segment`, `customer_problem`, `customer_language`, `conversion_path`, `business_value`, `priority`. For anonymous: `session_id` in body. |

### Response

Frontend expects the created audience in **`response.audience`** (or `response.data.audience`), with at least **`audience.id`** so it can update local state and call keyword/other endpoints.

---

## 5. GET /api/v1/strategies/subscribed

**Purpose:** List the current user's subscribed strategies so the dashboard can show which carousel strategies are subscribed and show quota/performance.

### Request

- Method: `GET`  
- Auth: JWT

### Response

Frontend accepts:

- A **top-level array**, or  
- An object with **`subscriptions`** (array).

Each subscription item should have at least **`strategy_id`** or **`strategyId`** so the frontend can match to carousel strategies. Optional: `drafts_count`, `published_count`, `scheduled_count` for performance metrics.

---

## 6. Other dashboard-related endpoints (reference)

| Endpoint | Use on dashboard |
|----------|-------------------|
| **GET /api/v1/strategies/overview** | Personalized "What is an Audience Strategy?" and onboarding copy. |
| **GET /api/v1/strategies/{id}/pricing** | Pricing for a strategy when user clicks an unsubscribed strategy. |
| **GET /api/v1/posts** | Posts list below the carousel; optional `?strategy_id=...` to filter. |

---

## 7. Summary for backend

1. **GET /api/v1/audiences** – Return `audiences` array (or `data.audiences`). Support JWT and optionally `x-session-id`. When a user has completed analysis and/or generated strategies, persisting them and returning them here avoids "No strategies found."
2. **GET /api/v1/user/recent-analysis** – Return 200 with `analysis` (or `data.analysis`). Include either `analysis.scenarios[]` (preferred) or at least `businessName` / `targetAudience` / `contentFocus` (and optionally `customerProblems`, `endUsers`, etc.) so the frontend fallback can show strategies when audiences are empty. Return 404 when there is no stored analysis.
3. **POST /api/v1/audiences** – Accept the documented body and return `audience` with `id` so the frontend can persist strategies and have them appear on the next **GET /api/v1/audiences**.
4. **GET /api/v1/strategies/subscribed** – Return an array (or object with `subscriptions`) containing at least `strategy_id`/`strategyId` per subscription.

With (1) and (2) in place, the dashboard shows strategies either from persisted audiences or from recent analysis, so "No strategies found. Complete website analysis to generate strategies" appears only when the user has neither audiences nor a recent analysis.
