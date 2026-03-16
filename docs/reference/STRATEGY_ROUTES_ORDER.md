# Strategy routes: order and consolidation

## Why order matters

Express matches routes in registration order. For `/api/v1/strategies` we have both literal paths (`/content-calendar`, `/overview`, `/subscribed`) and parameterized paths (`/:id/pitch`, `/:id/subscribe`, etc.). If a parameterized route is registered first, a request like `GET /content-calendar` can be matched by `/:id` with `id = 'content-calendar'`, leading to wrong handlers or 405 Method Not Allowed when the method doesn’t match.

## Permanent approach: single composite router

All strategy routes are registered in **one** router so order is explicit and no second mount can override:

1. **Literal paths first** (no `:id`):
   - `GET /content-calendar`
   - `GET /overview`
   - `GET /subscribed`

2. **Parameterized paths** (`/:id/...`):
   - `GET /:id/pricing`
   - `POST /:id/subscribe`
   - `GET /:id/pitch`
   - `POST /:id/sample-content-ideas`
   - `GET /:id/access`
   - `POST /:id/decrement`

Implementation: `routes/strategies-router.js` creates the single router and calls `registerRoutes(router)` from subscription and strategy modules in that order. Subscription module registers literal + `:id` subscription routes; strategy module registers the rest (and must not re-register `GET /content-calendar`).

## Rules for future changes

- **Do not** mount two separate strategy routers at `/api/v1/strategies` in `index.js`. Use the single composite router from `strategies-router.js`.
- **When adding a new route**: add it in the correct group (literal vs `/:id/...`) in the right module, and ensure the composite router’s registration order stays literal-first, then `:id`.
- **When in doubt**: add the route to the composite router’s explicit list in `strategies-router.js` so the order is documented in one place.
