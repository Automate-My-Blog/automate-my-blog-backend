# CORS — backend configuration

The browser enforces CORS: the backend must send the right headers. The frontend cannot fix “No 'Access-Control-Allow-Origin' header” errors.

## Required behavior

- **Allowed origin:** `https://www.automatemyblog.com` (and optionally other origins for dev/preview).
- **Response header:** `Access-Control-Allow-Origin: https://www.automatemyblog.com` (or your allowed list).
- **Allowed headers:** `Authorization`, `Content-Type` (and any custom headers like `x-session-id`).
- **OPTIONS preflight:** Respond with status **204** and the same CORS headers.

## Where it’s configured

**Express (index.js)** — CORS is handled by the `cors` middleware:
- Dynamic origin (allowed list includes `https://www.automatemyblog.com`, `https://automatemyblog.com`, Vercel previews, localhost).
- `allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id']`.
- `optionsSuccessStatus: 204`.

This project uses the legacy Vercel `routes` property in `vercel.json`. CORS is handled by:
- **Edge Middleware** (`middleware.js`): intercepts OPTIONS for `/api/*` at the edge and returns 204 with CORS headers so preflight always succeeds before any Node function runs.
- **Express** (`index.js`): CORS middleware and OPTIONS handler for non-OPTIONS and for local/dev. When `VERCEL` is set, a serverless wrapper also handles OPTIONS before Express.

## Adding more origins

Extend `allowedOriginList` in `index.js` or set env `CORS_ORIGINS` (comma-separated).

## Express example (reference)

```js
const cors = require('cors');

const allowedOrigins = [
  'https://www.automatemyblog.com',
  'https://automatemyblog.com',
  'http://localhost:3000',
];

app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
}));
```

## Vercel serverless example (reference)

If you were handling CORS only in the handler:

```js
const ALLOWED_ORIGIN = 'https://www.automatemyblog.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
};

export default function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  // ... rest of handler
}
```

In this project, CORS is handled by Express, so API handlers do not need to set CORS manually.
