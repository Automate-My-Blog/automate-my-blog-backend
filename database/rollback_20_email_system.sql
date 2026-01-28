-- =====================================================
-- Rollback Migration 20: Email System
-- =====================================================
-- This rollback script removes all email system tables and columns
-- WARNING: This will permanently delete all email logs and templates
-- =====================================================

-- Drop tables in reverse order (handle foreign key dependencies)
DROP TABLE IF EXISTS lead_nurture_queue CASCADE;
DROP TABLE IF EXISTS email_templates CASCADE;
DROP TABLE IF EXISTS email_logs CASCADE;

-- Remove columns from existing tables
ALTER TABLE users
    DROP COLUMN IF EXISTS email_preferences,
    DROP COLUMN IF EXISTS unsubscribed_from,
    DROP COLUMN IF EXISTS last_email_sent_at,
    DROP COLUMN IF EXISTS total_emails_sent;

ALTER TABLE user_credits
    DROP COLUMN IF EXISTS expiration_warning_sent_at;

-- Verification
DO $$
BEGIN
    RAISE NOTICE '✅ Rollback 20: Email System completed';
    RAISE NOTICE '🗑️  Dropped tables: email_logs, email_templates, lead_nurture_queue';
    RAISE NOTICE '🗑️  Removed columns from users and user_credits';
END $$;
