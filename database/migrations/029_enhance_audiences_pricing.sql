-- Migration: Add pricing fields to audiences table
-- Created: 2026-01-28
-- Description: Adds dynamic profit-based pricing fields to audiences table
--              to support 8-10% sliding scale pricing model

-- Add pricing configuration columns
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  pricing_monthly DECIMAL(10, 2);

ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  pricing_annual DECIMAL(10, 2);

ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  posts_recommended INTEGER DEFAULT 8;

ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  posts_maximum INTEGER DEFAULT 40;

-- Add Stripe Price IDs
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  stripe_price_id_monthly VARCHAR(255);

ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  stripe_price_id_annual VARCHAR(255);

ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  stripe_product_id VARCHAR(255);

-- Add value metrics for pricing calculation
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  projected_profit_low INTEGER;

ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  projected_profit_high INTEGER;

ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  pricing_percentage DECIMAL(5, 2); -- e.g., 9.00 for 9%

ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  conversion_score INTEGER CHECK (conversion_score >= 0 AND conversion_score <= 100);

ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  roi_multiple DECIMAL(10, 2);

-- Add access control flags
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  requires_subscription BOOLEAN DEFAULT true;

ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  is_premium BOOLEAN DEFAULT false;

-- Add timestamps for pricing calculation tracking
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  pricing_calculated_at TIMESTAMP;

ALTER TABLE audiences ADD COLUMN IF NOT EXISTS
  pricing_last_updated_at TIMESTAMP;

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audiences_user_subscription ON audiences(user_id, requires_subscription);
CREATE INDEX IF NOT EXISTS idx_audiences_stripe_product ON audiences(stripe_product_id);
CREATE INDEX IF NOT EXISTS idx_audiences_pricing ON audiences(pricing_monthly) WHERE pricing_monthly IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN audiences.pricing_monthly IS 'Calculated monthly subscription price: Max($39.99, profit × [8% + 2% × (1000/(profit+1000))])';
COMMENT ON COLUMN audiences.pricing_annual IS 'Annual subscription price: monthly × 12 × 0.90 (10% discount)';
COMMENT ON COLUMN audiences.posts_recommended IS 'Recommended 8 posts/month (2/week) for quality SEO';
COMMENT ON COLUMN audiences.posts_maximum IS 'Maximum 40 posts/month allowed per subscription';
COMMENT ON COLUMN audiences.projected_profit_low IS 'Extracted from pitch Step 5: low-end monthly profit projection';
COMMENT ON COLUMN audiences.projected_profit_high IS 'Extracted from pitch Step 5: high-end monthly profit projection';
COMMENT ON COLUMN audiences.pricing_percentage IS 'Dynamic percentage used: slides from 10% (low profit) to 8% (high profit)';
COMMENT ON COLUMN audiences.requires_subscription IS 'Whether this strategy requires active subscription for access';
