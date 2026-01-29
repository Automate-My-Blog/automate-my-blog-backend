-- =====================================================
-- Migration 026: Add First Login Tracking
-- =====================================================
-- This migration adds first_login_at column to track when users
-- first log in, used to trigger founder welcome emails 24 minutes later
-- =====================================================

-- Add first_login_at column to users table for precise tracking
ALTER TABLE users
ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMP;

-- Backfill existing users (use last_login_at as approximation)
UPDATE users
SET first_login_at = last_login_at
WHERE first_login_at IS NULL AND last_login_at IS NOT NULL;

-- Add index for efficient querying
CREATE INDEX IF NOT EXISTS idx_users_first_login_at
ON users(first_login_at)
WHERE first_login_at IS NOT NULL;

-- Add comment
COMMENT ON COLUMN users.first_login_at IS 'Timestamp of users very first login (used for 24-minute founder welcome email)';

-- Verify migration
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'first_login_at') THEN
        RAISE NOTICE '✅ users.first_login_at column added successfully';
    END IF;
    RAISE NOTICE '✅ Migration 026: First login tracking completed successfully';
END $$;
