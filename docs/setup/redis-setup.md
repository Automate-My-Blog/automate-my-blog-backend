# Redis setup for the job queue

The job queue (BullMQ) needs Redis. Set `REDIS_URL` in your environment and run the worker (`node jobs/job-worker.js`). This guide covers local development and hosted Redis for production (e.g. Vercel).

---

## Database: jobs table (Neon / PostgreSQL)

The queue stores job metadata in a PostgreSQL **`jobs`** table. If your DB is on [Neon](https://neon.tech) (or any Postgres), create the table once so the API and worker can use it.

**Option A – Neon SQL Editor**

1. In [Neon Console](https://console.neon.tech), open your project and branch.
2. Go to **SQL Editor**.
3. Paste the contents of **`database/26_jobs_table.sql`** (from this repo).
4. Run the script. It uses `CREATE TABLE IF NOT EXISTS`, so it’s safe to run again.

**Option B – psql with connection string**

From your machine (with `psql` and `DATABASE_URL` set to your Neon connection string):

```bash
psql "$DATABASE_URL" -f database/26_jobs_table.sql
```

Neon’s connection string is in the dashboard: **Connection details** → **Connection string** (use the one that includes the database name and, if required, SSL).

**Dependencies:** The migration references `organizations(id)` and `users(id)`. If those tables already exist (e.g. from other migrations Claude or your collaborator added), the script will succeed. If not, create `organizations` and `users` first.

After the `jobs` table exists, the API (Vercel) and worker (Render) can create and update jobs using the same Neon `DATABASE_URL`.

---

## Option 1: Local development (macOS)

### Using Homebrew

1. **Install Redis**
   ```bash
   brew install redis
   ```

2. **Start Redis** (foreground)
   ```bash
   redis-server
   ```
   Or run in the background and start on login:
   ```bash
   brew services start redis
   ```

3. **Set REDIS_URL in `.env`**
   ```bash
   REDIS_URL=redis://localhost:6379
   ```

4. **Verify**
   ```bash
   redis-cli ping
   # PONG
   ```

### Using Docker

1. **Run Redis in a container**
   ```bash
   docker run -d --name redis -p 6379:6379 redis:7-alpine
   ```

2. **Set REDIS_URL in `.env`**
   ```bash
   REDIS_URL=redis://localhost:6379
   ```

3. **Stop when done**
   ```bash
   docker stop redis
   ```

---

## Option 2: Hosted Redis (production / Vercel)

Serverless platforms (Vercel, etc.) don’t run a long-lived Redis process. Use a hosted Redis service and set `REDIS_URL` in your deployment environment.

### Upstash (serverless-friendly)

1. Go to [upstash.com](https://upstash.com) and sign up.
2. Create a Redis database (e.g. region close to your API).
3. In the Upstash console, open your database. Use the **Redis URL** for the Redis protocol (not the REST URL):
   - **REDIS_URL** – Connection string, e.g. `rediss://default@us1-xxx.upstash.io:6379` (starts with `rediss://` for TLS).
   - If the URL does **not** include the password, also set **REDIS_TOKEN** to the password/token shown in Upstash. If the URL already contains the password (e.g. `rediss://default:YOUR_TOKEN@...`), you only need `REDIS_URL`.
4. In Vercel: **Project → Settings → Environment Variables** → add:
   - `REDIS_URL` = the Redis URL from Upstash
   - `REDIS_TOKEN` = (optional) only if your URL doesn’t include the password
5. Redeploy so the API and any worker process use the new variables.

**Note:** If you run the BullMQ worker on a separate host (e.g. a small VPS or Railway), point that host’s `REDIS_URL` at the same Upstash URL so the worker and API share one queue.

**Vercel: avoid `connect EROFS /`** – On Vercel, `REDIS_URL` must be a **full TCP URL** (e.g. `rediss://default:token@host.upstash.io:6379`). If it’s a path (e.g. `/`) or missing the host, ioredis will try to use a Unix socket and you’ll see `Error: connect EROFS /` and timeouts. Set `REDIS_URL` in Vercel to the exact Upstash Redis URL from the Upstash dashboard (the one that starts with `rediss://` and includes host and port).

**Render / worker: `connect ENOENT %20--tls%20-u%20...`** – If you see this, something (Render env, an env group, or a copy-paste) has set `REDIS_URL` to a redis-cli-style string (e.g. ` --tls -u redis://...`) instead of just the URL. The worker and API now **extract** the URL from that string (they look for `redis://` or `rediss://...` and use only that part), so it should work even if the env has extra text. Prefer setting `REDIS_URL` to only the URL: `rediss://default:token@host.upstash.io:6379` (use `rediss://` for Upstash TLS). If the value is still wrong on Render, check for a Redis add-on or environment group that might be overriding `REDIS_URL`.

### Other providers

- **Redis Cloud** – [redis.com/try-free](https://redis.com/try-free/)
- **Railway** – add a Redis plugin and use the generated URL as `REDIS_URL`

Use the connection URL they give you as `REDIS_URL` (often `rediss://` for TLS in production).

---

## Running the worker on Render

Render can run the BullMQ worker as a **Background Worker** (same repo, different start command). The worker shares the same Redis (e.g. Upstash) and database as your API so jobs enqueued on Vercel are processed on Render.

### 1. Create a Background Worker

1. Log in at [render.com](https://render.com) and go to **Dashboard**.
2. Click **New +** → **Background Worker**.
3. Connect your GitHub/GitLab repo (same repo as your API).
4. Configure:
   - **Name:** e.g. `automate-my-blog-worker`
   - **Region:** Pick one close to your DB and Upstash (e.g. Oregon).
   - **Branch:** same as your API (e.g. `main`).

### 2. Build & start command

- **Build Command:** `npm install`
- **Start Command:** `npm run worker`  
  (or `node jobs/job-worker.js`)

Render will install dependencies and then run the worker process. It stays running and processes jobs from the queue.

### 3. Environment variables

Add the same env vars the worker needs. In the worker service: **Environment** → **Add Environment Variable**.

| Variable | Required | Notes |
|----------|----------|--------|
| `REDIS_URL` | Yes | Your Upstash Redis URL (`rediss://...`). Same value as on Vercel. |
| `REDIS_TOKEN` | No | Only if your REDIS_URL doesn’t include the password. |
| `DATABASE_URL` | Yes | PostgreSQL connection string. Same DB as your API. |
| `OPENAI_API_KEY` | Yes | Needed for website analysis and content generation. |

For **content generation** jobs you’ll also need any vars that the API uses for billing/Stripe (e.g. `STRIPE_SECRET_KEY`, `JWT_SECRET`) so the worker can run the full pipeline. Copy the same env group from your API where possible.

Use **Secret Files** or **Environment Groups** if you already have them for the API.

### 4. Deploy

Click **Create Background Worker**. Render builds and starts the worker. Check **Logs** to confirm:

- `Worker started for queue "amb-jobs". Processing: website_analysis, content_generation.`

### 5. Same Redis and DB as the API

- **Redis:** Use the same Upstash `REDIS_URL` (and `REDIS_TOKEN` if needed) as on Vercel so the worker consumes from the same queue the API enqueues to.
- **Database:** Use the same `DATABASE_URL` as your API so job rows and results are in one place.

After the worker is running, trigger a website analysis from your app; the job should move from queued → running → succeeded and the frontend can poll `GET /api/v1/jobs/:jobId/status` for the result.

### 6. Test the worker end-to-end

Use your **API base URL** (e.g. `https://your-api.vercel.app`). You need either a valid JWT (`Authorization: Bearer <token>`) or a session ID (`x-session-id`).

**Step 1 – Create a website-analysis job**

```bash
curl -X POST "https://YOUR_API_BASE_URL/api/v1/jobs/website-analysis" \
  -H "Content-Type: application/json" \
  -H "x-session-id: test-session-$(date +%s)" \
  -d '{"url": "https://example.com"}'
```

You should get `201` with a body like `{"jobId":"abc-123-..."}`. Copy the `jobId`.

**Step 2 – Poll job status**

```bash
curl "https://YOUR_API_BASE_URL/api/v1/jobs/JOB_ID_HERE/status" \
  -H "x-session-id: test-session-XXXXX"
```

Use the **same** `x-session-id` you used in step 1. Poll every few seconds until `status` is `succeeded` or `failed`.

- **succeeded** – `result` will contain the analysis (organization, scenarios, CTAs, etc.).
- **failed** – `error` will describe what went wrong.

**One-liner to poll until done (replace BASE_URL, JOB_ID, SESSION_ID):**

```bash
SESSION_ID="test-session-$(date +%s)"
JOB_ID=$(curl -s -X POST "https://YOUR_API_BASE_URL/api/v1/jobs/website-analysis" \
  -H "Content-Type: application/json" \
  -H "x-session-id: $SESSION_ID" \
  -d '{"url": "https://example.com"}' | jq -r .jobId)
echo "JobId: $JOB_ID"
while true; do
  STATUS=$(curl -s "https://YOUR_API_BASE_URL/api/v1/jobs/$JOB_ID/status" -H "x-session-id: $SESSION_ID" | jq -r .status)
  echo "Status: $STATUS"
  [ "$STATUS" = "succeeded" ] || [ "$STATUS" = "failed" ] && break
  sleep 5
done
curl -s "https://YOUR_API_BASE_URL/api/v1/jobs/$JOB_ID/status" -H "x-session-id: $SESSION_ID" | jq .
```

If the job goes `queued` → `running` → `succeeded` and `result` is present, the worker is processing jobs correctly.

### 7. If the build fails (segfault / exit 139)

Render can fail during `npm install` with **Exit status 139** (segmentation fault) or **cache extraction failed** because of heavy native/browser dependencies. Try in order:

1. **Clear build cache and redeploy**  
   In Render: worker service → **Manual Deploy** → **Clear build cache & deploy**. The “cache extraction failed” message often means a bad cache; clearing it fixes it.

2. **Use Node 20**  
   The repo sets `"engines": { "node": ">=20" }` so Render should use Node 20. If your worker was created before that, set **Environment** → **Build** → add `NODE_VERSION` = `20` (or in Render’s “Environment” tab, add a build-time variable `NODE_VERSION` = `20` if your plan supports it).

3. **Skip browser downloads during build (worker-only)**  
   To avoid installing Chromium/Playwright during the build (which can segfault on Render), add these as **build-time** environment variables for the worker (so they apply only during `npm install`):

   | Variable | Value |
   |----------|--------|
   | `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `1` |
   | `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | `1` |

   In Render: worker → **Environment** → **Add Environment Variable** → set both, and ensure they’re applied at **Build** time (not only Runtime). Then redeploy.

   The worker will still run; the webscraper will fall back to Cheerio when a browser isn’t available, so website analysis will work for most sites. If you later need browser-based scraping on the worker, you’d need to run Chromium in a different way (e.g. Docker image with Chromium preinstalled).

---

## After Redis is running

1. **API:** Ensure `.env` (or your host’s env) has `REDIS_URL`. The API will use it to enqueue jobs.
2. **Worker:** Run the job worker so jobs are processed:
   ```bash
   node jobs/job-worker.js
   ```
   Or `npm run worker` if that script is defined. The worker needs both `REDIS_URL` and `DATABASE_URL`.

See [backend-queue-system.md](./backend-queue-system.md) for the full queue API and behavior.
