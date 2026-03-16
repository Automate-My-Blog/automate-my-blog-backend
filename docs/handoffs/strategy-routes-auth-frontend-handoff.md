# Strategy Routes Auth — Frontend Handoff

This document describes how the frontend authenticates with **strategy-related API endpoints** (`/api/v1/strategies/*`). The backend uses a flexible auth middleware that accepts either a Bearer token or a query param, so both `fetch` (headers) and `EventSource` (query param) work.

---

## 1. Auth Overview

All strategy routes under `/api/v1/strategies` accept **either** auth method:

| Auth method | Use case | Example |
|-------------|----------|---------|
| `Authorization: Bearer <JWT>` | Standard fetch/axios | `headers: { Authorization: \`Bearer ${token}\` }` |
| `?token=<JWT>` | EventSource (cannot send headers) | `new EventSource(\`${url}?token=${token}\`)` |

You can use whichever is appropriate for the client. For `EventSource` (e.g. pitch streaming), you **must** use `?token=` because browsers cannot attach headers to EventSource.

---

## 2. Strategy Endpoints Quick Reference

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/v1/strategies/:id/pitch` | Bearer **or** `?token=` | SSE stream; EventSource requires `?token=` |
| GET | `/api/v1/strategies/:id/pricing` | Bearer or `?token=` | Pricing for a single strategy |
| POST | `/api/v1/strategies/:id/subscribe` | Bearer or `?token=` | Body: `{ billingInterval: "monthly" \| "annual" }` |
| POST | `/api/v1/strategies/:id/sample-content-ideas` | Bearer or `?token=` | 3 sample ideas teaser; cached 1 week |
| GET | `/api/v1/strategies/content-calendar` | Bearer or `?token=` | Unified calendar for subscribed strategies |
| GET | `/api/v1/strategies/subscribed` | Bearer or `?token=` | All subscribed strategies |
| GET | `/api/v1/strategies/:id/access` | Bearer or `?token=` | Check access and remaining posts |
| POST | `/api/v1/strategies/:id/decrement` | Bearer or `?token=` | Decrement post quota |
| GET | `/api/v1/strategies/overview` | Bearer or `?token=` | LLM-generated strategy overview (cached 24h) |

**Bundle routes** (require Bearer or `?token=`):

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/strategies/bundle` | Bundle subscription status |
| GET | `/api/v1/strategies/bundle/calculate` | Calculate bundle pricing |
| POST | `/api/v1/strategies/bundle/subscribe` | Body: `{ billingInterval }` |
| DELETE | `/api/v1/strategies/bundle` | Cancel bundle |

---

## 3. Pitch (EventSource) — Use `?token=`

The pitch endpoint streams LLM-generated content via SSE. `EventSource` cannot send headers, so pass the JWT in the query string:

```js
const pitchUrl = `${API_BASE}/api/v1/strategies/${strategyId}/pitch?token=${encodeURIComponent(accessToken)}`;
const eventSource = new EventSource(pitchUrl);

eventSource.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === 'pitch-chunk') {
    appendToPitchDisplay(data.content);
  } else if (data.type === 'pricing-chunk') {
    appendToPricingDisplay(data.content);
  } else if (data.type === 'error') {
    eventSource.close();
    showError(data.content);
  }
};

eventSource.onerror = () => {
  eventSource.close();
  // Handle connection error
};
```

---

## 4. Subscribe / Pricing / Sample Ideas — Use Bearer

For regular HTTP calls (fetch, axios), use the Bearer header:

```js
const response = await fetch(`${API_BASE}/api/v1/strategies/${strategyId}/subscribe`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({ billingInterval: 'monthly' }),
});

const { sessionId, url } = await response.json();
if (url) window.location.href = url; // Stripe Checkout
```

```js
// Pricing
const res = await fetch(`${API_BASE}/api/v1/strategies/${strategyId}/pricing`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});

// Sample content ideas
const res = await fetch(`${API_BASE}/api/v1/strategies/${strategyId}/sample-content-ideas`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  },
  body: '{}',
});
```

---

## 5. Errors

| Status | Meaning |
|--------|---------|
| **401** | Missing or invalid token. Ensure you send either `Authorization: Bearer <token>` or `?token=<token>`. |
| **404** | Strategy not found or not owned by the user. |
| **400** | Invalid request (e.g. missing `billingInterval`, invalid value). |

---

## 6. Summary

- **Pitch (EventSource):** Use `?token=${encodeURIComponent(accessToken)}` — headers are not possible.
- **All other strategy routes:** Use `Authorization: Bearer ${accessToken}` (or `?token=` if you prefer).
- No special handling needed; both auth methods work for every strategy endpoint.

---

## 7. Related Docs

- [Content Calendar Frontend Handoff](./content-calendar-frontend-handoff.md) — content calendar API
- [SSE Stream Auth Handoff](./sse-stream-auth-frontend-handoff.md) — generic SSE auth patterns
- [Strategy Subscription Testing](./STRATEGY_SUBSCRIPTION_TESTING.md) — curl examples
