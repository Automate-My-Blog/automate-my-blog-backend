# Recent updates: what was added and why guardrails matter

This doc summarizes what Sam added recently (CI, deployment, and docs) and why having these guardrails in place is important.

---

## Why guardrails matter

Without guardrails, broken code and config can land in main and only show up in production. Migrations with syntax errors, a server that no longer starts, or a PR blocked by a failing Vercel check that we don’t even want to run—all of that wastes time and blocks shipping.

Guardrails catch problems before merge. They don’t replace code review or testing; they add a safety net so we don’t merge things that are obviously broken. The goal is: fewer surprises in production, fewer “it worked on my machine” issues, and PRs that only fail when something actually needs fixing.

---

## What was added

### 1. Migration validation (CI)

**What**  
When a PR changes any file under `database/`, CI spins up a test Postgres instance and runs all migrations in order (`database/*.sql` and `database/migrations/*.sql`). If any SQL has a syntax error or fails to apply, the run fails and the PR is blocked.

**Why it matters**  
Broken migrations are painful to fix in production. Catching bad SQL at PR time means we never merge a migration that doesn’t apply. One workflow run can save hours of debugging later.

Details: [GitHub Actions Quick Wins](./github-actions-quick-wins.md) (Migration Validation).

---

### 2. Smoke test (CI)

**What**  
On every push and PR, CI starts the server (with a test DB) and calls `GET /health`. If the server doesn’t start or health returns an error, the run fails.

**Why it matters**  
Sometimes a change breaks server startup or the health endpoint. Without this, we might not notice until after merge. The smoke test is a cheap way to catch “the server won’t even start” before it hits main.

Details: [GitHub Actions Quick Wins](./github-actions-quick-wins.md) (API Endpoint Smoke Tests).

---

### 3. Vercel: only build production

**What**  
We only want Vercel to build and deploy when we push to `main`. PRs and other branches should not trigger a Vercel build. In the Vercel project, **Ignore Build Step** is set to an inline command so only production builds run. PRs and branches skip the build, so the Vercel check no longer blocks merge.

**Why it matters**  
We were seeing “Vercel — Deployment has failed” on PRs even though we don’t deploy from branches. That blocked merges for no good reason. Configuring the ignore step so only production builds run keeps PRs unblocked and matches how we actually deploy.

Details: [Vercel: Only Build Production](./vercel-preview-builds.md).

---

### 4. Documentation updates

**What**  
- **README** – CI/CD section updated to list migration validation and smoke test, plus links to the quick-wins doc, Vercel doc, and this doc.  
- **Vercel doc** – Rewritten to focus on the inline Ignore Build Step command and simple copy-paste setup.  
- **This doc** – Central place for “what was added and why guardrails matter.”

**Why it matters**  
If only one person knows how the guardrails work, they become fragile. Written docs let anyone check how migration validation, smoke test, and Vercel are set up, and why we have them. New contributors (or future us) can get up to speed without digging through history.

---

## Quick reference

| Addition            | Where it lives                          | When it runs / what it does                    |
|---------------------|-----------------------------------------|-----------------------------------------------|
| Migration validation| `.github/workflows/migration-validation.yml` | When `database/**/*.sql` changes; runs all migrations. |
| Smoke test          | `.github/workflows/smoke-test.yml`      | Every push/PR; starts server, hits `/health`. |
| Vercel ignore step  | Vercel Dashboard → Git → Ignore Build Step | Only production builds; PRs/branches skip.     |
| Quick wins / CI list| [github-actions-quick-wins.md](./github-actions-quick-wins.md) | Full list of workflows and how they work.      |
| Vercel setup        | [vercel-preview-builds.md](./vercel-preview-builds.md) | Copy-paste command and one-time setup.         |
