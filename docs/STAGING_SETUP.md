# Staging Environment Setup

This guide explains how to run a **staging** environment for the backend so you can test changes against real integrations (DB, Redis, Stripe test mode) without touching production.

## Goals

- **Staging** = same code as production (or a branch you choose), but with:
  - A **separate Postgres database** (e.g. Neon branch or second project)
  - A **separate Redis** (e.g. second Upstash DB or separate instance)
  - **Stripe test keys** and a webhook pointing at the staging URL
  - Its own **Vercel deployment** and URL (e.g. `https://automate-my-blog-backend-staging.vercel.app`)

CORS already allows any `*.vercel.app` origin, so your staging frontend (e.g. a Vercel preview or a staging frontend project) can call the staging backend without code changes.

---

## Single project + staging branch (current setup)

If staging is a **Vercel Environment** in the same project, building from the `staging` branch:

- **vercel.json** has `deploymentEnabled` for both `main` and `staging`, so Vercel will build and deploy when either branch is pushed.
- **GitHub Actions** run for the `staging` branch the same as for `main`:
  - **Code Quality**, **Env Var Validation**, **Security Scan**, **Smoke Test**, **Test**: on push and PRs targeting `main` or `staging`.
  - **Migration Validation**: on push to `main` or `staging` when `database/**` changes, and on merge_group for both branches.
- **Ignore Build Step** (Vercel Dashboard → Settings → Git): if you use it, it must allow the staging branch to build. For example, to build only for `main` and `staging` (and skip other branches/PRs):

  ```bash
  if [ "$VERCEL_GIT_COMMIT_REF" == "main" ] || [ "$VERCEL_GIT_COMMIT_REF" == "staging" ]; then exit 1; else exit 0; fi
  ```

  (Exit 1 = run build; exit 0 = skip.)

---

## Option A: Second Vercel Project (Recommended)

Use a **separate Vercel project** for staging. Same repo; staging gets its own URL and env vars.

### 1. Create the staging project in Vercel

1. In [Vercel Dashboard](https://vercel.com), click **Add New** → **Project**.
2. **Import** the same Git repository as production.
3. Set **Project Name** to something like `automate-my-blog-backend-staging`.
4. **Framework Preset**: Other (or same as prod).
5. **Root Directory**: same as production (e.g. leave default).
6. **Build & Development**:
   - Build Command: same as production (or leave default).
   - Output Directory: same as production.
7. Under **Git**:
   - **Production Branch**: choose either:
     - `main` – staging always deploys latest main (good for “staging = pre-production”).
     - `staging` – only deploy when you push to `staging` (good for gating what hits staging).

### 2. Staging environment variables

In the **staging** Vercel project: **Settings → Environment Variables**.

Add the same variables as production, but with **staging** values:

| Variable | Staging value |
|----------|----------------|
| `NODE_ENV` | `production` (so the app runs in “production-like” mode; optional: you could use a custom value like `staging` if you add code for it) |
| `DATABASE_URL` | Staging Postgres URL (see below) |
| `REDIS_URL` | Staging Redis URL (see below) |
| `JWT_SECRET` | A **different** secret from production (staging-only) |
| `JWT_REFRESH_SECRET` | A **different** refresh secret from production |
| `STRIPE_SECRET_KEY` | Stripe **test** key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook secret for the **staging** webhook endpoint (see below) |
| `OPENAI_API_KEY` | Same or a separate key; consider a separate key if you want to cap/isolate staging usage |
| `SUPER_ADMIN_EMAILS` | Optional; comma-separated emails for staging super admins |
| `CORS_ORIGINS` | Optional; add staging frontend URL if not already covered by `*.vercel.app` |
| Other keys | `YOUTUBE_API_KEY`, `NEWS_API_KEY`, etc. – same as prod or test values as needed |

Apply to **Production** (and **Preview** if you want preview deployments in this project to use staging resources).

### 3. Staging database (Postgres)

- **Neon**: Create a **new branch** (e.g. `staging`) or a separate **project** and use its connection string as `DATABASE_URL` for staging. Run the same migrations as production (e.g. all scripts in `database/` and `database/migrations/` in order).
- **Other providers**: Create a dedicated staging database and run migrations the same way.

Do **not** point staging at the production database.

### 4. Staging Redis

- **Upstash**: Create a second Redis database (e.g. “staging”) and use its URL as `REDIS_URL` for the staging Vercel project.
- If you run the **job worker** (e.g. on Render) for staging, point that worker’s `REDIS_URL` and `DATABASE_URL` at the same staging Redis and staging Postgres.

### 5. Stripe (test mode + webhook)

1. In [Stripe Dashboard](https://dashboard.stripe.com), use **Test mode** (toggle in the sidebar).
2. Get **Developers → API keys** → **Secret key** (`sk_test_...`) and set as `STRIPE_SECRET_KEY` in staging.
3. **Developers → Webhooks** → **Add endpoint**:
   - URL: `https://automate-my-blog-backend-staging.vercel.app/api/v1/stripe/webhook` (or your actual staging backend URL).
   - Select the same events as production.
4. Use the new webhook’s **Signing secret** (`whsec_...`) as `STRIPE_WEBHOOK_SECRET` in the staging Vercel project.

### 6. Ignore Build Step (optional)

If you want the staging project to **only** build when the production branch is updated (e.g. when `main` is pushed), you can set **Ignore Build Step** in the **staging** project to the same logic as production, e.g.:

```bash
if [ "$VERCEL_ENV" == "production" ]; then exit 1; else exit 0; fi
```

That way only “production” builds in the staging project run (e.g. pushes to `main`); PR previews in that project can be skipped. Adjust if you use a `staging` branch as the production branch of the staging project.

### 7. Cron and worker

- The **staging** Vercel project has its own **Cron** (e.g. `api/cron/process-narrative-jobs`). It will hit the **staging** deployment URL and use staging env (staging DB/Redis). No change needed in code.
- If you run a **BullMQ worker** (e.g. `node jobs/job-worker.js`) for production, run a **separate** worker for staging (e.g. second Render service or second process) with staging `DATABASE_URL` and `REDIS_URL`.

---

## Option B: Single Vercel Project, Staging Branch

Keep one Vercel project and use a **staging** branch that deploys to a preview URL with staging env vars.

### 1. Enable deployments for the staging branch

In `vercel.json`, allow the `staging` branch to deploy:

```json
"git": {
  "deploymentEnabled": {
    "main": true,
    "staging": true,
    "*": false
  }
}
```

### 2. Ignore Build Step

Update **Ignore Build Step** in Vercel so builds run for **both** `main` and `staging`:

```bash
if [ "$VERCEL_GIT_COMMIT_REF" == "main" ] || [ "$VERCEL_GIT_COMMIT_REF" == "staging" ]; then exit 1; else exit 0; fi
```

(Exit 1 = run build; exit 0 = skip.)

### 3. Branch-specific env vars

In Vercel: **Settings → Environment Variables**. For each staging-only value (e.g. `DATABASE_URL`, `REDIS_URL`, `STRIPE_*`):

- Add the variable.
- Under **Environments**, select **Preview**.
- Under **Branch**, choose **staging** (or “Only specific branches” and add `staging`).

Production (main) keeps using the existing Production env vars; previews from `staging` use the branch-specific vars.

### 4. Staging URL

Each deployment from `staging` gets a URL like:

`https://automate-my-blog-backend-git-staging-<team>.vercel.app`

You can alias it in Vercel (e.g. assign a stable alias to the latest `staging` deployment) so the frontend and Stripe webhook can use a fixed URL.

### 5. Database, Redis, Stripe

Same as Option A: separate staging Postgres, staging Redis, Stripe test keys and a webhook pointing at the staging deployment URL.

---

## Checklist

- [ ] Staging Postgres created; migrations applied.
- [ ] Staging Redis created (e.g. second Upstash DB).
- [ ] Second Vercel project created (Option A) or `staging` branch enabled (Option B).
- [ ] All required env vars set in staging (different `JWT_*`, Stripe test keys, staging `DATABASE_URL`, `REDIS_URL`, etc.).
- [ ] Stripe webhook added for staging URL; `STRIPE_WEBHOOK_SECRET` set in staging.
- [ ] If you use a job worker: separate staging worker with staging `DATABASE_URL` and `REDIS_URL`.
- [ ] Optional: add staging frontend origin to `CORS_ORIGINS` if not using `*.vercel.app`.
- [ ] Smoke test: open `https://<staging-url>/health` and run a quick login/API test.

---

## Optional: Treat “staging” in code

The app currently branches on `NODE_ENV === 'development'` vs production (e.g. mock users, error details). If you want staging to behave like “production but with a few dev conveniences” (e.g. allow a mock user for E2E):

1. Set `NODE_ENV=staging` in the staging Vercel env (optional; you can also keep `NODE_ENV=production` and rely only on env vars).
2. In code, where you have `process.env.NODE_ENV !== 'production'`, add `|| process.env.NODE_ENV === 'staging'` if you want that behavior in staging.

Only do this if you need it; many teams run staging with `NODE_ENV=production` and rely on separate DB/Redis/Stripe to isolate it.

---

## Summary

- **Recommended**: Second Vercel project “staging” with its own `DATABASE_URL`, `REDIS_URL`, Stripe test keys, and webhook. Deploy from `main` or `staging` branch.
- **Alternative**: Single project with a `staging` branch, branch-specific env vars, and a stable preview URL/alias.
- Always use **separate** Postgres, Redis, and Stripe (test) for staging so production data and billing are never touched.
