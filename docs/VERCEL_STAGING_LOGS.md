# Grabbing and Analyzing Vercel Staging Logs

Ways to automatically fetch staging logs from Vercel and analyze them (errors, 5xx, patterns).

## Prerequisites

1. **Vercel CLI**  
   Install and log in:
   ```bash
   npm i -g vercel
   vercel login
   ```

2. **Link this repo** (one-time, from repo root):
   ```bash
   vercel link
   ```
   Choose your team and the `automate-my-blog-backend` project. This sets `.vercel/project.json` so `vercel logs` knows which project to use.

3. **Optional: non-interactive / CI**  
   Set a token so scripts can run without `vercel login`:
   - [Vercel Dashboard](https://vercel.com/account/tokens) → Create Token  
   - Set `VERCEL_TOKEN` in your environment (or in `.env` for local scripts).

## Option 1: Script (recommended)

From the repo root:

```bash
node scripts/vercel-staging-logs.js
```

Defaults: staging branch, preview environment, last 24 hours, JSON from CLI, then analysis (errors, 5xx, counts by level/path).

**Options:**

| Option | Description |
|--------|-------------|
| `--since <time>` | Time range, e.g. `1h`, `30m`, `24h` (default: `24h`) |
| `--limit <n>` | Max log entries (default: 500) |
| `--level <level>` | Filter: `error`, `warning`, `info`, `fatal` (can repeat) |
| `--status-code <code>` | Filter by HTTP status, e.g. `5xx`, `500` |
| `--query <text>` | Full-text search in log messages |
| `--output <file>` | Write raw JSON lines to a file for later analysis |
| `--no-analyze` | Only fetch and print raw logs (or write to `--output`) |

**Examples:**

```bash
# Errors in the last hour
node scripts/vercel-staging-logs.js --since 1h --level error

# 5xx responses and save raw logs
node scripts/vercel-staging-logs.js --since 6h --status-code 5xx --output staging-logs.jsonl

# Search for "timeout" and analyze
node scripts/vercel-staging-logs.js --since 24h --query timeout
```

## Option 2: Vercel CLI directly

If you prefer not to use the script:

```bash
# Recent staging logs (project must be linked)
vercel logs --branch staging --environment preview --json

# Last hour, errors only
vercel logs --branch staging --environment preview --since 1h --level error --json

# Save to file and analyze with jq
vercel logs --branch staging --environment preview --since 24h --json --limit 1000 > staging.jsonl
jq -s 'group_by(.level) | map({level: .[0].level, count: length})' staging.jsonl
jq 'select(.responseStatusCode >= 500)' staging.jsonl
```

## Option 3: Vercel REST API

For automation without the CLI (e.g. cron on a server):

1. Get **project id** and **latest deployment id** for the staging branch:
   - [List deployments](https://vercel.com/docs/rest-api/deployments/list-deployments): `GET /v5/projects/{projectId}/deployments?target=preview` (filter by `meta.githubCommitRef=staging` or use the latest).
2. Get logs: `GET /v1/projects/{projectId}/deployments/{deploymentId}/runtime-logs` (streaming).
3. Use `VERCEL_TOKEN` as Bearer auth.

The script and CLI are simpler for ad-hoc and local automation; use the API when you need to run this in a non-CLI environment.

## Automation (cron)

To run staging log analysis on a schedule (e.g. daily):

```bash
# Example: every day at 9 AM, last 24h, save and analyze
0 9 * * * cd /path/to/automate-my-blog-backend && node scripts/vercel-staging-logs.js --since 24h --output "staging-logs-$(date +\%Y-\%m-\%d).jsonl"
```

Or run errors-only every hour:

```bash
0 * * * * cd /path/to/automate-my-blog-backend && node scripts/vercel-staging-logs.js --since 1h --level error
```

Use `VERCEL_TOKEN` in the cron environment if the job runs without an interactive login.
