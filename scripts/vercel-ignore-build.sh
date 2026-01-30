#!/usr/bin/env bash
# Vercel "Ignore Build Step": only build on main. Skip builds for PRs and other branches.
# In Vercel: Project Settings → Git → Ignore Build Step → set to: bash scripts/vercel-ignore-build.sh
# Exit 0 = skip build (no deployment). Exit 1 = run build.
set -e
if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then
  echo "Vercel: building main"
  exit 1
fi
echo "Vercel: skipping build for ref $VERCEL_GIT_COMMIT_REF"
exit 0
