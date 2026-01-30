# Vercel: Only Build Production

We only deploy from `main`. Vercel can still run a build for every PR and branch. When that build is skipped or fails, the PR shows "Vercel — Deployment has failed" and blocks merge.

Use the **Ignore Build Step** in Vercel so only production builds run. PRs and other branches skip the build.

## Setup (one-time)

1. Open [Vercel Dashboard](https://vercel.com) → your project.
2. Go to **Settings** → **Git**.
3. Under **Build & Development Settings**, find **Ignore Build Step**.
4. Paste this command:

   ```bash
   if [ "$VERCEL_ENV" == "production" ]; then exit 1; else exit 0; fi
   ```

   Exit 1 = build runs. Exit 0 = build is skipped. So only production builds run.

5. Save.

PRs and non-production branches will skip the build. Only production (e.g. pushes to `main`) will build and deploy.

## Alternative

If you can't change Vercel: in GitHub go to **Settings** → **Branches** → edit the rule for `main` → under **Require status checks**, uncheck **Vercel**. Then PRs can merge without that check.
