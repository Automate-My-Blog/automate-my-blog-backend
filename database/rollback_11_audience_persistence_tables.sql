-- Rollback Migration 11: Audience Persistence Tables
-- Purpose: Remove all changes from migration 11 and restore original schema
-- Date: January 4, 2026
-- Use: Execute this script if migration 11 needs to be rolled back

BEGIN;

-- =============================================================================
-- Pre-rollback validation and warnings
-- =============================================================================
DO $$
DECLARE
    audience_count INTEGER;
    keyword_count INTEGER;
    topics_with_audiences INTEGER;
    strategies_with_audiences INTEGER;
BEGIN
    -- Check what data will be lost
    SELECT COUNT(*) INTO audience_count FROM audiences WHERE TRUE;
    SELECT COUNT(*) INTO keyword_count FROM seo_keywords WHERE TRUE;
    SELECT COUNT(*) INTO topics_with_audiences FROM content_topics WHERE audience_id IS NOT NULL;
    SELECT COUNT(*) INTO strategies_with_audiences FROM content_strategies WHERE audience_id IS NOT NULL;
    
    -- Warning about data loss
    RAISE WARNING 'ROLLBACK WARNING: This will permanently delete:';
    RAISE WARNING '- % audience records', audience_count;
    RAISE WARNING '- % SEO keyword records', keyword_count;
    RAISE WARNING '- Audience relationships for % content topics', topics_with_audiences;
    RAISE WARNING '- Audience relationships for % content strategies', strategies_with_audiences;
    
    IF audience_count > 0 OR keyword_count > 0 THEN
        RAISE WARNING 'DATA LOSS WARNING: User-generated audience and keyword data will be permanently deleted!';
    END IF;
END $$;

-- =============================================================================
-- Remove triggers and functions
-- =============================================================================
DROP TRIGGER IF EXISTS update_audiences_updated_at ON audiences;
-- Note: We don't drop the function as it might be used by other tables

-- =============================================================================
-- Remove added columns from existing tables
-- WARNING: This will permanently delete data in these columns
-- =============================================================================

-- Remove columns from content_strategies table (no constraints to drop in updated version)
DROP INDEX IF EXISTS idx_content_strategies_audience_id;
DROP INDEX IF EXISTS idx_content_strategies_session_id;
ALTER TABLE content_strategies DROP COLUMN IF EXISTS audience_id;
ALTER TABLE content_strategies DROP COLUMN IF EXISTS session_id;

-- Remove columns from content_topics table (no constraints to drop in updated version)
DROP INDEX IF EXISTS idx_content_topics_audience_id;
DROP INDEX IF EXISTS idx_content_topics_session_id;
ALTER TABLE content_topics DROP COLUMN IF EXISTS audience_id;
ALTER TABLE content_topics DROP COLUMN IF EXISTS session_id;

-- =============================================================================
-- Drop new tables (order matters due to foreign key constraints)
-- WARNING: This will permanently delete all data in these tables
-- =============================================================================

-- Drop seo_keywords table first (references audiences)
DROP TABLE IF EXISTS seo_keywords CASCADE;

-- Drop audiences table
DROP TABLE IF EXISTS audiences CASCADE;

-- =============================================================================
-- Clean up any remaining indexes or constraints
-- =============================================================================

-- Remove any orphaned indexes (shouldn't exist but clean up just in case)
DROP INDEX IF EXISTS idx_audiences_user_id;
DROP INDEX IF EXISTS idx_audiences_session_id;
DROP INDEX IF EXISTS idx_audiences_org_intelligence;
DROP INDEX IF EXISTS idx_audiences_priority;
DROP INDEX IF EXISTS idx_audiences_created_at;

DROP INDEX IF EXISTS idx_seo_keywords_audience_id;
DROP INDEX IF EXISTS idx_seo_keywords_user_id;
DROP INDEX IF EXISTS idx_seo_keywords_session_id;
DROP INDEX IF EXISTS idx_seo_keywords_keyword;
DROP INDEX IF EXISTS idx_seo_keywords_relevance;
DROP INDEX IF EXISTS idx_audiences_project_id;
DROP INDEX IF EXISTS idx_seo_keywords_project_id;

-- =============================================================================
-- Validation: Verify rollback completed successfully
-- =============================================================================
DO $$
DECLARE
    remaining_tables TEXT;
    remaining_columns TEXT;
BEGIN
    -- Check for any remaining tables that should have been removed
    SELECT string_agg(table_name, ', ') INTO remaining_tables
    FROM information_schema.tables 
    WHERE table_name IN ('audiences', 'seo_keywords')
    AND table_schema = 'public';
    
    -- Check for any remaining columns that should have been removed
    SELECT string_agg(table_name || '.' || column_name, ', ') INTO remaining_columns
    FROM information_schema.columns 
    WHERE (table_name = 'content_topics' OR table_name = 'content_strategies')
      AND column_name IN ('audience_id', 'session_id')
      AND table_schema = 'public';
    
    -- Report any issues
    IF remaining_tables IS NOT NULL THEN
        RAISE EXCEPTION 'ROLLBACK FAILED: Tables still exist: %', remaining_tables;
    END IF;
    
    IF remaining_columns IS NOT NULL THEN
        RAISE EXCEPTION 'ROLLBACK FAILED: Columns still exist: %', remaining_columns;
    END IF;
    
    -- Success message
    RAISE NOTICE 'ROLLBACK SUCCESS: Migration 11 has been completely rolled back';
    RAISE NOTICE 'All audience persistence tables and columns have been removed';
    RAISE NOTICE 'Database schema restored to pre-migration 11 state';
END $$;

-- =============================================================================
-- Verify existing tables are unaffected
-- =============================================================================
DO $$
DECLARE
    critical_tables TEXT[] := ARRAY['users', 'organization_intelligence', 'content_topics', 'content_strategies'];
    tbl_name TEXT;
    table_exists BOOLEAN;
BEGIN
    RAISE NOTICE 'Verifying critical tables are still intact...';
    
    FOREACH tbl_name IN ARRAY critical_tables
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_name = tbl_name AND table_schema = 'public'
        ) INTO table_exists;
        
        IF NOT table_exists THEN
            RAISE EXCEPTION 'CRITICAL ERROR: Table % is missing after rollback!', tbl_name;
        ELSE
            RAISE NOTICE '✓ Table % is intact', tbl_name;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'All critical tables verified - rollback safe';
END $$;

COMMIT;

-- =============================================================================
-- Post-rollback information and verification
-- =============================================================================
SELECT 
    'Rollback Migration 11: Audience Persistence Tables' as rollback_name,
    'Completed successfully' as status,
    NOW() as completed_at;

-- Show that tables are gone
SELECT 
    CASE 
        WHEN COUNT(*) = 0 THEN 'SUCCESS: No audience-related tables remain'
        ELSE 'ERROR: ' || COUNT(*)::TEXT || ' audience-related tables still exist'
    END as rollback_verification
FROM information_schema.tables 
WHERE table_name IN ('audiences', 'seo_keywords')
AND table_schema = 'public';

-- Show that columns are gone
SELECT 
    CASE 
        WHEN COUNT(*) = 0 THEN 'SUCCESS: No audience-related columns remain in existing tables'
        ELSE 'ERROR: ' || COUNT(*)::TEXT || ' audience-related columns still exist'
    END as column_cleanup_verification
FROM information_schema.columns 
WHERE (table_name = 'content_topics' OR table_name = 'content_strategies')
  AND column_name IN ('audience_id', 'session_id')
  AND table_schema = 'public';

-- Show existing tables are intact
SELECT 
    table_name,
    'Table intact after rollback' as status
FROM information_schema.tables 
WHERE table_name IN ('users', 'organization_intelligence', 'content_topics', 'content_strategies')
AND table_schema = 'public'
ORDER BY table_name;