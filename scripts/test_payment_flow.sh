#!/bin/bash

# Payment Flow Testing Script
# Tests that Stripe payments correctly create credits in the database

set -e

echo "🧪 Payment Flow Testing Script"
echo "================================"
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set"
  exit 1
fi

echo "📊 Current Credit Status"
echo "------------------------"
psql "$DATABASE_URL" -c "
  SELECT
    source_type,
    status,
    COUNT(*) as count,
    SUM(value_usd) as total_value
  FROM user_credits
  GROUP BY source_type, status
  ORDER BY source_type, status;
"

echo ""
echo "📋 Recent Subscriptions (last 24 hours)"
echo "----------------------------------------"
psql "$DATABASE_URL" -c "
  SELECT
    s.id,
    u.email,
    s.plan_name,
    s.status,
    s.created_at,
    (SELECT COUNT(*) FROM user_credits uc
     WHERE uc.user_id = s.user_id
     AND uc.source_type = 'subscription'
     AND uc.created_at >= s.created_at) as credits_created
  FROM subscriptions s
  JOIN users u ON u.id = s.user_id
  WHERE s.created_at > NOW() - INTERVAL '24 hours'
  ORDER BY s.created_at DESC;
"

echo ""
echo "💰 Recent One-Time Purchases (last 24 hours)"
echo "---------------------------------------------"
psql "$DATABASE_URL" -c "
  SELECT
    p.id,
    u.email,
    p.feature_type,
    p.total_amount,
    p.charged_at,
    (SELECT COUNT(*) FROM user_credits uc
     WHERE uc.source_type = 'purchase'
     AND uc.source_id = p.id) as credits_created
  FROM pay_per_use_charges p
  JOIN users u ON u.id = p.user_id
  WHERE p.charged_at > NOW() - INTERVAL '24 hours'
  ORDER BY p.charged_at DESC;
"

echo ""
echo "🎁 Recent Referral Rewards (last 24 hours)"
echo "-------------------------------------------"
psql "$DATABASE_URL" -c "
  SELECT
    r.id,
    u.email,
    r.reward_value,
    r.status,
    r.granted_at,
    (SELECT COUNT(*) FROM user_credits uc
     WHERE uc.source_type = 'referral'
     AND uc.source_id = r.id) as credits_created
  FROM referral_rewards r
  JOIN users u ON u.id = r.user_id
  WHERE r.granted_at > NOW() - INTERVAL '24 hours'
  ORDER BY r.granted_at DESC;
"

echo ""
echo "⚠️  Orphaned Records (payments without credits)"
echo "------------------------------------------------"
echo ""
echo "One-time purchases without credits:"
psql "$DATABASE_URL" -c "
  SELECT
    p.id,
    u.email,
    p.total_amount,
    p.charged_at
  FROM pay_per_use_charges p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN user_credits uc ON uc.source_type = 'purchase' AND uc.source_id = p.id
  WHERE uc.id IS NULL
  AND p.charged_at > NOW() - INTERVAL '7 days';
"

echo ""
echo "Subscriptions without credits (limited plans only):"
psql "$DATABASE_URL" -c "
  SELECT
    s.id,
    u.email,
    s.plan_name,
    s.created_at
  FROM subscriptions s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN user_credits uc ON uc.source_type = 'subscription' AND uc.user_id = s.user_id
  WHERE s.plan_name != 'Pro'
  AND s.status = 'active'
  AND s.created_at > NOW() - INTERVAL '7 days'
  AND uc.id IS NULL;
"

echo ""
echo "✅ Testing Complete"
echo ""
echo "📝 Manual Test Checklist:"
echo "  [ ] Make test purchase at https://automate-my-blog.vercel.app/dashboard"
echo "  [ ] Verify credit appears in dashboard immediately"
echo "  [ ] Check Stripe dashboard for successful payment"
echo "  [ ] Verify webhook received successfully"
echo "  [ ] Generate blog post to consume credit"
echo "  [ ] Verify credit marked as 'used' in database"
