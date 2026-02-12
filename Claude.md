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

## Git Workflow: Surgical Branching

**Core Principle:** Each feature branch should contain 1-2 focused changes, then be immediately merged to staging and closed.

### Standard Development Flow

1. **Start from staging:**
   ```bash
   git checkout staging
   git pull origin staging
   ```

2. **Create focused feature branch:**
   ```bash
   git checkout -b feature/descriptive-name
   # OR for bugs:
   git checkout -b fix/descriptive-name
   ```

3. **Make 1-2 focused changes:**
   - Keep the scope minimal and well-defined
   - One logical feature or fix per branch
   - Avoid scope creep

4. **Commit with detailed message:**
   ```bash
   git add <relevant-files-only>
   git commit -m "feat: descriptive summary

   ## Changes
   - Specific change 1
   - Specific change 2

   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
   ```

5. **Push and merge to staging:**
   ```bash
   git push -u origin feature/descriptive-name
   git checkout staging
   git merge feature/descriptive-name
   git push origin staging
   ```

6. **Delete feature branch (optional, keeps it clean):**
   ```bash
   git branch -d feature/descriptive-name
   ```

### Exception: Large Net-New Features

**Only for plan mode implementations that involve:**
- Multiple new files/services
- Cross-cutting architectural changes
- Features requiring 10+ file changes

For these cases:
1. Create long-lived feature branch from staging
2. Work incrementally with multiple commits
3. When ready, create PR to staging for review
4. Merge when approved

**When in doubt:** Ask before assuming you should work on a long-lived branch. Default to surgical 1-2 change branches.

### Key Rules

- ❌ **NO direct commits to staging** without a feature branch
- ❌ **NO bundling multiple unrelated changes** in one branch
- ❌ **NO long-lived branches** for small changes
- ✅ **DO create focused branches** for each logical change
- ✅ **DO merge to staging quickly** to avoid conflicts
- ✅ **DO keep branches up to date** with staging before merging
