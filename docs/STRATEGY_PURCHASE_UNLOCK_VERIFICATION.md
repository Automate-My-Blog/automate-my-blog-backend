# Strategy purchase “did not unlock” — backend vs frontend

## TL;DR

**Unlock is decided on the backend.** The frontend only shows what the API returns. If a strategy purchase completed in Stripe but the strategy did not unlock, the cause is almost always that the **Stripe webhook never succeeded** (e.g. 400 due to wrong `STRIPE_WEBHOOK_SECRET`), so no row was written to `strategy_purchases`. That’s a **backend / config** issue, not a frontend bug.

---

## How unlock works

1. User completes Stripe Checkout for a strategy subscription.
2. Stripe sends `checkout.session.completed` to `POST /api/v1/stripe/webhook`.
3. Backend verifies the webhook signature (`STRIPE_WEBHOOK_SECRET`), then calls the strategy webhook handler.
4. The handler inserts a row into `strategy_purchases` (user_id, strategy_id, status = 'active', etc.).
5. Frontend calls `GET /api/v1/strategies/subscribed` (and content calendar / access checks), which read from `strategy_purchases`. If there’s no row, the strategy is not “unlocked”.

So: **no row in `strategy_purchases` ⇒ backend never recorded the purchase ⇒ frontend correctly shows it as not unlocked.**

---

## How to confirm it’s the backend

### 1. Stripe Dashboard — webhook delivery

- **Stripe Dashboard → Developers → Webhooks** → select your endpoint.
- Find the **checkout.session.completed** event for the successful payment.
- Check **Response** (e.g. 200 vs 400).

If the response was **400**, signature verification failed (e.g. `STRIPE_WEBHOOK_SECRET` had a newline or wrong value). The handler never ran, so no `strategy_purchases` row was created.

### 2. Database — was the purchase recorded?

Run (with your env’s DB):

```sql
SELECT id, user_id, strategy_id, status, amount_paid, created_at
FROM strategy_purchases
WHERE user_id = '<user-uuid>'
ORDER BY created_at DESC
LIMIT 10;
```

If there’s **no row** for that user/strategy after the time of the purchase, the webhook either failed or didn’t run → backend/config issue.

### 3. Backend logs

After fixing the webhook secret and doing a **new** test purchase, you should see logs like:

- `📨 Webhook received: checkout.session.completed`
- `🎯 Strategy subscription detected, delegating to strategy webhook handler`
- `✅ Created individual strategy subscription for strategy <id>, user <id>`

If the first purchase happened while the secret was wrong, you would **not** have seen the “Created individual strategy subscription” log for that event.

---

## Common cause: webhook secret

If someone accidentally pasted a **newline** (or wrong value) into `STRIPE_WEBHOOK_SECRET`:

- `Stripe.webhooks.constructEvent(..., process.env.STRIPE_WEBHOOK_SECRET)` fails.
- The route returns **400** and never runs the strategy handler.
- No `strategy_purchases` row is created, so the strategy never unlocks.

Fixing the secret only affects **new** webhook requests. Past events that already returned 400 were not processed.

---

## How to fix a purchase that didn’t unlock

1. **Resend the event from Stripe**  
   In Stripe Dashboard → Webhooks → select the event → **Resend**. After fixing `STRIPE_WEBHOOK_SECRET`, the resend should return 200 and the handler should create the `strategy_purchases` row. Then the next time the frontend calls `GET /api/v1/strategies/subscribed`, the strategy will show as subscribed.

2. **New test purchase**  
   After the secret is fixed, run another test checkout. You should see 200 and the log “Created individual strategy subscription,” and the new purchase will unlock.

3. **Manual repair (use with care)**  
   Only if you have clear proof of payment (e.g. successful payment in Stripe) and need to fix one-off data:

   - Insert a row into `strategy_purchases` with the correct `user_id`, `strategy_id`, `billing_interval`, `amount_paid`, `stripe_subscription_id` (from Stripe), `status = 'active'`, post quotas, etc.  
   - Prefer resending the webhook so the backend stays the single source of truth.

---

## Summary

| Observation | Likely cause |
|-------------|--------------|
| Payment succeeded in Stripe, strategy not unlocked | Webhook failed (e.g. 400) → no `strategy_purchases` row → **backend/config** |
| Webhook response was 400 for that event | Bad or malformed `STRIPE_WEBHOOK_SECRET` (e.g. pasted newline) |
| After fixing secret, resend event returns 200 | Backend then creates the row; frontend will show unlocked on next load |

The frontend does not decide unlock; it only displays the result of `GET /api/v1/strategies/subscribed` and related API calls, which read from `strategy_purchases`. So “purchase succeeded but did not unlock” is a **backend** (webhook/config) issue.
