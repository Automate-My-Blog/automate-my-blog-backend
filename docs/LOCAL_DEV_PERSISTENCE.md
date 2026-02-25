# Local dev: why your test user keeps disappearing

If you have to recreate the same test user (same email/password) over and over, the usual cause is **Postgres data not persisting** across container restarts or removals.

---

## Cause

The Postgres container (`postgres-amb`) may have been started **without a named volume**. Docker then gives it an **anonymous** volume. As long as you only **stop/start** the container, data stays. But if the container is **removed** (e.g. `docker rm postgres-amb`, system restart that prunes containers, or a script that recreates the container), the next time you run a new Postgres container it gets a **new** anonymous volume — so the database starts **empty** again (no users, no migrations from your perspective unless you re-run them).

So: **removing and recreating the container = new empty DB = you have to register again.**

---

## Fix: use a named volume

Use a **named volume** for Postgres data so it survives `docker rm` and container recreation.

### One-time setup

1. **Stop and remove** the current container (this will lose current DB data; register again once after this):

   ```bash
   docker stop postgres-amb
   docker rm postgres-amb
   ```

2. **Start Postgres with a named volume** (same port and credentials as in `.env`):

   ```bash
   docker run -d --name postgres-amb \
     -e POSTGRES_USER=postgres \
     -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=automate_my_blog \
     -p 5434:5432 \
     -v postgres-amb-data:/var/lib/postgresql/data \
     postgres:16
   ```

3. **Re-run migrations** (one time, because the DB is fresh):

   ```bash
   # From repo root, with DATABASE_URL pointing at local Postgres (port 5434)
   docker run --rm -v "$(pwd):/app" -w /app \
     -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5434/automate_my_blog \
     postgres:16 bash scripts/setup-test-db.sh
   ```

4. **Register your test user again** in the app. From then on, that user (and all other data) will **persist** even if you run `docker rm postgres-amb` and create a new container with the same volume:

   ```bash
   docker run -d --name postgres-amb \
     -e POSTGRES_USER=postgres \
     -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=automate_my_blog \
     -p 5434:5432 \
     -v postgres-amb-data:/var/lib/postgresql/data \
     postgres:16
   ```

---

## Other possibilities

- **Wrong database** — Frontend or backend sometimes pointing at a different Postgres (e.g. system Postgres on 5432, or `amb-test-db` on 5433). Your `.env` should use **one** `DATABASE_URL` (e.g. `localhost:5434` for `postgres-amb`). If you run tests or another app that uses a different port, you’re using a different DB and the user you created “here” won’t exist “there.”
- **Staging vs local** — If you sometimes hit the local backend and sometimes the staging backend, the user exists only in one. Use one backend for day-to-day dev and register there; switch only when you need to test staging.

---

## Quick reference

| Goal              | Command |
|-------------------|--------|
| Start Postgres    | `docker start postgres-amb` (or the `docker run` above with `postgres-amb-data`) |
| Stop Postgres     | `docker stop postgres-amb` |
| Remove container  | `docker rm postgres-amb` (data **kept** in `postgres-amb-data` if you used the named volume) |
| Inspect volume    | `docker volume inspect postgres-amb-data` |
