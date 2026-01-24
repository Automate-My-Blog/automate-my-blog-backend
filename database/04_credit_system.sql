-- AutoBlog Platform - Phase 4: Unified Credit System
-- This file creates the user_credits table for unified credit tracking

-- =============================================================================
-- UNIFIED CREDIT TRACKING TABLE
-- =============================================================================

-- user_credits table - Single source of truth for all credit types
CREATE TABLE user_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Source tracking
    source_type VARCHAR(50) NOT NULL, -- 'subscription', 'purchase', 'referral', 'admin_grant'
    source_id UUID,                   -- Links to source table (subscriptions/pay_per_use_charges/referral_rewards)
    source_description TEXT,          -- Human-readable: "Referral from john@example.com"

    -- Credit details
    quantity INTEGER NOT NULL DEFAULT 1,
    value_usd DECIMAL(10,2),          -- Monetary value

    -- Status tracking
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    priority INTEGER DEFAULT 0,        -- Higher priority = consumed first (100=purchase, 75=referral, 50=subscription)

    -- Lifecycle timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    used_at TIMESTAMP,
    used_for_type VARCHAR(50),        -- 'blog_post', 'regeneration', etc.
    used_for_id UUID,                 -- ID of blog_post or other resource

    -- Constraints
    CONSTRAINT check_valid_status CHECK (status IN ('active', 'used', 'expired', 'reserved')),
    CONSTRAINT check_valid_source_type CHECK (source_type IN ('subscription', 'purchase', 'referral', 'admin_grant'))
);

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

-- Primary lookup: Find active credits for a user
CREATE INDEX idx_user_credits_user_status ON user_credits(user_id, status);

-- Find credits that need expiration
CREATE INDEX idx_user_credits_expiration ON user_credits(expires_at) WHERE status = 'active';

-- Lookup by source for auditing
CREATE INDEX idx_user_credits_source ON user_credits(source_type, source_id);

-- Find credits by priority for consumption ordering
CREATE INDEX idx_user_credits_priority ON user_credits(user_id, priority DESC, created_at ASC) WHERE status = 'active';

-- =============================================================================
-- TABLE DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE user_credits IS 'Unified tracking of all credit sources (subscription, purchase, referral) with full audit trail';
COMMENT ON COLUMN user_credits.source_type IS 'Type of credit source: subscription (monthly allocation), purchase (one-time buy), referral (bonus from referring users)';
COMMENT ON COLUMN user_credits.source_id IS 'Foreign key to original source record for auditing';
COMMENT ON COLUMN user_credits.priority IS 'Consumption priority: 100=purchase, 75=referral, 50=subscription. Higher consumed first.';
COMMENT ON COLUMN user_credits.status IS 'Credit lifecycle: active (available), used (consumed), expired (past expiration date), reserved (held for pending operation)';

-- =============================================================================
-- COMPLETION LOG
-- =============================================================================

DO $$
BEGIN
    RAISE NOTICE 'Phase 4: Unified Credit System table created successfully';
    RAISE NOTICE 'Created table: user_credits';
    RAISE NOTICE 'Created 4 indexes for performance optimization';
    RAISE NOTICE 'Next step: Run 05_migrate_to_credit_system.sql to migrate existing data';
END $$;
