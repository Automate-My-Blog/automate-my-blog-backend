# Vercel: Only Build Main (Skip PR / Branch Builds)

We only deploy from `main`. `vercel.json` has `deploymentEnabled: { "main": true, "*": false }`, but Vercel can still **run a build** for PRs and post a GitHub check. If that build fails or is skipped, the check shows "Vercel — Deployment has failed" and blocks the PR.

**Fix:** Use Vercel’s **Ignore Build Step** so non-main branches (and PRs) don’t run a build at all. Then the Vercel check won’t run or will show as skipped.

## Setup (one-time)

1. Open [Vercel Dashboard](https://vercel.com) → your project.
2. **Settings** → **Git**.
3. Under **Build & Development Settings**, find **Ignore Build Step**.
4. Set the command to:
   ```bash
   bash scripts/vercel-ignore-build.sh
   ```
   (Or use the inline form: `[ "$VERCEL_GIT_COMMIT_REF" = "main" ]` — that exits 0 for non-main so the build is skipped.)

5. Save. New PRs and non-main pushes will skip the build; only `main` will build and deploy.

## Script

`scripts/vercel-ignore-build.sh` exits **0** (skip build) for any ref that isn’t `main`, and **1** (run build) for `main`. Vercel runs this from the repo root.

## If you can’t change the dashboard

- In **GitHub** → repo **Settings** → **Branches** → branch protection for `main` → **Require status checks** → **uncheck** the "Vercel" check. Then PRs can merge without that check (other CI still runs).
