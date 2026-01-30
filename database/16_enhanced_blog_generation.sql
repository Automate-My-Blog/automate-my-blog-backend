-- Migration 16: Enhanced Blog Generation Support
-- Creates tables and columns for manual input fallbacks and visual content generation

-- =============================================================================
-- USER MANUAL INPUTS TABLE - Store fallback data when scraping fails
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_manual_inputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Input categorization
  input_type VARCHAR(50) NOT NULL CHECK (input_type IN (
    'brand_voice', 'cta_preferences', 'internal_linking', 'brand_colors',
    'target_audience', 'business_objectives', 'competitor_info', 'industry_context'
  )),
  
  -- Structured input data
  input_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Input metadata
  input_source VARCHAR(50) DEFAULT 'manual' CHECK (input_source IN ('manual', 'imported', 'inferred')),
  confidence_score DECIMAL(3,2) DEFAULT 0.90 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  
  -- User tracking
  created_by UUID REFERENCES users(id),
  validated BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Prevent duplicate input types per organization
  CONSTRAINT unique_org_input_type UNIQUE (organization_id, input_type)
);

-- =============================================================================
-- GENERATED VISUAL CONTENT TABLE - Track AI-generated images and graphics
-- =============================================================================

CREATE TABLE IF NOT EXISTS generated_visual_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  post_id UUID REFERENCES blog_posts(id) ON DELETE SET NULL,
  
  -- Content classification
  content_type VARCHAR(50) NOT NULL CHECK (content_type IN (
    'hero_image', 'infographic', 'chart', 'diagram', 'illustration',
    'social_media', 'thumbnail', 'banner', 'icon'
  )),
  
  -- Generation details
  service_used VARCHAR(50) NOT NULL CHECK (service_used IN (
    'dalle', 'stable_diffusion', 'canva', 'quickchart', 'adobe_firefly', 'midjourney'
  )),
  generation_prompt TEXT,
  service_response JSONB, -- Raw API response for debugging
  
  -- Content metadata
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  alt_text TEXT,
  image_width INTEGER,
  image_height INTEGER,
  file_size INTEGER, -- in bytes
  file_format VARCHAR(10) DEFAULT 'jpg',
  
  -- Cost and performance tracking
  generation_cost DECIMAL(10,4) DEFAULT 0.0000,
  generation_time_ms INTEGER,
  
  -- Quality and usage metrics
  quality_score INTEGER DEFAULT 0 CHECK (quality_score >= 0 AND quality_score <= 100),
  usage_count INTEGER DEFAULT 0,
  user_rating INTEGER CHECK (user_rating >= 1 AND user_rating <= 5),
  
  -- Status tracking
  generation_status VARCHAR(20) DEFAULT 'pending' CHECK (generation_status IN (
    'pending', 'generating', 'completed', 'failed', 'deleted'
  )),
  error_message TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- ENHANCE ORGANIZATIONS TABLE - Add data availability tracking
-- =============================================================================

-- Add data availability flags to track what information we have
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS data_availability JSONB DEFAULT '{
  "has_blog_content": false,
  "has_cta_data": false,
  "has_visual_design": false,
  "has_internal_links": false,
  "has_brand_voice": false,
  "has_manual_inputs": false,
  "last_analysis_date": null,
  "completeness_score": 0
}'::jsonb;

-- Add enhanced blog generation settings
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS blog_generation_settings JSONB DEFAULT '{
  "target_seo_score": 95,
  "include_visuals": true,
  "visual_style_preference": "professional",
  "cta_placement_preference": "contextual",
  "internal_linking_strategy": "relevant",
  "tone_enforcement": "strict"
}'::jsonb;

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

-- User manual inputs indexes
CREATE INDEX IF NOT EXISTS idx_manual_inputs_org ON user_manual_inputs(organization_id);
CREATE INDEX IF NOT EXISTS idx_manual_inputs_type ON user_manual_inputs(input_type);
CREATE INDEX IF NOT EXISTS idx_manual_inputs_source ON user_manual_inputs(input_source);
CREATE INDEX IF NOT EXISTS idx_manual_inputs_created ON user_manual_inputs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_inputs_user ON user_manual_inputs(created_by) WHERE created_by IS NOT NULL;

-- Generated visual content indexes
CREATE INDEX IF NOT EXISTS idx_visual_content_org ON generated_visual_content(organization_id);
CREATE INDEX IF NOT EXISTS idx_visual_content_post ON generated_visual_content(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visual_content_type ON generated_visual_content(content_type);
CREATE INDEX IF NOT EXISTS idx_visual_content_service ON generated_visual_content(service_used);
CREATE INDEX IF NOT EXISTS idx_visual_content_status ON generated_visual_content(generation_status);
CREATE INDEX IF NOT EXISTS idx_visual_content_cost ON generated_visual_content(generation_cost DESC) WHERE generation_cost > 0;
CREATE INDEX IF NOT EXISTS idx_visual_content_quality ON generated_visual_content(quality_score DESC) WHERE quality_score > 0;
CREATE INDEX IF NOT EXISTS idx_visual_content_created ON generated_visual_content(created_at DESC);

-- Organizations enhanced indexes
CREATE INDEX IF NOT EXISTS idx_organizations_data_availability ON organizations USING GIN (data_availability) WHERE data_availability IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_blog_settings ON organizations USING GIN (blog_generation_settings) WHERE blog_generation_settings IS NOT NULL;

-- =============================================================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS update_user_manual_inputs_updated_at 
    BEFORE UPDATE ON user_manual_inputs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER IF NOT EXISTS update_generated_visual_content_updated_at 
    BEFORE UPDATE ON generated_visual_content
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- UTILITY FUNCTIONS
-- =============================================================================

-- Function to get manual inputs for an organization
CREATE OR REPLACE FUNCTION get_organization_manual_inputs(p_organization_id UUID)
RETURNS JSONB AS $$
DECLARE
    inputs_data JSONB;
BEGIN
    SELECT json_object_agg(input_type, input_data) INTO inputs_data
    FROM user_manual_inputs
    WHERE organization_id = p_organization_id
      AND validated = TRUE;
    
    RETURN COALESCE(inputs_data, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- Function to update data availability flags
CREATE OR REPLACE FUNCTION update_organization_data_availability(p_organization_id UUID)
RETURNS JSONB AS $$
DECLARE
    availability JSONB;
    has_blog BOOLEAN;
    has_ctas BOOLEAN;
    has_visual BOOLEAN;
    has_links BOOLEAN;
    has_manual BOOLEAN;
    completeness INTEGER;
BEGIN
    -- Check for blog content
    SELECT EXISTS(
        SELECT 1 FROM website_pages 
        WHERE organization_id = p_organization_id 
          AND page_type = 'blog_post' 
          AND content IS NOT NULL
    ) INTO has_blog;
    
    -- Check for CTA data
    SELECT EXISTS(
        SELECT 1 FROM cta_analysis 
        WHERE organization_id = p_organization_id
    ) INTO has_ctas;
    
    -- Check for visual design (placeholder - would need actual visual analysis)
    SELECT has_blog INTO has_visual; -- Simplified for now
    
    -- Check for internal links
    SELECT EXISTS(
        SELECT 1 FROM internal_linking_analysis 
        WHERE organization_id = p_organization_id
    ) INTO has_links;
    
    -- Check for manual inputs
    SELECT EXISTS(
        SELECT 1 FROM user_manual_inputs 
        WHERE organization_id = p_organization_id
          AND validated = TRUE
    ) INTO has_manual;
    
    -- Calculate completeness score (0-100)
    completeness := (
        (CASE WHEN has_blog THEN 25 ELSE 0 END) +
        (CASE WHEN has_ctas THEN 20 ELSE 0 END) +
        (CASE WHEN has_visual THEN 20 ELSE 0 END) +
        (CASE WHEN has_links THEN 15 ELSE 0 END) +
        (CASE WHEN has_manual THEN 20 ELSE 0 END)
    );
    
    -- Build availability object
    availability := json_build_object(
        'has_blog_content', has_blog,
        'has_cta_data', has_ctas,
        'has_visual_design', has_visual,
        'has_internal_links', has_links,
        'has_manual_inputs', has_manual,
        'last_analysis_date', NOW(),
        'completeness_score', completeness
    );
    
    -- Update organization record
    UPDATE organizations 
    SET data_availability = availability
    WHERE id = p_organization_id;
    
    RETURN availability;
END;
$$ LANGUAGE plpgsql;

-- Function to get visual content summary for an organization
CREATE OR REPLACE FUNCTION get_visual_content_summary(p_organization_id UUID)
RETURNS JSONB AS $$
DECLARE
    summary_data JSONB;
BEGIN
    SELECT json_build_object(
        'total_generated', COUNT(*),
        'by_type', json_object_agg(
            content_type, 
            COUNT(*) FILTER (WHERE content_type = content_type)
        ),
        'total_cost', SUM(generation_cost),
        'average_quality', AVG(quality_score) FILTER (WHERE quality_score > 0),
        'most_used_service', MODE() WITHIN GROUP (ORDER BY service_used),
        'generation_success_rate', 
            COUNT(*) FILTER (WHERE generation_status = 'completed')::DECIMAL / 
            NULLIF(COUNT(*), 0) * 100
    ) INTO summary_data
    FROM generated_visual_content
    WHERE organization_id = p_organization_id;
    
    RETURN summary_data;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- VIEWS FOR ENHANCED ANALYSIS
-- =============================================================================

-- Enhanced organization view with manual inputs and visual content
CREATE OR REPLACE VIEW enhanced_organization_view AS
SELECT 
    o.id,
    o.name,
    o.website_url,
    o.data_availability,
    o.blog_generation_settings,
    
    -- Manual inputs summary
    get_organization_manual_inputs(o.id) as manual_inputs,
    
    -- Visual content summary
    get_visual_content_summary(o.id) as visual_content_summary,
    
    -- Data completeness indicator
    (o.data_availability->>'completeness_score')::INTEGER as completeness_score,
    
    o.created_at,
    o.updated_at
    
FROM organizations o
ORDER BY o.updated_at DESC;

-- =============================================================================
-- COMMENTS FOR DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE user_manual_inputs IS 'Stores manual input data when automated scraping fails to find required information';
COMMENT ON TABLE generated_visual_content IS 'Tracks AI-generated visual content including images, infographics, and charts';

COMMENT ON COLUMN user_manual_inputs.input_type IS 'Type of manual input: brand_voice, cta_preferences, etc.';
COMMENT ON COLUMN user_manual_inputs.input_data IS 'Structured JSON data for the specific input type';
COMMENT ON COLUMN user_manual_inputs.confidence_score IS 'Confidence in the input data quality (0.0-1.0)';

COMMENT ON COLUMN generated_visual_content.service_used IS 'AI service used for generation: dalle, stable_diffusion, canva, etc.';
COMMENT ON COLUMN generated_visual_content.generation_cost IS 'Cost in USD for generating this content';
COMMENT ON COLUMN generated_visual_content.quality_score IS 'AI-assessed quality score (0-100)';

COMMENT ON COLUMN organizations.data_availability IS 'Flags indicating what analysis data is available for blog generation';
COMMENT ON COLUMN organizations.blog_generation_settings IS 'User preferences for blog generation including SEO targets and visual preferences';

-- =============================================================================
-- GRANT PERMISSIONS
-- =============================================================================

-- Grant permissions (assuming standard user roles exist)
GRANT SELECT, INSERT, UPDATE, DELETE ON user_manual_inputs TO authenticated_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON generated_visual_content TO authenticated_user;
GRANT SELECT ON enhanced_organization_view TO authenticated_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated_user;

-- =============================================================================
-- INSERT SCHEMA VERSION TRACKING
-- =============================================================================

-- Schema version tracking (skip if schema_versions table does not exist, e.g. test DB)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_versions') THEN
    INSERT INTO schema_versions (version, description, applied_at) VALUES (16, 'Enhanced Blog Generation: Manual Inputs & Visual Content', NOW()) ON CONFLICT (version) DO NOTHING;
  END IF;
END $$;

-- =============================================================================
-- LOG COMPLETION
-- =============================================================================

DO $$
BEGIN
    RAISE NOTICE '✅ Enhanced blog generation migration completed successfully';
    RAISE NOTICE 'Tables created: user_manual_inputs, generated_visual_content';
    RAISE NOTICE 'Columns added: organizations.data_availability, organizations.blog_generation_settings';
    RAISE NOTICE 'Views created: enhanced_organization_view';
    RAISE NOTICE 'Functions created: get_organization_manual_inputs(), update_organization_data_availability(), get_visual_content_summary()';
END $$;