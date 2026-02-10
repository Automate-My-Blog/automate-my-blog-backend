# Project context for AI assistants

Backend API for the AutoBlog platform (Node/Express, deployed on Vercel). Key docs: `README.md`, `docs/` for handoffs and setup guides.

## Branches and deployments

- **main** → Production (Vercel Production environment).
- **staging** → Staging (same Vercel project, Preview/branch-specific env). Use for testing before merging to main.

## Staging environment (latest)

We use **multiple environments in the same Vercel project** (not a second project).

- **Branch**: Staging deploys from the **staging** branch. `vercel.json` has `deploymentEnabled` for both `main` and `staging`.
- **Vercel**: One project. Production env vars apply to `main`; staging uses **Preview** environment with **Branch** set to `staging` for staging-only vars (separate `DATABASE_URL`, `REDIS_URL`, Stripe test keys, different `JWT_*`, etc.).
- **Ignore Build Step** (Vercel → Settings → Git): Should allow only `main` and `staging` to build, e.g.  
  `if [ "$VERCEL_GIT_COMMIT_REF" == "main" ] || [ "$VERCEL_GIT_COMMIT_REF" == "staging" ]; then exit 1; else exit 0; fi`
- **CI**: GitHub Actions run for both `main` and `staging` (code-quality, env-var-validation, security-scan, smoke-test, test, migration-validation on relevant pushes/PRs).
- **Infrastructure**: Staging uses its own Postgres (e.g. Neon branch), its own Redis (e.g. second Upstash DB), and Stripe test mode with a webhook pointing at the staging URL. Never point staging at production DB/Redis.

Full checklist and details: **docs/STAGING_SETUP.md**.

## Stack

- Node 20+, Express, Postgres (Neon), Redis (Upstash), BullMQ job queue, Stripe, OpenAI, SendGrid. Cron and serverless on Vercel; optional worker (e.g. Render) for `jobs/job-worker.js`.
