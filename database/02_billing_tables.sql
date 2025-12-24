-- AutoBlog Platform - Phase 2: Billing & Usage Tracking Tables
-- This file creates tables for subscription management, usage tracking, and billing

-- =============================================================================
-- BILLING & USAGE TABLES
-- =============================================================================

-- 8. Plan Definitions table - Define subscription plans and usage limits
CREATE TABLE plan_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    price_monthly DECIMAL(10,2),
    price_per_generation DECIMAL(10,2),
    features JSONB, -- {"website_scans": 1, "strategies": 1, "regenerations": 1, "downloads": 1, "generations": 4}
    is_unlimited BOOLEAN DEFAULT FALSE,
    display_order INTEGER,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. User Usage Tracking table - Track user usage against plan limits
CREATE TABLE user_usage_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    feature_type VARCHAR(50) NOT NULL, -- 'website_scan', 'generation', 'strategy', 'regeneration', 'download'
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    usage_count INTEGER DEFAULT 0,
    limit_count INTEGER,
    bonus_usage_count INTEGER DEFAULT 0, -- From referrals, promotions
    bonus_source VARCHAR(50), -- 'referral_reward', 'promotion', 'admin_grant'
    resets_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, feature_type, period_start)
);

-- 10. Subscriptions table - Manage user subscriptions and billing cycles
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id),
    plan_name VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('active', 'cancelled', 'past_due', 'unpaid')),
    current_period_start TIMESTAMP NOT NULL,
    current_period_end TIMESTAMP NOT NULL,
    trial_start TIMESTAMP,
    trial_end TIMESTAMP,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    cancelled_at TIMESTAMP,
    stripe_subscription_id VARCHAR(100),
    stripe_customer_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. Billing Cycles table - Track billing periods and usage charges
CREATE TABLE billing_cycles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id),
    cycle_start DATE NOT NULL,
    cycle_end DATE NOT NULL,
    plan_tier VARCHAR(50),
    base_amount DECIMAL(10,2) DEFAULT 0.00,
    usage_charges DECIMAL(10,2) DEFAULT 0.00,
    total_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. Pay Per Use Charges table - Track individual pay-per-use transactions
CREATE TABLE pay_per_use_charges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    feature_type VARCHAR(50) NOT NULL,
    feature_details JSONB, -- What was generated, project context
    unit_price DECIMAL(10,2) NOT NULL,
    quantity INTEGER DEFAULT 1,
    total_amount DECIMAL(10,2) NOT NULL,
    billing_cycle_id UUID REFERENCES billing_cycles(id),
    charged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- =============================================================================

-- Create triggers for tables with updated_at columns
CREATE TRIGGER update_user_usage_tracking_updated_at BEFORE UPDATE ON user_usage_tracking
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- INDEXES FOR BILLING TABLES
-- =============================================================================

-- Plan definitions indexes
CREATE INDEX idx_plan_definitions_slug ON plan_definitions(slug);
CREATE INDEX idx_plan_definitions_active ON plan_definitions(active);

-- User usage tracking indexes
CREATE INDEX idx_usage_tracking_user_period ON user_usage_tracking(user_id, feature_type, period_start);
CREATE INDEX idx_usage_tracking_period_range ON user_usage_tracking(period_start, period_end);

-- Subscriptions indexes
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_organization_id ON subscriptions(organization_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_stripe_id ON subscriptions(stripe_subscription_id);

-- Billing cycles indexes
CREATE INDEX idx_billing_cycles_user_id ON billing_cycles(user_id);
CREATE INDEX idx_billing_cycles_subscription_id ON billing_cycles(subscription_id);
CREATE INDEX idx_billing_cycles_cycle_range ON billing_cycles(cycle_start, cycle_end);

-- Pay per use charges indexes
CREATE INDEX idx_pay_per_use_user_id ON pay_per_use_charges(user_id);
CREATE INDEX idx_pay_per_use_charged_at ON pay_per_use_charges(charged_at);
CREATE INDEX idx_pay_per_use_billing_cycle ON pay_per_use_charges(billing_cycle_id);

-- =============================================================================
-- SEED DATA FOR PLAN DEFINITIONS
-- =============================================================================

-- Insert the 4 plan tiers defined in the schema
INSERT INTO plan_definitions (name, slug, price_monthly, price_per_generation, features, is_unlimited, display_order, active)
VALUES 
(
    'Free',
    'free',
    0.00,
    NULL,
    '{"website_scans": 1, "strategies": 1, "regenerations": 0, "downloads": 0, "generations": 1}',
    FALSE,
    1,
    TRUE
),
(
    'Pay as You Go',
    'pay_as_you_go',
    NULL,
    15.00,
    '{"website_scans": 999, "strategies": 999, "regenerations": 999, "downloads": 999, "generations": 999}',
    FALSE,
    2,
    TRUE
),
(
    'Starter',
    'starter',
    20.00,
    NULL,
    '{"website_scans": 999, "strategies": 999, "regenerations": 4, "downloads": 4, "generations": 4}',
    FALSE,
    3,
    TRUE
),
(
    'Pro',
    'pro',
    50.00,
    NULL,
    '{"website_scans": 999, "strategies": 999, "regenerations": 999, "downloads": 999, "generations": 999}',
    TRUE,
    4,
    TRUE
);

-- =============================================================================
-- COMMENTS FOR DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE plan_definitions IS 'Define subscription plans with pricing and feature limits';
COMMENT ON TABLE user_usage_tracking IS 'Track user usage against plan limits with bonus usage from referrals';
COMMENT ON TABLE subscriptions IS 'Manage user subscriptions and billing cycles with Stripe integration';
COMMENT ON TABLE billing_cycles IS 'Track billing periods and calculate usage charges';
COMMENT ON TABLE pay_per_use_charges IS 'Track individual pay-per-use transactions';

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Phase 2 billing tables created successfully. Tables: plan_definitions, user_usage_tracking, subscriptions, billing_cycles, pay_per_use_charges';
    RAISE NOTICE 'Inserted 4 plan definitions: Free, Pay as You Go ($15/generation), Starter ($20/month), Pro ($50/month)';
END $$;