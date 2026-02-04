# CORS — backend configuration

The browser enforces CORS: the backend must send the right headers. The frontend cannot fix “No 'Access-Control-Allow-Origin' header” errors.

## Required behavior

- **Allowed origin:** `https://www.automatemyblog.com` (and optionally other origins for dev/preview).
- **Response header:** `Access-Control-Allow-Origin: https://www.automatemyblog.com` (or your allowed list).
- **Allowed headers:** `Authorization`, `Content-Type` (and any custom headers like `x-session-id`).
- **OPTIONS preflight:** Respond with status **204** and the same CORS headers.

## Where it’s configured

1. **Express (index.js)**  
   The `cors` middleware is configured with:
   - Dynamic origin (allowed list includes `https://www.automatemyblog.com`, `https://automatemyblog.com`, Vercel previews, localhost).
   - `allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id']`.
   - `optionsSuccessStatus: 204`.

2. **Vercel (vercel.json)**  
   A `headers` block adds CORS headers for all routes so the production origin always receives them, including for OPTIONS and streaming/SSE responses:
   - `Access-Control-Allow-Origin: https://www.automatemyblog.com`
   - `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
   - `Access-Control-Allow-Headers: Content-Type, Authorization, x-session-id`
   - `Access-Control-Allow-Credentials: true`

## Adding more origins

- **Express:** Extend `allowedOriginList` in `index.js` or set env `CORS_ORIGINS` (comma-separated).
- **vercel.json:** Only one static origin is set there (production). For multiple origins, rely on Express; the vercel.json block is a safety net for the production origin.

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

In this project, CORS is handled by Express + vercel.json, so API handlers do not need to set CORS manually.
