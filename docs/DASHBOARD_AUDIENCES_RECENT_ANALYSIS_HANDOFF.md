# Backend handoff: Dashboard (returning users only)

This document describes how the **returning-user dashboard** works and what the backend must provide. The dashboard is **only used by returning users**; new users go through the onboarding funnel. We **assume website analysis is already completed** for everyone who sees this dashboard.

**Related:** [API_SPECIFICATION.md](./API_SPECIFICATION.md), [STRATEGY_ROUTES_AUTH_FRONTEND_HANDOFF.md](./STRATEGY_ROUTES_AUTH_FRONTEND_HANDOFF.md).

---

## 1. Assumptions

| Assumption | Implication |
|------------|-------------|
| **Returning users only** | No "complete website analysis" or "run analysis first" messaging on this page. Onboarding is handled elsewhere. |
| **Analysis already completed** | Every user who lands here has completed website analysis. The backend should have (or can derive) their analysis and/or audiences. |
| **Dashboard shows strategies → topics → post** | User picks a strategy from the carousel, then generates topics and creates a post. The backend must supply strategies (audiences) or analysis so the carousel is populated. |

---

## 2. Frontend logic (returning users, analysis assumed done)

The frontend is built around the assumption that analysis is already completed:

| Area | Behavior |
|------|----------|
| **Home (DashboardTab)** | For every logged-in user, the frontend calls **GET /api/v1/user/recent-analysis** on mount and, when present, writes the result into context (`websiteAnalysis`, `analysisCompleted`). The dashboard does **not** show the hero ("Get your website seen") or the website URL input; it shows only a welcome-back hint (when we have analysis), a "Go to strategies" CTA when analysis exists, or "Your saved analysis will appear here" when we have no analysis yet. |
| **Audience (ReturningUserDashboard)** | On load we request **GET /api/v1/audiences** and **GET /api/v1/user/recent-analysis** **in parallel** (we assume analysis exists for returning users, so we need it as soon as we know audiences is empty). If audiences is empty, we derive strategies from (1) in-session context, then (2) the recent-analysis response we already have. No sequential "audiences then recent-analysis" delay. |
| **Empty carousel** | If audiences and both analysis sources yield no strategies, we show only the neutral message: "No strategies yet. Your strategies will appear here based on your saved analysis." We do not show "complete website analysis" or any onboarding-style copy. |
| **Create New Post** | There is no gate on "analysis completed" or "topic selected"; the button scrolls to the Audience section. |

So the backend can assume that the dashboard will call **recent-analysis** for logged-in users and will use it to populate strategies when **audiences** is empty. Returning users are never asked on this page to complete analysis first.

---

## 3. Dashboard flow and backend responsibility

1. **GET /api/v1/audiences** – Primary source. Return the user's audience strategies (from their completed analysis). If this returns a non-empty array, the carousel shows them.
2. **If audiences is empty** – Frontend already has (or is loading) **GET /api/v1/user/recent-analysis** in parallel. It derives strategies from in-session analysis or from that API response (see §2).
3. If both audiences and derived strategies are empty, the UI shows only the neutral empty state (no "complete analysis" messaging).

**Backend responsibility:** For returning users who have completed analysis, ensure at least one of the following so the carousel is useful:

- **Preferred:** When analysis is completed (or when the user generates strategies elsewhere), persist audiences and return them from **GET /api/v1/audiences**.
- **Alternative:** Return the user's analysis from **GET /api/v1/user/recent-analysis** (with `scenarios` or with basic fields per §4) so the frontend can derive strategies when audiences are empty.

---

## 4. GET /api/v1/audiences

**Purpose:** Return the list of audience strategies for the current user so the dashboard carousel can show them.

### Request

| Detail | Contract |
|--------|----------|
| Method | `GET` |
| Auth | **JWT:** `Authorization: Bearer <token>`. **Anonymous:** `x-session-id: <sessionId>`. Frontend sends both when available; backend should prefer JWT. |
| Query params | Optional: `organization_intelligence_id`, `project_id`, `limit`, `offset`, `testbed=1`. |

### Response

Frontend normalizes on **`audiences`** as an array:

- `response.audiences` (array), or  
- `response.data.audiences` (array).

If neither is present, frontend treats as no audiences and may use recent-analysis fallback.

### Audience object shape (per item in `audiences`)

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
| Pricing (optional) | | | `pricing_monthly`, `pricing_annual`, `posts_recommended`, `posts_maximum`, etc. |

Missing optional fields are defaulted in the frontend.

---

## 5. GET /api/v1/user/recent-analysis (fallback when audiences empty)

**Purpose:** Return the user's most recent website analysis. Used only when **GET /api/v1/audiences** returns empty, so the frontend can derive strategy-shaped items and show them in the carousel.

### Request

| Detail | Contract |
|--------|----------|
| Method | `GET` |
| Auth | JWT (frontend sends for logged-in users). |

### Response and 404

- **200:** Body must expose the analysis object as `response.analysis` or `response.data.analysis`.
- **404 or "No cached analysis found":** Treated as "no stored analysis." Frontend does not surface an error; it may show the neutral empty state or use in-session analysis if available.

### Analysis object shape (for strategy derivation)

The frontend needs **one** of:

**Option A – Scenarios (preferred)**  
Include `analysis.scenarios` (array). Each element can use snake_case or camelCase. Fields used: `targetSegment`/`target_segment`, `customerProblem`/`customer_problem`, `pitch`, `imageUrl`/`image_url`, `customerLanguage`, `seoKeywords`, `conversionPath`, `businessValue`, `contentIdeas`.

**Option B – Basic fields (fallback)**  
No `scenarios` array, but at least one of: `businessName`, `targetAudience`, `contentFocus`, `decisionMakers`. The frontend builds 1–2 synthetic strategies from `targetAudience`/`decisionMakers`, `endUsers`, `customerProblems`, `contentFocus`, `customerLanguage`, `keywords`.

### 5.1 Onboarding persistence and topic generation

**Requirement:** When a user completes **website analysis during onboarding**, the backend must **persist that analysis** and associate it with the user (e.g. by user id or account) so that **GET /api/v1/user/recent-analysis** returns it when they later visit the dashboard.

The frontend uses the **same** recent-analysis response for two things:

1. **Strategy carousel** – When audiences are empty, we derive strategies from `analysis.scenarios` or basic fields (§5 Option A/B).
2. **Topic generation** – When the user clicks "Generate Content Topics" / "Generate post" on the dashboard, we send this analysis to the topic-generation API. If the analysis is missing or empty, the user sees: *"Website analysis data is required for topic generation. Please analyze your website first."*

So for **topic generation to work** after onboarding, the analysis object returned by recent-analysis must include **at least one** of (camelCase or snake_case):

| Purpose        | Required (at least one) |
|----------------|--------------------------|
| Minimum check  | `businessName` / `business_name`, `targetAudience` / `target_audience`, `decisionMakers` / `decision_makers`, `businessType` / `business_type` |

**Backend checklist:**

- [x] When the user completes website analysis (e.g. at end of onboarding or after "analyze my website"), persist the analysis and link it to the current user.
- [x] **GET /api/v1/user/recent-analysis** returns 200 with `response.analysis` or `response.data.analysis` set to that persisted analysis for the authenticated user.
- [x] The analysis object includes at least one of: `businessName`, `targetAudience`, `decisionMakers`, `businessType` (or snake_case equivalents). Prefer also including `scenarios` or `contentFocus` for a better experience.
- [x] Return 404 (or body indicating no cached analysis) only when the user has never completed analysis or no analysis is stored for that user.

If the backend already persists analysis at onboarding and returns it from recent-analysis with the fields above, no change is needed. If users who completed onboarding still get "Missing website analysis data" when clicking Generate post, the backend should ensure (1) analysis is persisted at onboarding and (2) recent-analysis returns that analysis for the logged-in user.

---

## 6. POST /api/v1/audiences

**Purpose:** Create a new audience (strategy). Used when the user generates strategies (e.g. in another flow) and the frontend persists them so **GET /api/v1/audiences** returns them on the dashboard.

### Request

| Detail | Contract |
|--------|----------|
| Method | `POST` |
| Auth | JWT preferred; if no JWT, frontend may send `session_id` in body and `x-session-id` header. |
| Body | JSON: `pitch`, `image_url`, `target_segment`, `customer_problem`, `customer_language`, `conversion_path`, `business_value`, `priority`. Optional: `session_id` for anonymous. |

### Response

Frontend expects **`response.audience`** (or `response.data.audience`) with at least **`audience.id`**.

---

## 7. GET /api/v1/strategies/subscribed

**Purpose:** List the current user's subscribed strategies for the dashboard (subscribed state, quota, etc.).

### Request

- Method: `GET`  
- Auth: JWT

### Response

- A **top-level array**, or an object with **`subscriptions`** (array).  
- Each item: at least **`strategy_id`** or **`strategyId`**. Optional: `drafts_count`, `published_count`, `scheduled_count`.

---

## 8. Other dashboard-related endpoints (reference)

| Endpoint | Use on dashboard |
|----------|-------------------|
| **GET /api/v1/strategies/overview** | "What is an Audience Strategy?" and related copy. |
| **GET /api/v1/strategies/{id}/pricing** | Pricing when user clicks an unsubscribed strategy. |
| **GET /api/v1/posts** | Posts list; optional `?strategy_id=...` to filter. |

---

## 9. Summary for backend

1. **Returning users only / analysis done:** The dashboard assumes every user has already completed website analysis. Do not rely on the frontend to ask users to "complete analysis" on this page.
2. **GET /api/v1/audiences:** Return the user's audiences (from their completed analysis). Prefer persisting audiences when analysis completes or when strategies are generated, so this endpoint is the primary source and the carousel is populated without fallbacks.
3. **GET /api/v1/user/recent-analysis:** Return the user's most recent website analysis. The frontend uses it to (a) derive strategies when audiences are empty and (b) **run topic generation** when the user clicks "Generate Content Topics" on the dashboard. **After onboarding**, persist the analysis and return it here so both flows work. Return 200 with `analysis` (at least one of `businessName`/`targetAudience`/`decisionMakers`/`businessType`, and preferably `scenarios` or basic fields per §5). Return 404 only when no analysis is stored for that user.
4. **POST /api/v1/audiences:** Accept the documented body and return `audience.id` so the frontend can persist strategies and have them appear on the next **GET /api/v1/audiences**.
5. **GET /api/v1/strategies/subscribed:** Return an array (or `subscriptions`) with at least `strategy_id`/`strategyId` per subscription.

With (2) and (3) in place, returning users who have completed analysis will see strategies on the dashboard (from audiences or from derived analysis). If both are empty, the UI shows only the neutral message: "No strategies yet. Your strategies will appear here based on your saved analysis."
