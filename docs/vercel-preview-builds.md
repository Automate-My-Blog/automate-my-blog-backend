# Vercel: Only Build main and staging

We only want Vercel to build **main** and **staging**. PRs and all other branches should **not** build (saves time and avoids "Vercel — Deployment has failed" blocking merges). Use **Ignore Build Step** in the Vercel project so only those two branches run a build.

**Note:** Branch builds are triggered by Vercel’s Git integration (push/webhook), not by GitHub Actions. GitHub Actions only run tests and checks; they do not deploy to Vercel. So the only way to stop branch/PR builds is the Ignore Build Step (and optionally `git.deploymentEnabled` in `vercel.json`).

## Setup (one-time)

1. Open [Vercel Dashboard](https://vercel.com) → your project.
2. Go to **Settings** → **Git**.
3. Under **Build & Development Settings**, find **Ignore Build Step**.
4. Set the command to use the script in this repo (recommended):

   ```bash
   bash scripts/vercel-ignore-build.sh
   ```

   That script builds only when `VERCEL_GIT_COMMIT_REF` is `main` or `staging`; all other branches and PRs skip (exit 0 = skip, exit 1 = build).

5. **Required:** In **Settings** → **Environment Variables**, turn **Automatically Expose System Environment Variables** **ON**. Otherwise `VERCEL_GIT_COMMIT_REF` is empty and the script may skip all builds or behave incorrectly.

6. **Check Root Directory:** Ignore Build Step runs from the project’s Root Directory. If that’s not the repo root, use the inline command below instead of the script path.

7. Save.

**Inline alternative (same behavior, no script path):**
```bash
if [ "$VERCEL_GIT_COMMIT_REF" == "main" ] || [ "$VERCEL_GIT_COMMIT_REF" == "staging" ]; then exit 1; else exit 0; fi
```

**Only production (`main`) builds:**
```bash
if [ "$VERCEL_ENV" == "production" ]; then exit 1; else exit 0; fi
```

Only **main** and **staging** will build and deploy. PRs and other branches will skip the build.

## If branch builds still run

- Confirm **Ignore Build Step** is actually set (not empty) and matches one of the commands above.
- Confirm **Automatically Expose System Environment Variables** is ON.
- If using the script: confirm **Root Directory** is the repo root so `scripts/vercel-ignore-build.sh` exists.
- `vercel.json` has `git.deploymentEnabled` for `main` and `staging`; the Ignore Build Step is the main control.

## Alternative

If you can't change Vercel: in GitHub go to **Settings** → **Branches** → edit the rule for `main` → under **Require status checks**, uncheck **Vercel**. Then PRs can merge without that check.
