-- Rollback Migration 14: Comprehensive SEO Analysis System
-- Removes comprehensive_seo_analyses table and related objects

-- Drop trigger first
DROP TRIGGER IF EXISTS trigger_update_comprehensive_seo_analyses_updated_at ON comprehensive_seo_analyses;

-- Drop trigger function
DROP FUNCTION IF EXISTS update_comprehensive_seo_analyses_updated_at();

-- Drop indexes (CASCADE will handle this but being explicit)
DROP INDEX IF EXISTS idx_analyses_user_created;
DROP INDEX IF EXISTS idx_analyses_post;
DROP INDEX IF EXISTS idx_analyses_score;
DROP INDEX IF EXISTS idx_analyses_content_hash;

-- Drop table (CASCADE will remove constraints)
DROP TABLE IF EXISTS comprehensive_seo_analyses CASCADE;

-- Remove schema version tracking
DELETE FROM schema_versions WHERE version = 14;

-- Note: This rollback will permanently delete all comprehensive SEO analysis data
-- Ensure you have a backup if this data needs to be preserved