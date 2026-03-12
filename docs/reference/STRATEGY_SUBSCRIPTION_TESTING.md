# Strategy Subscription Feature - Testing & Verification Guide

## 🎉 Phase 2 Backend Implementation: COMPLETE

All backend components for the profit-based strategy subscription system have been successfully implemented and database migrations executed.

---

## 📊 Implementation Summary

### ✅ Completed Components

#### 1. Database Schema
- **bundle_subscriptions** - Tracks "All Strategies Bundle" subscriptions
- **strategy_purchases** - Tracks individual strategy subscriptions and bundle-linked access
- **strategy_usage_log** - Logs all post generation activity for analytics
- **audiences enhancements** - Added pricing_monthly, pricing_annual, posts_recommended, posts_maximum

#### 2. Backend Services
- **pricing-calculator.js** - Profit-based dynamic pricing with sliding scale (10% → 8%)
- **strategy-subscription-webhooks.js** - Stripe webhook handlers for subscription lifecycle

#### 3. API Endpoints
- **Individual Strategy Subscriptions**:
  - `GET /api/v1/strategies/:id/pricing` - Calculate pricing
  - `POST /api/v1/strategies/:id/subscribe` - Create checkout session
  - `GET /api/v1/strategies/:id/subscription` - Get subscription status
  - `POST /api/v1/strategies/:id/decrement` - Decrement post quota

- **Bundle Subscriptions**:
  - `GET /api/v1/strategies/bundle/calculate` - Calculate bundle pricing
  - `POST /api/v1/strategies/bundle/subscribe` - Create bundle checkout
  - `GET /api/v1/strategies/bundle` - Get active bundle subscription
  - `DELETE /api/v1/strategies/bundle` - Cancel bundle subscription

#### 4. Access Control
- **checkStrategyAccess** middleware - Verifies subscription and quota
- **checkBundleAccess** middleware - Verifies bundle subscription
- Helper functions for manual access checks

#### 5. Stripe Integration
- Webhook handlers integrated into existing Stripe routes
- Handles subscription creation, renewal (quota reset), and cancellation
- Supports both individual and bundle subscriptions

---

## 🧪 Testing Guide

### Prerequisites

1. **Environment Variables** (in `.env`):
```bash
DATABASE_URL=your_database_url
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
JWT_SECRET=your_jwt_secret
```

2. **Authenticated User Token**:
```bash
# Login to get JWT token
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "your_password"
  }'

# Store the token
export AUTH_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

3. **Existing Strategy**:
```bash
# Get user's strategies to find a strategy ID
curl -X GET http://localhost:3001/api/v1/strategies \
  -H "Authorization: Bearer $AUTH_TOKEN"

# Store strategy ID
export STRATEGY_ID="123e4567-e89b-12d3-a456-426614174000"
```

---

## 🎯 API Endpoint Testing

### 1. Individual Strategy Pricing

**Calculate Pricing for a Strategy**:
```bash
curl -X GET "http://localhost:3001/api/v1/strategies/$STRATEGY_ID/pricing" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

**Expected Response**:
```json
{
  "strategyId": "123e4567-e89b-12d3-a456-426614174000",
  "pricing": {
    "monthly": 90.00,
    "annual": 972.00,
    "posts": {
      "recommended": 8,
      "maximum": 40
    },
    "projectedLow": 1000,
    "projectedHigh": 3000,
    "percentage": {
      "monthly": 9
    },
    "savings": {
      "annualMonthlyEquivalent": 81,
      "annualSavingsPercent": 10,
      "annualSavingsDollars": 108
    }
  }
}
```

**Validation**:
- ✅ Monthly price is between $39.99 (floor) and $150 (ceiling)
- ✅ Monthly price is ~8-10% of projectedLow
- ✅ Annual price is monthly × 12 × 0.90
- ✅ Posts: recommended = 8, maximum = 40

---

### 2. Create Individual Strategy Subscription

**Create Stripe Checkout Session**:
```bash
curl -X POST "http://localhost:3001/api/v1/strategies/$STRATEGY_ID/subscribe" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "billingInterval": "monthly"
  }'
```

**Expected Response**:
```json
{
  "sessionId": "cs_test_abc123...",
  "url": "https://checkout.stripe.com/pay/cs_test_abc123...",
  "pricing": {
    "monthly": 90.00,
    "annual": 972.00,
    ...
  }
}
```

**Validation**:
- ✅ Returns Stripe checkout session ID
- ✅ Returns redirect URL to Stripe Checkout
- ✅ Pricing matches calculation endpoint

**Manual Test**:
1. Open the returned URL in browser
2. Complete checkout with test card: `4242 4242 4242 4242`
3. Verify webhook creates record in `strategy_purchases` table

---

### 3. Check Subscription Status

**Get Active Subscription**:
```bash
curl -X GET "http://localhost:3001/api/v1/strategies/$STRATEGY_ID/subscription" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

**Expected Response (if subscribed)**:
```json
{
  "subscription": {
    "id": 1,
    "strategyId": "123e4567-e89b-12d3-a456-426614174000",
    "billingInterval": "monthly",
    "postsRecommended": 8,
    "postsMaximum": 40,
    "postsUsed": 0,
    "postsRemaining": 40,
    "nextBillingDate": "2026-02-28T00:00:00.000Z",
    "isBundle": false,
    "status": "active"
  }
}
```

**Expected Response (if not subscribed)**:
```json
{
  "subscription": null
}
```

**Validation**:
- ✅ Returns subscription details if active
- ✅ Returns null if no active subscription
- ✅ Shows remaining posts quota

---

### 4. Decrement Post Quota

**Use One Post**:
```bash
curl -X POST "http://localhost:3001/api/v1/strategies/$STRATEGY_ID/decrement" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "postsRemaining": 39,
  "message": "Post quota decremented successfully"
}
```

**Validation**:
- ✅ Returns updated postsRemaining count
- ✅ Database: posts_used increments by 1
- ✅ Database: posts_remaining decrements by 1
- ✅ Entry added to strategy_usage_log table

---

### 5. Bundle Subscription - Calculate Pricing

**Calculate Bundle for All User's Strategies**:
```bash
curl -X GET "http://localhost:3001/api/v1/strategies/bundle/calculate" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

**Expected Response**:
```json
{
  "bundlePricing": {
    "strategyCount": 3,
    "individualMonthlyTotal": 287.00,
    "bundleMonthly": 258.30,
    "bundleAnnual": 2792.00,
    "savings": {
      "monthlyDiscount": 28.70,
      "monthlyDiscountPercent": 10,
      "annualDiscount": 310.00,
      "annualDiscountPercent": 10,
      "totalAnnualSavings": 652.00,
      "totalDiscountPercent": 19,
      "effectiveMonthlyRate": 232.67
    },
    "postsPerStrategy": {
      "recommended": 8,
      "maximum": 40
    }
  },
  "message": "Subscribe to all 3 strategies for $258.30/month (10% off) or $2,792/year (19% off total)"
}
```

**Validation**:
- ✅ strategyCount matches user's total strategies
- ✅ bundleMonthly = individualMonthlyTotal × 0.90
- ✅ bundleAnnual = bundleMonthly × 12 × 0.90
- ✅ totalDiscountPercent ≈ 19%
- ✅ Requires at least 2 strategies (returns 400 if < 2)

---

### 6. Create Bundle Subscription

**Subscribe to All Strategies Bundle**:
```bash
curl -X POST "http://localhost:3001/api/v1/strategies/bundle/subscribe" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "billingInterval": "annual"
  }'
```

**Expected Response**:
```json
{
  "sessionId": "cs_test_xyz789...",
  "url": "https://checkout.stripe.com/pay/cs_test_xyz789...",
  "bundlePricing": {
    "strategyCount": 3,
    "bundleMonthly": 258.30,
    "bundleAnnual": 2792.00,
    ...
  }
}
```

**Validation**:
- ✅ Returns Stripe checkout session
- ✅ Checkout amount matches bundleAnnual (if annual) or bundleMonthly (if monthly)
- ✅ Metadata includes `is_bundle: 'true'`

**Manual Test**:
1. Complete checkout in browser
2. Verify webhook creates:
   - 1 record in `bundle_subscriptions` table
   - N records in `strategy_purchases` table (one per strategy)
   - All strategy_purchases have `bundle_subscription_id` set

---

### 7. Get Active Bundle Subscription

**Retrieve Bundle Details**:
```bash
curl -X GET "http://localhost:3001/api/v1/strategies/bundle" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

**Expected Response**:
```json
{
  "bundleSubscription": {
    "id": 1,
    "strategyCount": 3,
    "billingInterval": "annual",
    "bundleMonthlyPrice": 258.30,
    "bundleAnnualPrice": 2792.00,
    "amountPaid": 2792.00,
    "totalDiscountPercent": 19.00,
    "nextBillingDate": "2027-01-28T00:00:00.000Z",
    "createdAt": "2026-01-28T00:00:00.000Z",
    "strategies": [
      {
        "strategyId": "uuid1",
        "postsRecommended": 8,
        "postsMaximum": 40,
        "postsUsed": 0,
        "postsRemaining": 40,
        "targetSegment": {...},
        "seoKeywords": "...",
        "imageUrl": "..."
      },
      ...
    ]
  }
}
```

**Validation**:
- ✅ Returns bundle details with all linked strategies
- ✅ Each strategy shows individual quota tracking
- ✅ Returns null if no active bundle

---

### 8. Cancel Bundle Subscription

**Cancel Active Bundle**:
```bash
curl -X DELETE "http://localhost:3001/api/v1/strategies/bundle" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "message": "Bundle subscription cancelled successfully"
}
```

**Validation**:
- ✅ Cancels subscription in Stripe
- ✅ Marks bundle_subscriptions record as cancelled
- ✅ Marks all linked strategy_purchases as cancelled
- ✅ Returns 404 if no active bundle found

---

## 🔐 Access Control Middleware Testing

### Test Strategy Access Gate

**Without Subscription** (should fail):
```bash
# Attempt to generate content for strategy without subscription
curl -X POST "http://localhost:3001/api/v1/strategies/$STRATEGY_ID/generate" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"topic": "Test topic"}'
```

**Expected Response (403)**:
```json
{
  "error": "Strategy subscription required",
  "strategyId": "123e4567-e89b-12d3-a456-426614174000",
  "pricing": {
    "monthly": 90.00,
    "annual": 972.00
  },
  "message": "You need an active subscription to access this strategy"
}
```

**With Subscription but No Posts Remaining** (should fail):
```bash
# After using all 40 posts, attempt to generate more
```

**Expected Response (403)**:
```json
{
  "error": "No posts remaining",
  "message": "Your post quota will reset on next billing date",
  "nextBillingDate": "2026-02-28T00:00:00.000Z",
  "postsUsed": 40,
  "postsMaximum": 40
}
```

**With Active Subscription** (should succeed):
```bash
# After subscribing and having posts remaining
```

**Expected Response (200)**:
```json
{
  "success": true,
  "content": "...",
  "postsRemaining": 39
}
```

---

## 📈 Database Verification

### Check Bundle Subscription Record
```sql
SELECT
  id,
  user_id,
  strategy_count,
  billing_interval,
  bundle_monthly_price,
  bundle_annual_price,
  total_discount_percent,
  status,
  next_billing_date
FROM bundle_subscriptions
WHERE user_id = 'your-user-uuid'
ORDER BY created_at DESC;
```

### Check Strategy Purchases
```sql
SELECT
  id,
  user_id,
  strategy_id,
  bundle_subscription_id,
  billing_interval,
  amount_paid,
  is_bundle,
  posts_recommended,
  posts_maximum,
  posts_used,
  posts_remaining,
  status,
  next_billing_date
FROM strategy_purchases
WHERE user_id = 'your-user-uuid'
ORDER BY created_at DESC;
```

### Check Usage Logs
```sql
SELECT
  id,
  user_id,
  strategy_id,
  action,
  posts_decremented,
  created_at
FROM strategy_usage_log
WHERE user_id = 'your-user-uuid'
ORDER BY created_at DESC
LIMIT 20;
```

### Verify Audiences Table Enhancements
```sql
SELECT
  id,
  user_id,
  pricing_monthly,
  pricing_annual,
  posts_recommended,
  posts_maximum,
  projected_profit_low,
  projected_profit_high,
  pricing_percentage,
  requires_subscription
FROM audiences
WHERE user_id = 'your-user-uuid'
LIMIT 5;
```

---

## 🔄 Stripe Webhook Testing

### Test Subscription Creation Webhook

**Trigger**: Complete a checkout session

**Webhook Event**: `checkout.session.completed`

**Expected Behavior**:
1. Webhook handler detects `is_bundle` metadata
2. If bundle:
   - Creates 1 `bundle_subscriptions` record
   - Creates N `strategy_purchases` records (one per strategy)
3. If individual:
   - Creates 1 `strategy_purchases` record

**Verification**:
```sql
-- Check webhook processed correctly
SELECT * FROM strategy_purchases
WHERE stripe_subscription_id = 'sub_abc123'
ORDER BY created_at DESC;
```

### Test Subscription Renewal Webhook

**Trigger**: Subscription billing cycle renews (can simulate with Stripe Dashboard)

**Webhook Event**: `customer.subscription.updated`

**Expected Behavior**:
1. Detects subscription status = 'active'
2. Resets post quota:
   - `posts_remaining = posts_maximum`
   - `posts_used = 0`
3. Updates `next_billing_date`

**Verification**:
```sql
-- Check quota was reset
SELECT posts_used, posts_remaining, next_billing_date
FROM strategy_purchases
WHERE stripe_subscription_id = 'sub_abc123';
```

### Test Subscription Cancellation Webhook

**Trigger**: Cancel subscription via API or Stripe Dashboard

**Webhook Event**: `customer.subscription.deleted`

**Expected Behavior**:
1. Marks all matching `strategy_purchases` as `status = 'cancelled'`
2. If bundle, also marks `bundle_subscriptions` as cancelled
3. Sets `cancelled_at` timestamp

**Verification**:
```sql
-- Check cancellation processed
SELECT status, cancelled_at
FROM strategy_purchases
WHERE stripe_subscription_id = 'sub_abc123';
```

---

## ✅ Feature Validation Checklist

### Pricing Calculation
- [ ] Monthly price is 8-10% of projected profit (sliding scale)
- [ ] Price never below $39.99 (floor)
- [ ] Price never above $150 (ceiling)
- [ ] Annual price is monthly × 12 × 0.90
- [ ] Bundle monthly is sum × 0.90
- [ ] Bundle annual is bundle monthly × 12 × 0.90 (19% total discount)

### Subscription Flow
- [ ] Can create individual strategy subscription (monthly)
- [ ] Can create individual strategy subscription (annual)
- [ ] Can create bundle subscription (monthly)
- [ ] Can create bundle subscription (annual)
- [ ] Checkout redirects to Stripe successfully
- [ ] Webhook creates database records after payment

### Access Control
- [ ] Cannot generate content without subscription
- [ ] Cannot generate content when quota exhausted
- [ ] Can generate content with active subscription and quota
- [ ] Post quota decrements correctly
- [ ] Usage logged in strategy_usage_log

### Quota Management
- [ ] Posts remaining starts at posts_maximum (40)
- [ ] Posts decremented on each use
- [ ] Quota resets to posts_maximum on subscription renewal
- [ ] Next billing date updates correctly

### Bundle Features
- [ ] Calculates correct pricing for all user's strategies
- [ ] Requires at least 2 strategies
- [ ] Creates bundle record + individual strategy access
- [ ] Prevents duplicate active bundles per user
- [ ] Cancelling bundle cancels all linked strategies

### Edge Cases
- [ ] Handles strategies with missing profit data gracefully
- [ ] Prevents subscription if already subscribed
- [ ] Handles Stripe webhook retry correctly
- [ ] Idempotent database operations (no duplicates)

---

## 🚀 Next Steps

### Phase 3: Frontend UI Implementation

Now that backend is complete, next phase includes:

1. **Update AudienceSegmentsTab**:
   - Display dynamic pricing on strategy cards
   - Add "Subscribe" buttons (monthly/annual)
   - Show ownership badges for subscribed strategies
   - Display remaining posts quota

2. **Create StrategyPurchaseModal**:
   - Outcome-based value proposition
   - Monthly vs. Annual option selection
   - ROI breakdown calculator
   - Stripe checkout integration

3. **Add Bundle Subscription UI**:
   - "Subscribe to All Strategies" call-to-action
   - Bundle pricing calculator display
   - Discount breakdown visualization
   - Bundle management page

4. **Update PostsTab**:
   - Add subscription access gate
   - Show remaining posts before generation
   - Quota warning when < 5 posts left
   - Upgrade prompts when quota exhausted

5. **Dashboard Widget**:
   - "My Strategy Subscriptions" overview
   - Quota usage visualizations
   - Next billing date reminders
   - Quick links to generate content

---

## 📞 Support & Troubleshooting

### Common Issues

**Issue**: Migrations fail with foreign key errors
- **Solution**: Verify users and audiences tables use UUID for id columns
- **Fix**: Update migration files to use UUID instead of INTEGER

**Issue**: Pricing calculation returns null
- **Solution**: Ensure strategy pitch Step 5 has profit format: "Profit of $X-$Y monthly..."
- **Fix**: Regenerate pitch with updated OpenAI prompt

**Issue**: Webhook not processing
- **Solution**: Verify STRIPE_WEBHOOK_SECRET is set correctly
- **Fix**: Test webhook locally with Stripe CLI: `stripe listen --forward-to localhost:3001/api/v1/stripe/webhook`

**Issue**: Cannot access strategy after subscription
- **Solution**: Check subscription record was created in strategy_purchases
- **Fix**: Manually verify database records or retry checkout

---

## 📝 Implementation Notes

### Key Design Decisions

1. **UUID Foreign Keys**: Database uses UUID for users.id and audiences.id, not INTEGER
2. **Sliding Percentage**: Dynamic 10% → 8% based on profit scale for fairness
3. **Floor Price**: $39.99 minimum ensures 80%+ margins at recommended usage
4. **Post Quotas**: 8 recommended (quality), 40 maximum (flexibility)
5. **Bundle Discount**: Stacking 10% + 10% = 19% compound discount
6. **Webhook Architecture**: Delegate strategy webhooks to separate handler module
7. **Idempotent Migrations**: Use IF NOT EXISTS for all table/column creation

### Testing Best Practices

- Always use Stripe test mode keys
- Use Stripe CLI to test webhooks locally
- Verify database state after each webhook event
- Test quota exhaustion scenarios
- Validate pricing calculations against plan formulas

---

Generated: 2026-01-28
Version: 1.0.0
Backend Implementation: ✅ COMPLETE
