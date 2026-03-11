# Staging logs → GitHub issues automation

This automation runs the Vercel staging logs script, analyzes error-level entries, and creates GitHub issues for each distinct problem (path + status) so they can be triaged and fixed.

## Quick run

From repo root:

```bash
npm run logs:staging:create-issues
```

With options:

```bash
node scripts/analyze-staging-logs-create-issues.js --since 24h
node scripts/analyze-staging-logs-create-issues.js --dry-run   # no issues created, only report
```

## What it does

1. **Fetch logs** – Runs `scripts/vercel-staging-logs.js` with `--level error`, `--since 24h` (or your `--since`), and writes raw JSON lines to a temp file.
2. **Analyze** – Parses entries, keeps only error-level or 5xx, and groups by **path + status + method** (count and sample messages).
3. **Create issues** – For each problem group, runs `gh issue create` with:
   - Title: `[Staging] <status> on <method> <path> — <short message>`
   - Label: `staging-logs`
   - Body: summary, count, sample log messages, next steps.
4. **Avoid duplicates** – Lists open issues with label `staging-logs`; skips creating if an open issue already exists for the same path + status.

## Prerequisites

- **Vercel:** `vercel link` and `vercel login` (or `VERCEL_TOKEN`). See [docs/VERCEL_STAGING_LOGS.md](./VERCEL_STAGING_LOGS.md).
- **GitHub:** `gh` CLI installed and `gh auth login`. Repo is inferred from current directory.

## Cursor

When you ask Cursor to “run the staging logs workflow and create GitHub issues” (or similar), the agent will run this script per [.cursor/rules/staging-logs-automation.mdc](../.cursor/rules/staging-logs-automation.mdc).
