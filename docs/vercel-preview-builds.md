# Vercel: Control Which Branches Build

We only want Vercel to build for specific branches (e.g. `main` and `staging`). When the build is skipped or fails for other branches/PRs, the PR can show "Vercel — Deployment has failed" and block merge, so we use **Ignore Build Step** to skip builds we don’t need.

## Setup (one-time)

1. Open [Vercel Dashboard](https://vercel.com) → your project.
2. Go to **Settings** → **Git**.
3. Under **Build & Development Settings**, find **Ignore Build Step**.
4. Use one of these:

   **Only production (`main`) builds:**
   ```bash
   if [ "$VERCEL_ENV" == "production" ]; then exit 1; else exit 0; fi
   ```

   **Both `main` and `staging` build; all other branches/PRs skip:**
   ```bash
   if [ "$VERCEL_GIT_COMMIT_REF" == "main" ] || [ "$VERCEL_GIT_COMMIT_REF" == "staging" ]; then exit 1; else exit 0; fi
   ```

   Exit 1 = build runs. Exit 0 = build is skipped.

5. Save.

PRs and other branches will skip the build unless they match the condition above. Only the branches you allow (e.g. `main` and optionally `staging`) will build and deploy.

## Alternative

If you can't change Vercel: in GitHub go to **Settings** → **Branches** → edit the rule for `main` → under **Require status checks**, uncheck **Vercel**. Then PRs can merge without that check.
