# Staging Environment Setup

This guide describes the **staging** setup for the backend: **multiple environments in the same Vercel project**. Staging builds from the `staging` branch and uses its own database, Redis, and Stripe test mode so you can test without touching production.

## Goals

- **Staging** = same project as production, different branch and env:
  - A **separate Postgres database** (e.g. Neon branch or second project)
  - A **separate Redis** (e.g. second Upstash DB)
  - **Stripe test keys** and a webhook pointing at the staging URL
  - Deployments from the **staging** branch with a distinct Vercel URL (e.g. `https://automate-my-blog-backend-git-staging-<team>.vercel.app`)

CORS already allows any `*.vercel.app` origin, so your staging frontend can call the staging backend without code changes.

---

## 1. Same project: enable staging branch

### vercel.json

The repo has `deploymentEnabled` for both `main` and `staging`:

```json
"git": {
  "deploymentEnabled": {
    "main": true,
    "staging": true,
    "*": false
  }
}
```

Vercel will build and deploy when either branch is pushed.

### Ignore Build Step

In **Vercel Dashboard** → your project → **Settings** → **Git** → **Ignore Build Step**, set either:

- **Script (recommended):** `bash scripts/vercel-ignore-build.sh`
- **Inline:** `if [ "$VERCEL_GIT_COMMIT_REF" == "main" ] || [ "$VERCEL_GIT_COMMIT_REF" == "staging" ]; then exit 1; else exit 0; fi`

(Exit 1 = run build; exit 0 = skip.)

**Required:** In **Settings** → **Environment Variables**, enable **Automatically Expose System Environment Variables** so `VERCEL_GIT_COMMIT_REF` is available. Branch builds are triggered by Vercel’s Git integration, not by GitHub Actions.

### GitHub Actions

Workflows run for the `staging` branch the same as for `main`:

- **Code Quality**, **Env Var Validation**, **Security Scan**, **Smoke Test**, **Test**: on push and PRs targeting `main` or `staging`.
- **Migration Validation**: on push to `main` or `staging` when `database/**` changes, and on merge_group for both branches.

---

## 2. Staging environment variables

In **Vercel** → your project → **Settings** → **Environment Variables**, configure staging by **environment** and **branch**:

- For each staging-only value, add the variable and:
  - **Environments**: choose **Preview** (or the specific environment that corresponds to staging in your project).
  - **Branch**: **staging** (or “Only specific branches” and add `staging`).

Production (`main`) keeps using the existing **Production** env vars; deployments from `staging` use these Preview/branch-specific vars.

| Variable | Staging value |
|----------|----------------|
| `NODE_ENV` | `production` (or `staging` if you add code for it) |
| `DATABASE_URL` | Staging Postgres URL (see below) |
| `REDIS_URL` | Staging Redis URL (see below) |
| `JWT_SECRET` | A **different** secret from production |
| `JWT_REFRESH_SECRET` | A **different** refresh secret from production |
| `STRIPE_SECRET_KEY` | Stripe **test** key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook secret for the **staging** webhook (see below) |
| `OPENAI_API_KEY` | Same or separate key for staging |
| `SUPER_ADMIN_EMAILS` | Optional; staging super admins |
| `CORS_ORIGINS` | Optional; add staging frontend URL if not covered by `*.vercel.app` |
| Others | `YOUTUBE_API_KEY`, `NEWS_API_KEY`, etc. as needed |

---

## 3. Staging database (Postgres)

- **Neon**: Create a **new branch** (e.g. `staging`) or a separate **project** and use its connection string as `DATABASE_URL` for the staging environment in Vercel. Run the same migrations as production (all scripts in `database/` and `database/migrations/` in order).
- **Other providers**: Create a dedicated staging database and run migrations the same way.

Do **not** point staging at the production database.

---

## 4. Staging Redis

- **Upstash**: Create a second Redis database (e.g. “staging”) and set its URL as `REDIS_URL` for the staging environment in Vercel.
- If you run a **BullMQ worker** (e.g. on Render) for staging, point that worker’s `REDIS_URL` and `DATABASE_URL` at the same staging Redis and staging Postgres.

---

## 5. Stripe (test mode + webhook)

1. In [Stripe Dashboard](https://dashboard.stripe.com), use **Test mode** (toggle in the sidebar).
2. **Developers → API keys** → copy **Secret key** (`sk_test_...`) and set as `STRIPE_SECRET_KEY` for staging in Vercel.
3. **Developers → Webhooks** → **Add endpoint**:
   - URL: your staging backend URL, e.g. `https://automate-my-blog-backend-git-staging-<team>.vercel.app/api/v1/stripe/webhook` (or your stable staging alias).
   - Select the same events as production.
4. Use the new webhook’s **Signing secret** (`whsec_...`) as `STRIPE_WEBHOOK_SECRET` for the staging environment in Vercel.

---

## 6. Staging URL and alias

Each deployment from `staging` gets a URL like:

`https://automate-my-blog-backend-git-staging-<team>.vercel.app`

In **Vercel** you can assign a **stable alias** to the latest `staging` deployment so the frontend and Stripe webhook always use the same URL.

---

## 7. Cron and worker

- The same Vercel project’s **Cron** (e.g. `api/cron/process-narrative-jobs`) runs per deployment. The deployment built from `staging` uses staging env (staging DB/Redis). No code change needed.
- If you run a **BullMQ worker** for production, run a **separate** worker for staging (e.g. second Render service) with staging `DATABASE_URL` and `REDIS_URL`.

---

## Checklist

- [ ] `vercel.json` has `staging` in `deploymentEnabled` (already in repo).
- [ ] Ignore Build Step in Vercel allows `main` and `staging` (see above).
- [ ] Staging Postgres created; migrations applied.
- [ ] Staging Redis created (e.g. second Upstash DB).
- [ ] Staging env vars set in Vercel (Preview + branch `staging`): different `JWT_*`, Stripe test keys, staging `DATABASE_URL`, `REDIS_URL`, etc.
- [ ] Stripe webhook added for staging URL; `STRIPE_WEBHOOK_SECRET` set for staging.
- [ ] Optional: stable alias for staging URL in Vercel.
- [ ] If you use a job worker: separate staging worker with staging `DATABASE_URL` and `REDIS_URL`.
- [ ] Optional: add staging frontend origin to `CORS_ORIGINS` if not using `*.vercel.app`.
- [ ] Smoke test: open `https://<staging-url>/health` and run a quick login/API test.

---

## Optional: Treat “staging” in code

The app branches on `NODE_ENV === 'development'` vs production (e.g. mock users, error details). If you want staging to behave like “production but with dev conveniences” (e.g. allow a mock user for E2E):

1. Set `NODE_ENV=staging` in the staging env in Vercel (optional).
2. In code, where you have `process.env.NODE_ENV !== 'production'`, add `|| process.env.NODE_ENV === 'staging'` if you want that behavior in staging.

Many teams run staging with `NODE_ENV=production` and rely on separate DB/Redis/Stripe to isolate it.

---

## Alternative: Separate Vercel project

If you prefer a **second Vercel project** for staging (separate URL and project settings):

1. In [Vercel Dashboard](https://vercel.com), **Add New** → **Project** and import the same repo.
2. Set **Production Branch** to `staging` (or `main` if you want staging to always track main).
3. In that project, **Settings** → **Environment Variables**: add all env vars with staging values (staging `DATABASE_URL`, `REDIS_URL`, Stripe test keys, different `JWT_*`, etc.).
4. Use the same staging Postgres, Redis, and Stripe test webhook as above. Do not point this project at production DB/Redis.

The rest (migrations, worker, cron) is the same idea: staging uses its own DB and Redis everywhere.

---

## Summary

- **This setup**: One Vercel project, **multiple environments**. The `staging` branch deploys with Preview/branch-specific env vars; production uses `main` and Production env vars.
- **Infrastructure**: Always use **separate** Postgres, Redis, and Stripe (test) for staging so production data and billing are never touched.
