# Strategy Subscribe 401 — Investigation Summary

## What’s happening

When you “subscribe to a topic” (strategy), the call is:

- **Endpoint:** `POST /api/v1/strategies/:id/subscribe`
- **Body:** `{ "billingInterval": "monthly" | "annual" }`
- **Stripe:** Used only *after* auth succeeds (to create a Checkout Session). The 401 happens **before** any Stripe call.

So the 401 is from **authentication**, not from Stripe.

## Why you get 401

All `/api/v1/strategies` routes use `authMiddlewareFlexible` (see `index.js`). It:

1. Looks for a JWT in:
   - `Authorization: Bearer <token>`, or
   - `?token=<token>` (e.g. for EventSource; less common for POST subscribe).
2. If **no token** → **401** with:
   - `"No token provided (use Authorization: Bearer <token> or ?token=<token>)"`
3. If **token invalid or expired** → **401** with:
   - `"Invalid or expired token"`

So you get 401 only when:

- The request has no JWT, or  
- The JWT is invalid/expired (wrong secret, wrong env, or expired).

## How to fix it

1. **Frontend must send a valid JWT**
   - For `POST .../subscribe`, send: `Authorization: Bearer <accessToken>`.
   - Use the **access token** from login/refresh, not the refresh token.
   - Ensure the token is the one for the **same environment** as the API (e.g. staging frontend → staging backend).

2. **Check the 401 response body**
   - If message is **“No token provided”** → token is not being sent (header missing or wrong name).
   - If message is **“Invalid or expired token”** → token is wrong or expired, or **JWT_SECRET** differs between the server that issued the token and the server handling the request (e.g. staging vs production).

3. **Environment alignment**
   - Staging frontend must call staging API; production frontend must call production API.
   - The backend that **issues** the JWT and the backend that **verifies** it must use the same **JWT_SECRET** (and same issuer if you use it).

## Quick test with curl

Replace `YOUR_JWT` and `STRATEGY_ID`:

```bash
curl -X POST "https://YOUR_API_URL/api/v1/strategies/STRATEGY_ID/subscribe" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{"billingInterval":"monthly"}'
```

- 401 + “No token provided” → no/invalid header.
- 401 + “Invalid or expired token” → get a fresh token from login/refresh and ensure API uses the same JWT_SECRET.

## Code references

- Auth: `services/auth-database.js` → `authMiddlewareFlexible` (lines ~873–898).
- Mount: `index.js` → `app.use('/api/v1/strategies', authService.authMiddlewareFlexible.bind(authService), strategyRoutes)`.
- Subscribe handler: `routes/strategy-subscriptions.js` → `POST /:id/subscribe` (req.user is set by middleware when token is valid).
- Frontend auth: `docs/strategy-routes-auth-frontend-handoff.md`.
