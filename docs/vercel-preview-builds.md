# Vercel: Only Build main and staging

We only want Vercel to build **main** and **staging**. PRs and all other branches should **not** build (saves time and avoids "Vercel — Deployment has failed" blocking merges). Use **Ignore Build Step** in the Vercel project so only those two branches run a build.

## Setup (one-time)

1. Open [Vercel Dashboard](https://vercel.com) → your project.
2. Go to **Settings** → **Git**.
3. Under **Build & Development Settings**, find **Ignore Build Step**.
4. Set the command to use the script in this repo (recommended):

   ```bash
   bash scripts/vercel-ignore-build.sh
   ```

   That script builds only when `VERCEL_GIT_COMMIT_REF` is `main` or `staging`; all other branches and PRs skip (exit 0 = skip, exit 1 = build).

   **Inline alternative (same behavior):**
   ```bash
   if [ "$VERCEL_GIT_COMMIT_REF" == "main" ] || [ "$VERCEL_GIT_COMMIT_REF" == "staging" ]; then exit 1; else exit 0; fi
   ```

   **Only production (`main`) builds:**
   ```bash
   if [ "$VERCEL_ENV" == "production" ]; then exit 1; else exit 0; fi
   ```

5. Save.

Only **main** and **staging** will build and deploy. PRs and other branches will skip the build.

## Alternative

If you can't change Vercel: in GitHub go to **Settings** → **Branches** → edit the rule for `main` → under **Require status checks**, uncheck **Vercel**. Then PRs can merge without that check.
