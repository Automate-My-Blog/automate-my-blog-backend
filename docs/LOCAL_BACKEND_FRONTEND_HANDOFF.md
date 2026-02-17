# Point local frontend at local backend — handoff

Use this to wire your **local frontend** to the **local AutoBlog backend** (API + workers) running on this machine.

---

## 1. API base URL

Set your frontend’s API base to:

```text
http://localhost:3001
```

- **Health:** `GET http://localhost:3001/health`
- **API base path:** `http://localhost:3001/api` (e.g. `/api/v1/...`)

**Examples:**

- **Vite / env:**  
  `VITE_API_BASE=http://localhost:3001` (or `VITE_API_URL`, whatever your app uses)
- **Hardcoded / config:**  
  Base URL = `http://localhost:3001`

---

## 2. CORS

The backend allows these origins (no extra config needed if your frontend is on one of these):

- `http://localhost:3000`
- `http://localhost:3001`
- `http://localhost:3002`
- `http://localhost:5173` (Vite default)
- `http://127.0.0.1:3000`
- `http://127.0.0.1:3001`

If your dev server runs on another port (e.g. `3004`), either:

- Start it on one of the above, or  
- Add that origin via backend env: `CORS_ORIGINS=http://localhost:3004` (comma-separated for multiple).

---

## 3. Auth

- Send the JWT on every request:  
  `Authorization: Bearer <accessToken>`
- Login/register: use the usual auth endpoints (e.g. `/api/v1/auth/login`, `/api/v1/auth/register`) against `http://localhost:3001` so tokens are for this backend.

---

## 4. Optional: calendar testbed

If you use the **content calendar testbed** and want fixture data when the DB is empty:

- Add `?testbed=1` to content-calendar/audience requests, or header `X-Calendar-Testbed: 1`.
- Backend must have `ENABLE_CALENDAR_TESTBED=1` in `.env` (already set in this repo’s example).

---

## 5. One-line summary for a prompt

**“Point the frontend at the local backend: set the API base URL to `http://localhost:3001`. Use `Authorization: Bearer <accessToken>` for authenticated requests. CORS is allowed for localhost origins (e.g. 3000, 5173). Health check: `GET http://localhost:3001/health`.”**
