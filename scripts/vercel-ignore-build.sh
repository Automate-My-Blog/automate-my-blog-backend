#!/usr/bin/env bash
# Vercel "Ignore Build Step": only build on main and staging. Skip builds for PRs and other branches.
# In Vercel: Project Settings → Git → Ignore Build Step → set to: bash scripts/vercel-ignore-build.sh
# Require: Settings → Environment Variables → "Automatically Expose System Environment Variables" ON.
# Exit 0 = skip build (no deployment). Exit 1 = run build.
ref="${VERCEL_GIT_COMMIT_REF:-}"
if [[ "$ref" == "main" || "$ref" == "staging" ]]; then
  echo "Vercel: building ref=$ref"
  exit 1
fi
echo "Vercel: skipping build for ref=$ref"
exit 0
