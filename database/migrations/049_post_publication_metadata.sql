-- Migration 049: Direct platform publishing — publication metadata on blog_posts
-- Supports dashboard Posts tab: publish/unpublish to WordPress, Medium, etc.
-- See docs handoff: Direct Platform Publishing — Backend Handoff

-- publication_status: overall state for UI (draft, publishing, published, failed)
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS publication_status VARCHAR(20) DEFAULT 'draft';

-- platform_publications: per-platform state for status column tags and links
-- JSONB array of { platform, status, label?, url? }
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS platform_publications JSONB DEFAULT '[]'::jsonb;

-- Constrain allowed values
ALTER TABLE blog_posts
  DROP CONSTRAINT IF EXISTS chk_publication_status;

ALTER TABLE blog_posts
  ADD CONSTRAINT chk_publication_status
  CHECK (publication_status IS NULL OR publication_status IN ('draft', 'publishing', 'published', 'failed'));

COMMENT ON COLUMN blog_posts.publication_status IS 'Overall publication state: draft, publishing, published, failed';
COMMENT ON COLUMN blog_posts.platform_publications IS 'Per-platform state: array of { platform, status, label?, url? }';
