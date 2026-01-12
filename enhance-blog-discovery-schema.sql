-- Enhanced Blog Discovery Schema Updates
-- Add fields to distinguish blog index pages from individual posts

-- Add new fields to website_pages table
ALTER TABLE website_pages 
ADD COLUMN IF NOT EXISTS page_classification TEXT DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS discovered_from TEXT DEFAULT 'direct',
ADD COLUMN IF NOT EXISTS parent_index_url TEXT,
ADD COLUMN IF NOT EXISTS featured_image_url TEXT,
ADD COLUMN IF NOT EXISTS excerpt TEXT,
ADD COLUMN IF NOT EXISTS discovery_priority INTEGER DEFAULT 2,
ADD COLUMN IF NOT EXISTS discovery_confidence DECIMAL(3,2) DEFAULT 0.5;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_website_pages_classification 
ON website_pages(organization_id, page_classification);

CREATE INDEX IF NOT EXISTS idx_website_pages_discovered_from 
ON website_pages(organization_id, discovered_from);

-- Add comments for documentation
COMMENT ON COLUMN website_pages.page_classification IS 'Classification: blog_index, blog_post, landing_page, product_page, etc.';
COMMENT ON COLUMN website_pages.discovered_from IS 'Discovery method: direct, blog_index, blog_index_scraped, sitemap, manual';
COMMENT ON COLUMN website_pages.parent_index_url IS 'URL of the blog index page where this post was discovered';
COMMENT ON COLUMN website_pages.featured_image_url IS 'URL of the featured/hero image for this content';
COMMENT ON COLUMN website_pages.excerpt IS 'Short excerpt or summary of the content';
COMMENT ON COLUMN website_pages.discovery_priority IS 'Priority score (1=high, 2=medium, 3=low) for discovered content';
COMMENT ON COLUMN website_pages.discovery_confidence IS 'Confidence score (0.0-1.0) in the page classification';

-- Update existing records to have proper classification
UPDATE website_pages 
SET page_classification = CASE 
  WHEN url ~ '/(blog|news|articles|posts)/?$' THEN 'blog_index'
  WHEN url ~ '/(blog|news|articles|posts)/' AND url !~ '/(blog|news|articles|posts)/?$' THEN 'blog_post'
  WHEN page_type = 'blog_post' THEN 'blog_post'
  ELSE 'unknown'
END
WHERE page_classification = 'unknown';

-- Create enhanced utility function for blog content summary
CREATE OR REPLACE FUNCTION get_enhanced_blog_summary(org_uuid UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_pages', COUNT(*),
    'blog_index_pages', COUNT(*) FILTER (WHERE page_classification = 'blog_index'),
    'blog_posts', COUNT(*) FILTER (WHERE page_classification = 'blog_post'),
    'individual_posts_scraped', COUNT(*) FILTER (WHERE discovered_from = 'blog_index_scraped'),
    'average_word_count', ROUND(AVG(word_count)),
    'average_quality_score', ROUND(AVG(analysis_quality_score)),
    'posts_with_images', COUNT(*) FILTER (WHERE featured_image_url IS NOT NULL),
    'posts_with_excerpts', COUNT(*) FILTER (WHERE excerpt IS NOT NULL AND excerpt != ''),
    'high_priority_posts', COUNT(*) FILTER (WHERE discovery_priority = 1),
    'discovery_methods', jsonb_agg(DISTINCT discovered_from) FILTER (WHERE discovered_from IS NOT NULL),
    'last_scraped', MAX(scraped_at),
    'discovery_quality_score', ROUND(AVG(discovery_confidence), 2)
  ) INTO result
  FROM website_pages
  WHERE organization_id = org_uuid;
  
  RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_enhanced_blog_summary(UUID) TO PUBLIC;