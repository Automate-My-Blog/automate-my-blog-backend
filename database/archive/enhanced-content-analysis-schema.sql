-- Enhanced Content Analysis Schema Updates
-- Add fields for visual design and advanced content structure analysis

-- Add visual design and structure fields to website_pages table
ALTER TABLE website_pages 
ADD COLUMN IF NOT EXISTS visual_design JSONB,
ADD COLUMN IF NOT EXISTS content_structure JSONB,
ADD COLUMN IF NOT EXISTS ctas_extracted JSONB;

-- Add sitemap metadata fields to preserve all XML sitemap data
ALTER TABLE website_pages
ADD COLUMN IF NOT EXISTS last_modified_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS sitemap_priority DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS sitemap_changefreq VARCHAR(20);

-- Add indexes for better query performance on JSONB fields
CREATE INDEX IF NOT EXISTS idx_website_pages_visual_design 
ON website_pages USING GIN (visual_design);

CREATE INDEX IF NOT EXISTS idx_website_pages_content_structure 
ON website_pages USING GIN (content_structure);

CREATE INDEX IF NOT EXISTS idx_website_pages_ctas 
ON website_pages USING GIN (ctas_extracted);

-- Add comments for documentation
COMMENT ON COLUMN website_pages.visual_design IS 'Visual design data including colors, typography, layout information';
COMMENT ON COLUMN website_pages.content_structure IS 'Content structure analysis including paragraph counts, lists, formatting patterns';
COMMENT ON COLUMN website_pages.ctas_extracted IS 'CTAs found within this specific page/post';

-- Create enhanced content analysis summary function
CREATE OR REPLACE FUNCTION get_enhanced_content_summary(org_uuid UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_pages', COUNT(*),
    'blog_posts', COUNT(*) FILTER (WHERE page_classification = 'blog_post'),
    'pages_with_visual_design', COUNT(*) FILTER (WHERE visual_design IS NOT NULL),
    'pages_with_structure_analysis', COUNT(*) FILTER (WHERE content_structure IS NOT NULL),
    'total_ctas_in_pages', (
      SELECT SUM(jsonb_array_length(ctas_extracted)) 
      FROM website_pages 
      WHERE organization_id = org_uuid AND ctas_extracted IS NOT NULL
    ),
    'common_colors', (
      SELECT jsonb_agg(DISTINCT color)
      FROM website_pages wp,
      jsonb_array_elements_text(wp.visual_design->'colors'->'primary') AS color
      WHERE wp.organization_id = org_uuid AND wp.visual_design IS NOT NULL
      LIMIT 10
    ),
    'common_fonts', (
      SELECT jsonb_agg(DISTINCT font)
      FROM website_pages wp,
      jsonb_array_elements_text(wp.visual_design->'typography'->'fonts') AS font
      WHERE wp.organization_id = org_uuid AND wp.visual_design IS NOT NULL
      LIMIT 5
    ),
    'content_patterns', jsonb_build_object(
      'avg_paragraph_count', ROUND(AVG((content_structure->>'paragraphCount')::numeric), 1),
      'avg_heading_count', ROUND(AVG(jsonb_array_length(COALESCE(headings, '[]'::jsonb))), 1),
      'posts_with_lists', COUNT(*) FILTER (WHERE (content_structure->>'listCount')::int > 0),
      'posts_with_images', COUNT(*) FILTER (WHERE (content_structure->>'imageCount')::int > 0),
      'posts_with_code', COUNT(*) FILTER (WHERE (content_structure->>'codeBlockCount')::int > 0)
    ),
    'last_analyzed', MAX(scraped_at)
  ) INTO result
  FROM website_pages
  WHERE organization_id = org_uuid;
  
  RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_enhanced_content_summary(UUID) TO PUBLIC;

-- Update existing CTA analysis table for better conflict resolution
ALTER TABLE cta_analysis 
ADD COLUMN IF NOT EXISTS page_type VARCHAR(50) DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS analysis_source VARCHAR(50) DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMP DEFAULT NOW();

-- Add index for page type
CREATE INDEX IF NOT EXISTS idx_cta_analysis_page_type 
ON cta_analysis(organization_id, page_type);

-- Add comments
COMMENT ON COLUMN cta_analysis.page_type IS 'Type of page: homepage, blog_post, product_page, etc.';
COMMENT ON COLUMN cta_analysis.analysis_source IS 'How the CTA was discovered: blog_scraping, static_page, manual, etc.';

-- Create comprehensive CTA summary function
CREATE OR REPLACE FUNCTION get_comprehensive_cta_summary(org_uuid UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_ctas', COUNT(*),
    'blog_post_ctas', COUNT(*) FILTER (WHERE page_type = 'blog_post'),
    'homepage_ctas', COUNT(*) FILTER (WHERE page_type = 'homepage'),
    'cta_types', (
      SELECT jsonb_object_agg(cta_type, type_count)
      FROM (
        SELECT cta_type, COUNT(*) as type_count
        FROM cta_analysis
        WHERE organization_id = org_uuid
        GROUP BY cta_type
        ORDER BY type_count DESC
        LIMIT 10
      ) type_summary
    ),
    'placement_distribution', (
      SELECT jsonb_object_agg(placement, placement_count)
      FROM (
        SELECT placement, COUNT(*) as placement_count
        FROM cta_analysis
        WHERE organization_id = org_uuid
        GROUP BY placement
        ORDER BY placement_count DESC
      ) placement_summary
    ),
    'avg_conversion_potential', ROUND(AVG(conversion_potential), 1),
    'pages_analyzed', COUNT(DISTINCT page_url),
    'last_analyzed', MAX(scraped_at)
  ) INTO result
  FROM cta_analysis
  WHERE organization_id = org_uuid;
  
  RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_comprehensive_cta_summary(UUID) TO PUBLIC;