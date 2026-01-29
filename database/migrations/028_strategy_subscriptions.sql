-- Migration: Add strategy subscription tables
-- Created: 2026-01-28
-- Description: Creates tables for individual strategy subscriptions and bundle subscriptions
--              to support dynamic profit-based pricing model

-- Create bundle_subscriptions table first (referenced by strategy_purchases)
CREATE TABLE IF NOT EXISTS bundle_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Bundle Details
  strategy_count INTEGER NOT NULL CHECK (strategy_count > 1), -- Bundle requires at least 2 strategies
  billing_interval VARCHAR(20) NOT NULL CHECK (billing_interval IN ('monthly', 'annual')),

  -- Pricing
  individual_monthly_total DECIMAL(10, 2) NOT NULL, -- Sum of individual prices
  bundle_monthly_price DECIMAL(10, 2) NOT NULL, -- With 10% discount
  bundle_annual_price DECIMAL(10, 2), -- With 19% total discount (if annual)
  amount_paid DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'usd',

  -- Discounts Applied
  monthly_discount_percent DECIMAL(5, 2) DEFAULT 10.00,
  annual_discount_percent DECIMAL(5, 2) DEFAULT 10.00,
  total_discount_percent DECIMAL(5, 2), -- Compound discount ~19%

  -- Stripe Integration
  stripe_subscription_id VARCHAR(255) UNIQUE NOT NULL,
  stripe_customer_id VARCHAR(255),

  -- Status
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  next_billing_date TIMESTAMP,
  cancelled_at TIMESTAMP,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Only one active bundle per user
  UNIQUE(user_id, status)
);

-- Create indexes for bundle_subscriptions
CREATE INDEX idx_bundle_subscriptions_user_active ON bundle_subscriptions(user_id, status);
CREATE INDEX idx_bundle_subscriptions_stripe ON bundle_subscriptions(stripe_subscription_id);

-- Create strategy_purchases table
CREATE TABLE IF NOT EXISTS strategy_purchases (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES audiences(id) ON DELETE CASCADE, -- NULL for bundle subscriptions
  bundle_subscription_id INTEGER REFERENCES bundle_subscriptions(id) ON DELETE CASCADE, -- NULL for individual subscriptions

  -- Subscription Details
  billing_interval VARCHAR(20) NOT NULL CHECK (billing_interval IN ('monthly', 'annual')),
  amount_paid DECIMAL(10, 2) NOT NULL, -- monthly: base price, annual: discounted price
  currency VARCHAR(3) DEFAULT 'usd',
  is_bundle BOOLEAN DEFAULT false, -- true if part of bundle subscription

  -- Stripe Integration
  stripe_payment_intent_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255), -- for recurring purchases
  stripe_customer_id VARCHAR(255),

  -- Post Limits (per strategy)
  posts_recommended INTEGER DEFAULT 8, -- Recommended usage: 2 posts/week
  posts_maximum INTEGER DEFAULT 40, -- Maximum allowed per month
  posts_used INTEGER DEFAULT 0 CHECK (posts_used >= 0),
  posts_remaining INTEGER NOT NULL CHECK (posts_remaining >= 0), -- Resets to posts_maximum on billing renewal

  -- Status
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  next_billing_date TIMESTAMP, -- when subscription renews and posts reset
  cancelled_at TIMESTAMP,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Must be either individual OR bundle, not both
  CHECK (
    (strategy_id IS NOT NULL AND bundle_subscription_id IS NULL) OR
    (strategy_id IS NULL AND bundle_subscription_id IS NOT NULL)
  ),
  CHECK (posts_used <= posts_maximum)
);

-- Create indexes for strategy_purchases
CREATE INDEX idx_strategy_purchases_user_strategy ON strategy_purchases(user_id, strategy_id);
CREATE INDEX idx_strategy_purchases_user_active ON strategy_purchases(user_id, status);
CREATE INDEX idx_strategy_purchases_stripe_subscription ON strategy_purchases(stripe_subscription_id);
CREATE INDEX idx_strategy_purchases_bundle ON strategy_purchases(bundle_subscription_id);

-- Add comments for documentation
COMMENT ON TABLE bundle_subscriptions IS 'Tracks "All Strategies Bundle" subscriptions with 10% monthly + 10% annual stacking discounts';
COMMENT ON TABLE strategy_purchases IS 'Tracks individual strategy subscriptions and bundle-linked strategy access with monthly post quotas';
COMMENT ON COLUMN strategy_purchases.posts_recommended IS 'Recommended usage: 8 posts/month (2 per week) for quality SEO';
COMMENT ON COLUMN strategy_purchases.posts_maximum IS 'Maximum allowed: 40 posts/month for flexibility';
COMMENT ON COLUMN bundle_subscriptions.total_discount_percent IS 'Compound discount: 10% bundle + 10% annual = ~19% total';
