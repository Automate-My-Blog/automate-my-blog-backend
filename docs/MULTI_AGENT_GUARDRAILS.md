# Multi-Agent Workflow Guardrails

This document defines guardrails to ensure multiple AI coding agents can work on this project simultaneously without conflicts.

## 1. Issue Assignment Protocol

**CRITICAL: Always assign yourself to an issue before starting work**

- Comment on the issue: "Working on this" or "Claiming this issue"
- If an issue is already claimed, pick a different one
- Check issue comments before starting to avoid duplicate work

**Why:** Prevents multiple agents from working on the same issue simultaneously.

## 2. Branch Naming Convention

**Required format:** `{type}/{issue-number}-{short-description}`

Examples:
- `fix/123-add-retry-logic`
- `feat/456-analytics-middleware`
- `refactor/789-optimize-prompts`

**Why:** Makes it easy to identify which issue a branch addresses and prevents naming conflicts.

## 3. File Scope Boundaries

**Before starting, identify which files you'll modify:**

- **Database migrations:** Only ONE agent should work on migrations at a time
- **API routes:** Check if route already exists or is being modified
- **Services:** Large services (like `enhanced-blog-generation.js`) - coordinate if multiple changes needed
- **Shared utilities:** Be extra careful - changes affect everyone

**Action:** Comment on issue listing files you'll touch. Check for other PRs modifying same files.

## 4. Database Migration Coordination

**CRITICAL: Database migrations require coordination**

- **Check for open migration PRs** before creating new migrations
- **Never modify existing migration files** - create new ones
- **Test migrations locally** before opening PR
- **Migration naming:** `{number}_{description}.sql` (e.g., `26_add_email_preferences.sql`)

**Conflict Prevention:**
- If you see a migration PR open, wait for it to merge or coordinate
- Use sequential migration numbers (check latest in `database/` folder)

## 5. API Contract Stability

**Don't break existing API contracts:**

- **Adding endpoints:** Safe ✅
- **Modifying request/response:** Check if frontend depends on it ❌
- **Removing endpoints:** Coordinate first ❌
- **Changing error codes:** Check existing tests ❌

**Action:** If modifying existing endpoints, check `routes/` for usage and add tests.

## 6. Dependency Management

**Before adding new dependencies:**

- Check if dependency already exists in `package.json`
- Use existing dependencies when possible
- For new dependencies: add to issue description for review
- **Never remove dependencies** without checking usage across codebase

**Why:** Prevents version conflicts and dependency bloat.

## 7. Testing Requirements

**All PRs must include tests:**

- **New features:** Add unit tests
- **API endpoints:** Add integration tests
- **Database changes:** Add migration tests
- **Bug fixes:** Add regression tests

**Test file naming:** `{feature}.test.js` or `{feature}.spec.js`

**Why:** Prevents regressions when multiple agents work simultaneously.

## 8. Code Review Checkpoints

**Before marking PR as ready:**

- [ ] All tests pass locally
- [ ] No console.log statements (use proper logging)
- [ ] No hardcoded secrets or API keys
- [ ] Environment variables documented in `.env.example`
- [ ] PR description includes `Closes #<issue-number>`
- [ ] Files modified match issue scope

**Why:** Automated checks catch issues before human review.

## 9. Conflict Resolution

**If you encounter merge conflicts:**

1. **Don't force push** - coordinate with other agents
2. **Rebase on latest main:** `git pull origin main --rebase`
3. **Resolve conflicts carefully** - don't delete others' work
4. **Test after resolving** - ensure everything still works
5. **Ask for help** if conflicts are complex

**Why:** Prevents losing work and breaking the codebase.

## 10. Work Area Separation

**Recommended work areas per agent:**

- **Agent 1:** Analytics & tracking (middleware, events, dashboard)
- **Agent 2:** Email system (SendGrid, templates, preferences)
- **Agent 3:** Recommendations engine (service, API, prioritization)
- **Agent 4:** Testing infrastructure (Jest setup, test suites)
- **Agent 5:** CI/CD workflows (GitHub Actions, automation)
- **Agent 6:** Reliability improvements (retry logic, logging, error tracking)

**Why:** Natural separation reduces conflicts and allows parallel work.

## 11. Communication Protocol

**Use GitHub Issues for coordination:**

- **Before starting:** Comment on issue with your plan
- **During work:** Update issue with progress/questions
- **Blockers:** Comment immediately - don't wait
- **Completion:** Link PR in issue comments

**Why:** Keeps everyone informed and prevents duplicate effort.

## 12. Critical Path Protection

**These areas require extra caution:**

- **Authentication (`services/auth-database.js`):** Only one agent at a time
- **Database schema:** Coordinate migrations
- **Billing (`routes/stripe.js`):** Test thoroughly, coordinate changes
- **Content generation (`services/enhanced-blog-generation.js`):** Large file - coordinate modifications

**Action:** Comment on issue if touching critical paths - wait for acknowledgment.

## 13. PR Size Limits

**Keep PRs focused and small:**

- **Ideal:** 1 issue = 1 PR
- **Maximum:** 500 lines changed (GitHub Actions will warn)
- **If larger:** Split into multiple PRs with clear dependencies

**Why:** Smaller PRs are easier to review and less likely to conflict.

## 14. Automated Checks

**All PRs must pass:**

- ✅ Linting/formatting checks
- ✅ Type checking (if TypeScript)
- ✅ Test suite (when implemented)
- ✅ Security scanning
- ✅ Migration validation (if database changes)

**Why:** Catches issues automatically before merge.

## 15. Rollback Safety

**Before making breaking changes:**

- Ensure changes are reversible
- Document rollback procedure in PR
- Test rollback locally if possible
- For database: include rollback migration

**Why:** Allows safe recovery if issues arise.

## Quick Reference Checklist

Before starting work:
- [ ] Issue not already claimed
- [ ] Commented on issue with plan
- [ ] Checked for open PRs modifying same files
- [ ] Identified all files you'll modify
- [ ] For migrations: checked latest migration number

During work:
- [ ] Following branch naming convention
- [ ] Writing tests as you go
- [ ] No console.log or hardcoded secrets
- [ ] Updating issue with progress

Before opening PR:
- [ ] All tests pass
- [ ] PR includes `Closes #<issue-number>`
- [ ] Files match issue scope
- [ ] No conflicts with main branch
- [ ] PR description explains changes

## Emergency Procedures

**If you break something:**

1. **Don't panic** - create a fix PR immediately
2. **Comment on original PR** explaining the issue
3. **If critical:** Revert the PR and create new fix
4. **Document** what went wrong for future reference

**If you see someone else's code break:**

1. **Comment on their PR** with helpful feedback
2. **Offer to help** if you can fix it quickly
3. **Don't merge** broken code - wait for fixes

---

**Remember:** The goal is parallel productivity, not parallel conflicts. When in doubt, communicate!
