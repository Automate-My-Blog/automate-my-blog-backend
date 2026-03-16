# Comment for Issue #270 — Full 30-Day Content Calendar

*Copy and paste this into the GitHub issue comment box.*

---

## Specific improvements to the plan (aligned with our codebase)

After reviewing the codebase, here are concrete adjustments and additions to ensure the 30-day content calendar fits our architecture.

### 1. Webhook integration — no new endpoint

The issue proposes `POST /api/v1/webhooks/stripe/strategy-purchase`. In our codebase, Stripe webhooks go to a single handler:

- **Route:** `POST /api/v1/stripe/webhook` (in `routes/stripe.js`)
- **Flow:** `handleCheckoutCompleted` → `strategyWebhooks.handleStrategyCheckoutCompleted` when `isStrategySubscription(session)` is true
- **Location:** `services/strategy-subscription-webhooks.js` — `handleIndividualStrategySubscriptionCreated` and `handleBundleSubscriptionCreated`

**Recommendation:** Trigger calendar generation **inside** the existing webhook handlers, not via a separate webhook route. After inserting into `strategy_purchases`, enqueue a background job. Do not run generation synchronously — Stripe expects a fast response; 30-idea generation will exceed timeout.

### 2. Schema — `content_ideas` does not exist on `audiences`

The issue says to store in `content_ideas` JSONB on `audiences`. That column does **not** exist yet. Current `audiences` columns include: `target_segment`, `customer_problem`, `business_value`, `pitch`, `image_url`, `seo_keywords` (separate table), etc.

**Required migration:**
```sql
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS content_ideas JSONB;
-- Consider: content_calendar_generated_at TIMESTAMP for "last updated"
```

### 3. Terminology — strategy = audience

- **strategy_id** in `strategy_purchases` references **audiences.id**
- Strategy routes (`routes/strategies.js`) read from `audiences` with `SELECT * FROM audiences WHERE id = $1`
- One audience row = one purchasable strategy

Use "strategy" and "audience" interchangeably in docs. When we "generate calendar for strategy X", we fetch the audience row by `strategy_id`.

### 4. Job queue — add new job type

Current job types: `website_analysis`, `content_generation`, `analyze_voice_sample` (`services/job-queue.js` → `JOB_TYPES`).

**Add:** `content_calendar` (or `generate_content_calendar`).

**Flow:**
1. Webhook handler creates `strategy_purchases` record(s)
2. Enqueue `content_calendar` job(s) with `{ strategyIds: [uuid], userId, isBundle }`
3. Worker processes job: fetch audience data, call OpenAI for 30 ideas, write to `audiences.content_ideas`
4. Optionally send "Your content calendar is ready" email (we have `emailService`)

### 5. Bundle subscription — scope of strategies

Bundle checkout uses:
```sql
SELECT id FROM audiences WHERE user_id = $1
```
So **all** audiences for that user are linked to the bundle. If that is intentional (bundle = "all my strategies"), we need to enqueue one job per strategy, or one job that processes all of them. For "synergistic orchestration" (Phase 2), a single job that receives multiple strategy IDs and merges calendars makes sense.

**Open point:** Confirm whether bundle should include only selected strategies or all user strategies. The current implementation suggests "all."

### 6. Audience context for generation

To generate 30 ideas, we need strategy context. Fetch from:

- **audiences:** `target_segment`, `customer_problem`, `business_value`, `conversion_path`
- **seo_keywords:** `SELECT keyword, search_volume, competition FROM seo_keywords WHERE audience_id = $1`
- **organizations / organization_intelligence:** Join via `audiences.organization_intelligence_id` → `organization_intelligence.organization_id` for `business_type`, `target_audience`, `content_focus`, `brand_voice`

The existing `generateTrendingTopics` uses `businessType`, `targetAudience`, `contentFocus`. We have equivalent data via audience + org intel.

### 7. Topic generation — different from funnel topics

Current topic generation (`services/openai.js` → `generateTrendingTopics` / `generateTrendingTopicsStream`):

- Produces **2** topics for the funnel's "pick one to write" step
- Uses `businessType`, `targetAudience`, `contentFocus`
- Returns `{ id, trend, title, subheader, seoBenefit, category }` plus DALL·E image

The 30-day calendar needs:

- **30** unique ideas
- Same context (audience + org)
- Shape compatible with calendar: e.g. `{ dayNumber, title, searchIntent?, format?, keywords? }`
- No images per idea for MVP (per issue: "Titles only" for Phase 1)

**Recommendation:** Add `generateContentCalendarIdeas(audience, orgContext)` in `openai.js`. Use a dedicated prompt for 30 diverse ideas. Consider 2 calls of 15 ideas if token limits are tight, or one call with ~4000 max_tokens.

### 8. Model choice

Issue specifies `gpt-4o` for quality. Our default is `OPENAI_MODEL` (often `gpt-4` or `gpt-3.5-turbo`). Add an env override for calendar generation, e.g. `OPENAI_CALENDAR_MODEL=gpt-4o`, and use it only for this flow to control cost.

### 9. Unified calendar API — aggregation pattern

Issue proposes `GET /api/v1/users/:userId/content-calendar`. We already have:

- `strategy_purchases` with `user_id`, `strategy_id`, `status = 'active'`
- `audiences` with `content_ideas` (after migration)

**Query pattern:**
```sql
SELECT a.id, a.target_segment, a.customer_problem, a.content_ideas, sp.created_at as subscribed_at
FROM strategy_purchases sp
JOIN audiences a ON a.id = sp.strategy_id
WHERE sp.user_id = $1 AND sp.status = 'active'
ORDER BY sp.created_at DESC
```

Backend merges `content_ideas` arrays from each strategy into a unified 30-day view, applying conflict resolution (Phase 2). For Phase 1 MVP, single-strategy calendar can return `content_ideas` directly.

### 10. Performance and reliability

- **&lt; 15 seconds for 30 ideas:** A single OpenAI call may work; if not, batch (e.g. 15+15) and merge. Avoid blocking the webhook.
- **Retries:** BullMQ supports retries. Use `attempts: 3` in job options.
- **Graceful degradation:** If generation fails, leave `content_ideas` null; frontend shows "Calendar generating..." or "Retry." Do not fail the webhook.
- **Stripe idempotency:** Ensure we don't create duplicate `strategy_purchases` or duplicate calendar jobs if Stripe retries the webhook. Use `session.id` or `subscription.id` as idempotency key when enqueueing.

### 11. Email notification

We have `services/email.js`. After successful calendar generation, send a transactional email (e.g. "Your 30-day content calendar is ready"). Add a template or reuse an existing pattern. Document in `docs/` if we add new email types.

### 12. Implementation order (revised for our stack)

**Phase 1 MVP:**
1. Migration: add `content_ideas` JSONB to `audiences`
2. Add `content_calendar` job type and worker handler
3. In `handleIndividualStrategySubscriptionCreated` (and after bundle's loop): enqueue `content_calendar` job
4. Implement `generateContentCalendarIdeas` in openai.js
5. Worker: run generation, `UPDATE audiences SET content_ideas = $1 WHERE id = $2`
6. Endpoint: `GET /api/v1/audiences/:id` (or strategy route) — include `content_ideas` in response so StrategyDetailsView can show it
7. Optional: "Calendar ready" email

**Phase 2:** Unified calendar endpoint, conflict resolution, multi-strategy merge

**Phase 3+:** User controls, export, performance prediction

### 13. Related code references

| Area | File(s) |
|------|---------|
| Webhook entry | `routes/stripe.js` → `handleCheckoutCompleted` |
| Strategy webhooks | `services/strategy-subscription-webhooks.js` |
| Job queue | `services/job-queue.js`, `jobs/job-worker.js` |
| Audiences table | `database/11_audience_persistence_tables.sql`, migrations |
| Topic generation (reference) | `services/openai.js` → `generateTrendingTopics` |
| Strategy = audience | `routes/strategies.js` line 54, `strategy_purchases.strategy_id` FK |
| Email service | `services/email.js` |

### 14. Dependency on Issue #269

Issue #269 (Trending Integration) will provide trending data. For Phase 1, we can ship without it. When #269 lands, we can:
- Inject trending context into `generateContentCalendarIdeas` prompt
- Or call a trending service and merge into the 30 ideas

Keep Phase 1 decoupled so we can ship the calendar quickly.

---

*End of comment*
