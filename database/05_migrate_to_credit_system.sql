-- AutoBlog Platform - Phase 4: Migrate Existing Data to Credit System
-- This file migrates existing referral_rewards to the new user_credits table

-- =============================================================================
-- DATA MIGRATION
-- =============================================================================

-- Migrate existing referral_rewards to user_credits
-- Only migrate active and pending rewards
INSERT INTO user_credits (
    user_id,
    source_type,
    source_id,
    source_description,
    quantity,
    value_usd,
    status,
    priority,
    created_at,
    expires_at
)
SELECT
    user_id,
    'referral' as source_type,
    id as source_id,
    'Referral reward (migrated from referral_rewards)' as source_description,
    1 as quantity,
    reward_value as value_usd,
    CASE
        WHEN status = 'active' THEN 'active'
        WHEN status = 'pending' THEN 'active'
        WHEN status = 'used' THEN 'used'
        ELSE 'expired'
    END as status,
    75 as priority,  -- Referral credits have medium-high priority
    granted_at as created_at,
    expires_at
FROM referral_rewards
WHERE status IN ('active', 'pending', 'used');

-- =============================================================================
-- ADD MIGRATION TRACKING TO SOURCE TABLE
-- =============================================================================

-- Add column to track which user_credit record this reward was migrated to
ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS migrated_to_credit_id UUID;

-- Update referral_rewards with the ID of the corresponding user_credit
UPDATE referral_rewards r
SET migrated_to_credit_id = c.id
FROM user_credits c
WHERE c.source_type = 'referral' AND c.source_id = r.id;

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

DO $$
DECLARE
    migrated_count INTEGER;
    referral_count INTEGER;
BEGIN
    -- Count migrated records
    SELECT COUNT(*) INTO migrated_count FROM user_credits WHERE source_type = 'referral';
    SELECT COUNT(*) INTO referral_count FROM referral_rewards WHERE status IN ('active', 'pending', 'used');

    RAISE NOTICE '=== Migration Complete ===';
    RAISE NOTICE 'Migrated % referral rewards to user_credits', migrated_count;
    RAISE NOTICE 'Original referral_rewards records: %', referral_count;

    IF migrated_count = referral_count THEN
        RAISE NOTICE '✅ Migration successful - all records migrated';
    ELSE
        RAISE WARNING '⚠️  Migration count mismatch - please verify';
    END IF;

    -- Show breakdown by status
    RAISE NOTICE '';
    RAISE NOTICE 'Credit breakdown by status:';
    FOR rec IN (
        SELECT status, COUNT(*) as count
        FROM user_credits
        WHERE source_type = 'referral'
        GROUP BY status
        ORDER BY status
    ) LOOP
        RAISE NOTICE '  %: % credits', rec.status, rec.count;
    END LOOP;
END $$;

-- =============================================================================
-- NEXT STEPS
-- =============================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Next Steps ===';
    RAISE NOTICE '1. Verify migration: SELECT source_type, status, COUNT(*) FROM user_credits GROUP BY source_type, status;';
    RAISE NOTICE '2. Deploy code changes to use user_credits table';
    RAISE NOTICE '3. Test one-time purchase creates purchase credits';
    RAISE NOTICE '4. Test subscription creates subscription credits';
    RAISE NOTICE '5. Test referral creates referral credits';
END $$;
