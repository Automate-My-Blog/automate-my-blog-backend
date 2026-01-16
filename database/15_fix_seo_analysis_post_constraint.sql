-- Migration 15: Fix SEO Analysis Post Linkage
-- Problem: Current constraint allows same content to overwrite different posts' analyses
-- Solution: Make post_id part of unique constraint so each post has its own analysis

-- Drop the old constraint that only considered content_hash + user_id
ALTER TABLE comprehensive_seo_analyses
DROP CONSTRAINT IF EXISTS unique_user_content;

-- Add new constraint: Each post can have only one analysis
-- This allows different posts to analyze the same content independently
ALTER TABLE comprehensive_seo_analyses
ADD CONSTRAINT unique_post_analysis UNIQUE(post_id, user_id);

-- Note: This means we can no longer deduplicate identical content across posts
-- But that's correct behavior - each post should have its own analysis

-- Make post_id NOT NULL since we now require it for uniqueness
-- First, we need to handle any existing NULL post_ids
UPDATE comprehensive_seo_analyses
SET post_id = gen_random_uuid()
WHERE post_id IS NULL;

ALTER TABLE comprehensive_seo_analyses
ALTER COLUMN post_id SET NOT NULL;

-- Add index for better query performance on post lookups
CREATE INDEX IF NOT EXISTS idx_analyses_post_user ON comprehensive_seo_analyses(post_id, user_id);

-- Update comments
COMMENT ON CONSTRAINT unique_post_analysis ON comprehensive_seo_analyses IS 'Each post has exactly one SEO analysis. Re-analyzing a post updates its analysis.';
