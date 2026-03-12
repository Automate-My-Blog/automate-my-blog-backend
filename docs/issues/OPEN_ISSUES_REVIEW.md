# Open issues review – already or likely complete

Review date: 2026-03-07. Below are open issues that appear **already implemented** or **largely done** in the codebase. Verify on staging then close with a short comment if confirmed.

---

## Likely complete (good candidates to close)

### #279 – Add Google Trends API integration for predictive search intelligence  
**Status: Implemented**

- `services/google-trends.js` exists with `getRisingQueries`, `getRelatedTopics`, `getInterestOverTime`.
- Uses `google-trends-api`; caching in DB (`google_trends_cache`, 6h) instead of Redis.
- Routes: `/api/v1/google/trends/rising-queries`, `related-topics`, `interest-over-time`, `topics`, `refresh`, `preview`.
- Docs: `docs/status/GOOGLE_TRENDS_PRODUCTION_READINESS.md`, `docs/issues/issue-269-trending-integration-comment.md`.

**Suggestion:** Close as completed with a comment that caching uses DB (not Redis) and reference the above.

---

### #11 – Email: Install SendGrid and create email service  
**Status: Implemented**

- `@sendgrid/mail` in `package.json`; `services/email.js` has `EmailService` class and SendGrid integration.
- Generic `send(emailType, recipientEmail, context, userId)` plus concrete methods (e.g. `sendWelcomeEmail`, `sendEmailVerification`, `sendReferralInvitation`, admin alerts).
- Env: `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` (and related) in `.env.example`.
- Issue asked for `sendOnboardingEmail`, `sendDraftReadyEmail`, `sendWeeklySummary`; implementation uses `sendWelcomeEmail` and template-based `send()` for other flows.

**Suggestion:** Close as completed; note that naming differs slightly (e.g. welcome vs onboarding) and that additional triggers can be added via existing `send()`.

---

## Partially complete (Phase 1 / MVP done; rest is enhancement)

### #270 – Full 30-Day Content Calendar Generation on Strategy Purchase  
**Status: Phase 1 done**

- Content calendar on strategy purchase: job type, worker flow, `content_ideas` (and related) on audiences.
- Migrations: `039_content_calendar_audiences`, `040_jobs_add_content_calendar_type`, `045_content_calendar_trending_topics`, `046_content_calendar_posts`, `047_jobs_add_content_calendar_post_type`.
- Services: `content-calendar-service.js`, `contentCalendarScheduler.js`, strategy subscription webhooks.
- Phase 2–4 (unified multi-strategy view, conflict resolution, drag-and-drop, export, etc.) are not implemented.

**Suggestion:** Either close with “Phase 1 MVP complete; Phase 2+ tracked elsewhere” or add a comment listing what’s done vs open.

---

### #269 – Trending Integration: Real-time Content Idea Generation  
**Status: Partially done**

- Google Trends integration is in place (see #279); used for sample ideas, preview, and content calendar.
- X (Twitter) API and News API integration and “trend badges” / auto-regeneration are not implemented.

**Suggestion:** Close as “Google Trends portion complete” or leave open for X/News and remaining checklist items.

---

## Verify then possibly close

### #156 – ensure JSON is returned during analyze website  
**Status: Unclear**

- Issue body only references “workflowAPI.js line 144” (likely frontend).
- Backend: `POST /api/analyze-website` in `index.js` returns `res.json(...)` on success and on timeout (504).
- If the bug was “backend sometimes not returning JSON”, the current handler consistently returns JSON.

**Suggestion:** Confirm whether the problem was backend or frontend. If backend-only, close with “Backend returns JSON; frontend workflowAPI is in other repo.” If frontend, keep open or move to frontend repo.

---

### #309 – Organization business context not populated from website analysis  
**Status: Verify**

- `services/website-analysis-pipeline.js` builds `orgData` with `business_type`, `industry_category`, `business_model`, `target_audience` (e.g. lines 80–85) and updates/inserts `organizations` (e.g. 120–125, 148–153).
- `services/website-analysis-persistence.js` maps the same fields (76–81).
- If the main analysis path goes through this pipeline/persistence, org business context should be populated.

**Suggestion:** On staging, run a website analysis and check `organizations` for that org. If the row has non-null business fields, close #309 with a one-line confirmation. If still null, leave open and debug which path is used.

---

## Not complete (leave open)

- **#77 – Queue-Based Narrative Generation System:** Issue describes a BLOCKER (intelligence records not created). Narrative job queue and cron exist, but the described blocker may still apply; do not close without verifying end-to-end.
- **#58 – Outdated Dependencies:** Auto-generated; dependency set may have changed (e.g. after `npm audit fix`). Either update the issue body with a fresh `npm outdated` run or close and rely on a new dependency-check issue.
- **#262 – Daily digest:** Already **CLOSED** in GitHub; no action.

---

## Summary

| Issue | Recommendation |
|-------|----------------|
| #279  | Close (Google Trends implemented) |
| #11   | Close (SendGrid + email service implemented) |
| #270  | Close with “Phase 1 done” or add status comment |
| #269  | Close with “Trends portion done” or leave open for X/News |
| #156  | Verify backend vs frontend; close if backend-only |
| #309  | Verify org business fields on staging; close if populated |
| #77   | Leave open until blocker resolved |
| #58   | Update or close and re-create dependency check |
| #262  | Already closed |
