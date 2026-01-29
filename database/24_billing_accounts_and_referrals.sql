-- Add billing_accounts and referrals tables required by auth-database and referrals services.
-- Auth JOINs billing_accounts for current_plan, billing_status, usage_limit, current_usage.
-- Referrals service uses referrals for tracking referrer/referred users and stats.

-- =============================================================================
-- BILLING_ACCOUNTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS billing_accounts (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_plan VARCHAR(100) DEFAULT 'free',
    billing_status VARCHAR(50) DEFAULT 'active',
    usage_limit INTEGER,
    current_usage INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_billing_accounts_user_id ON billing_accounts(user_id);

-- =============================================================================
-- REFERRALS
-- =============================================================================
CREATE TABLE IF NOT EXISTS referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_id UUID REFERENCES user_invites(id) ON DELETE SET NULL,
    referral_code VARCHAR(20),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    completed_at TIMESTAMP,
    conversion_value DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
