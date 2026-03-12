# Documentation index

Docs are grouped by purpose. Paths below are relative to this folder.

## [handoffs/](handoffs/)

Frontend/backend handoffs: API contracts, stream events, and implementation notes for the frontend team.

- **Auth & publishing:** `HTTPONLY_COOKIE_AUTH_FRONTEND_HANDOFF.md`, `PUBLISHING_OAUTH_FRONTEND_HANDOFF.md`, `THIRD_PARTY_PUBLISHING_FRONTEND_HANDOFF.md`, `direct-platform-publishing-frontend-handoff.md`, `google-oauth-per-client-frontend-handoff.md`, `strategy-routes-auth-frontend-handoff.md`
- **Content & streams:** `blog-content-stream-frontend-handoff.md`, `content-generation-stream-frontend-handoff.md`, `topics-stream-frontend-handoff.md`, `trending-topics-stream-frontend-handoff.md`, `narration-stream-frontend-handoff.md`, `website-analysis-*-frontend-handoff.md`, `sse-stream-auth-frontend-handoff.md`
- **Search & media:** `news-articles-search-stream-frontend-handoff.md`, `tweets-search-stream-frontend-handoff.md`, `youtube-videos-search-stream-frontend-handoff.md`
- **Content calendar:** `CONTENT_CALENDAR_*_HANDOFF.md`, `content-calendar-frontend-handoff.md`, `content-calendar-generation-progress-frontend-handoff.md`
- **Other:** `PHASE_3_FRONTEND_IMPLEMENTATION_GUIDE.md`, `FRONTEND_AGENT_HANDOFF_EMBED_STEPS.md`, `voice-adaptation-frontend-handoff.md`, `voice-profile-frontend-handoff.md`, `social-handles-frontend-handoff.md`, `onboarding-funnel-workflow-frontend-handoff.md`, `per-post-funnel-api-frontend-handoff.md`, `LOCAL_BACKEND_FRONTEND_HANDOFF.md`, `DASHBOARD_AUDIENCES_RECENT_ANALYSIS_HANDOFF.md`

## [setup/](setup/)

Environment, deployment, and ops.

- **Staging & env:** `STAGING_SETUP.md`, `MEDIUM_OAUTH_STAGING_SETUP.md`, `LOCAL_DEV_PERSISTENCE.md`
- **CORS & Vercel:** `CORS_BACKEND.md`, `CORS_BACKEND_CONFIG.md`, `VERCEL_STAGING_LOGS.md`, `vercel-preview-builds.md`, `STAGING_LOGS_AUTOMATION.md`
- **Redis:** `redis-setup.md`

## [reference/](reference/)

API contracts, contributing guide, testing, architecture, and inventories.

- **Contributing & testing:** `CONTRIBUTING.md`, `testing-strategy.md`, `testing.md`
- **API & architecture:** `API_RESPONSE_CONTRACTS.md`, `logic-map.md`, `database-schema.md`, `STRATEGY_ROUTES_ORDER.md`, `backend-queue-system.md`, `job-stream-sse.md`, `sse-streaming.md`
- **Inventories:** `PROMPTS-INVENTORY.md`, `SCRIPTS_INVENTORY.md`
- **Guardrails & agents:** `TECHNICAL_GUARDRAILS.md`, `MULTI_AGENT_GUARDRAILS.md`, `AGENT_QUICK_REFERENCE.md`
- **Admin & strategy:** `ADMIN_PANEL.md`, `SUPERADMIN_MANAGEMENT.md`, `STRATEGY_SUBSCRIPTION_TESTING.md`, `SESSION_SUMMARY_STRATEGY_SUBSCRIPTIONS.md`, `STRATEGY_PURCHASE_UNLOCK_VERIFICATION.md`
- **Other:** `backend-audit.md`, `executive-summary.md`, `frontend-job-queue-handoff.md`, `github-actions-quick-wins.md`, `LAYER_BOUNDARIES.md`, `ANALYTICS_EVENTS.md`, `CONTENT_CALENDAR_TESTING.md`, `GOOGLE_INTEGRATION_GAPS.md`, `voice-comparison-api.md`

## [issues/](issues/)

Issue-specific notes, investigations, and evaluations.

- `GOOGLE_OAUTH_CREDENTIALS_ISSUE_504.md`, `issue-504-backend-evaluation.md`, `STRATEGY_SUBSCRIBE_401_INVESTIGATION.md`
- `issue-261-backend-implementation.md`, `issue-269-trending-integration-comment.md`, `issue-270-content-calendar-comment.md`
- `OPEN_ISSUES_REVIEW.md`

## [proposals/](proposals/)

Proposals and design notes.

- `proposal-synthesize-related-media-in-blog-output.md`, `brand-voice-from-social-media-proposal.md`

## [status/](status/)

Backend status, reviews, and improvement notes.

- `PUBLISHING_BACKEND_STATUS.md`, `GOOGLE_INTEGRATIONS_REVIEW.md`, `GOOGLE_TRENDS_PRODUCTION_READINESS.md`, `RECENT_UPDATES.md`
- `DEAD_CODE_REDUCTION_NOTES.md`, `SPEED_IMPROVEMENTS.md`, `website-scraper-analysis-improvements.md`, `social-voice-development-status.md`
- `analytics-and-growth-plan.md`, `analytics-track-by-url-backend-implementation.md`

## [roadmap/](roadmap/)

Roadmap and planning.

- `api-endpoints-specification.md`, `audience-persistence-implementation.md`, `database-schema-changes.md`, `rollback-procedures.md`, `testing-checklist.md`

---

**Quick links (moved from root):**

| Old path | New path |
|----------|----------|
| `docs/STAGING_SETUP.md` | `docs/setup/STAGING_SETUP.md` |
| `docs/CONTRIBUTING.md` | `docs/reference/CONTRIBUTING.md` |
| `docs/GOOGLE_OAUTH_CREDENTIALS_ISSUE_504.md` | `docs/issues/GOOGLE_OAUTH_CREDENTIALS_ISSUE_504.md` |
| `docs/redis-setup.md` | `docs/setup/redis-setup.md` |
| `docs/testing-strategy.md` | `docs/reference/testing-strategy.md` |
| `docs/STRATEGY_ROUTES_ORDER.md` | `docs/reference/STRATEGY_ROUTES_ORDER.md` |
| `docs/API_RESPONSE_CONTRACTS.md` | `docs/reference/API_RESPONSE_CONTRACTS.md` |
| `docs/PUBLISHING_OAUTH_FRONTEND_HANDOFF.md` | `docs/handoffs/PUBLISHING_OAUTH_FRONTEND_HANDOFF.md` |
| `docs/MEDIUM_OAUTH_STAGING_SETUP.md` | `docs/setup/MEDIUM_OAUTH_STAGING_SETUP.md` |

Other handoffs and references now live under `handoffs/`, `reference/`, `setup/`, `issues/`, `proposals/`, or `status/` as above.
