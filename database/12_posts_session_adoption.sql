-- Migration 12: Posts Session Adoption Support
-- Purpose: Add session-based persistence for blog posts to enable anonymous user workflow
-- Date: January 7, 2026
-- Dependencies: Requires existing blog_posts, content_topics, content_strategies tables

BEGIN;

-- =============================================================================
-- Update blog_posts table to support session-based persistence
-- =============================================================================
ALTER TABLE blog_posts ADD COLUMN session_id VARCHAR(255);

-- Add constraint to ensure either user_id OR session_id is provided (but not both)
ALTER TABLE blog_posts ADD CONSTRAINT chk_posts_user_or_session CHECK (
    (user_id IS NOT NULL AND session_id IS NULL) OR 
    (user_id IS NULL AND session_id IS NOT NULL)
);

-- =============================================================================
-- Update content_topics table for posts session adoption compatibility  
-- =============================================================================
-- Note: content_topics already has session_id from migration 11
-- Ensure it can link to session-based blog posts

-- =============================================================================
-- Update content_strategies table for posts session adoption compatibility
-- =============================================================================  
-- Note: content_strategies already has session_id from migration 11
-- Ensure it can link to session-based blog posts

-- =============================================================================
-- Create indexes for performance optimization
-- =============================================================================

-- Blog posts session-based indexes
CREATE INDEX idx_blog_posts_session_id ON blog_posts(session_id);
CREATE INDEX idx_blog_posts_session_created ON blog_posts(session_id, created_at);

-- Compound indexes for session adoption queries
CREATE INDEX idx_blog_posts_user_session_lookup ON blog_posts(user_id, session_id);

-- =============================================================================
-- Create session adoption function for blog posts
-- =============================================================================
CREATE OR REPLACE FUNCTION adopt_posts_session(
    target_user_id UUID,
    source_session_id VARCHAR(255)
)
RETURNS TABLE (
    adopted_posts_count INTEGER,
    adopted_topics_count INTEGER,
    adopted_strategies_count INTEGER
) AS $$
DECLARE
    posts_count INTEGER := 0;
    topics_count INTEGER := 0;
    strategies_count INTEGER := 0;
BEGIN
    -- Adopt blog posts
    UPDATE blog_posts 
    SET user_id = target_user_id, session_id = NULL, updated_at = NOW()
    WHERE session_id = source_session_id AND user_id IS NULL;
    
    GET DIAGNOSTICS posts_count = ROW_COUNT;
    
    -- Adopt related content topics (if they don't already belong to user)
    UPDATE content_topics 
    SET session_id = NULL
    WHERE session_id = source_session_id 
    AND project_id IN (
        SELECT id FROM projects WHERE user_id = target_user_id
    );
    
    GET DIAGNOSTICS topics_count = ROW_COUNT;
    
    -- Adopt related content strategies (if they don't already belong to user)
    UPDATE content_strategies 
    SET session_id = NULL
    WHERE session_id = source_session_id 
    AND project_id IN (
        SELECT id FROM projects WHERE user_id = target_user_id
    );
    
    GET DIAGNOSTICS strategies_count = ROW_COUNT;
    
    -- Log the adoption
    RAISE NOTICE 'Session adoption completed for user % from session %: % posts, % topics, % strategies', 
        target_user_id, source_session_id, posts_count, topics_count, strategies_count;
    
    -- Return adoption counts
    RETURN QUERY SELECT posts_count, topics_count, strategies_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Add comments for documentation
-- =============================================================================
COMMENT ON COLUMN blog_posts.session_id IS 'Session ID for anonymous users before registration/login';
COMMENT ON FUNCTION adopt_posts_session IS 'Transfer blog posts and related content from session to authenticated user';

-- =============================================================================
-- Validation queries to verify schema changes
-- =============================================================================
DO $$
BEGIN
    -- Check if session_id column was added to blog_posts
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'blog_posts' AND column_name = 'session_id') THEN
        RAISE EXCEPTION 'session_id column not added to blog_posts';
    END IF;
    
    -- Check if constraint was added
    IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints 
                   WHERE constraint_name = 'chk_posts_user_or_session') THEN
        RAISE EXCEPTION 'User/session constraint not added to blog_posts';
    END IF;
    
    -- Check if adoption function was created
    IF NOT EXISTS (SELECT 1 FROM information_schema.routines 
                   WHERE routine_name = 'adopt_posts_session') THEN
        RAISE EXCEPTION 'adopt_posts_session function not created';
    END IF;
    
    RAISE NOTICE 'Migration 12 completed successfully - posts session adoption support added';
END $$;

COMMIT;

-- =============================================================================
-- Post-migration information
-- =============================================================================
SELECT 
    'Migration 12: Posts Session Adoption Support' as migration_name,
    'Completed successfully' as status,
    NOW() as completed_at;

-- Show updated blog_posts table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'blog_posts'
ORDER BY ordinal_position;