-- Migration 15: Website Content Storage & Analysis
-- Creates tables for storing comprehensive website analysis data including blog posts, CTAs, and internal linking

-- =============================================================================
-- WEBSITE PAGES TABLE - Store discovered website content
-- =============================================================================

CREATE TABLE IF NOT EXISTS website_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  page_type VARCHAR(50) NOT NULL DEFAULT 'page' CHECK (page_type IN (
    'blog_post', 'landing_page', 'about_page', 'contact_page', 'service_page', 'product_page', 'homepage', 'page'
  )),
  title TEXT,
  content TEXT,
  meta_description TEXT,
  published_date DATE,
  author VARCHAR(255),
  word_count INTEGER,
  
  -- Link analysis data
  internal_links JSONB DEFAULT '[]'::jsonb,
  external_links JSONB DEFAULT '[]'::jsonb,
  
  -- Content structure data
  headings JSONB DEFAULT '[]'::jsonb, -- Array of heading objects with level and text
  
  -- Analysis metadata
  scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  content_hash VARCHAR(64), -- SHA-256 hash for deduplication
  analysis_quality_score INTEGER DEFAULT 0 CHECK (analysis_quality_score >= 0 AND analysis_quality_score <= 100),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint to prevent duplicate pages per organization
  CONSTRAINT unique_org_page_url UNIQUE (organization_id, url)
);

-- =============================================================================
-- CTA ANALYSIS TABLE - Store call-to-action analysis
-- =============================================================================

CREATE TABLE IF NOT EXISTS cta_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  page_url TEXT NOT NULL,
  
  -- CTA details
  cta_text TEXT NOT NULL,
  cta_type VARCHAR(50) NOT NULL CHECK (cta_type IN (
    'button', 'contact_link', 'signup_link', 'demo_link', 'trial_link', 
    'form', 'email_capture', 'cta_element', 'phone_link', 'download_link'
  )),
  placement VARCHAR(50) NOT NULL CHECK (placement IN (
    'header', 'footer', 'navigation', 'sidebar', 'main_content', 'popup', 'banner'
  )),
  
  -- CTA analysis
  href TEXT, -- Link destination if applicable
  context TEXT, -- Surrounding context for analysis
  class_name TEXT, -- CSS classes for styling analysis
  tag_name VARCHAR(20), -- HTML tag type
  
  -- Effectiveness scoring
  conversion_potential INTEGER DEFAULT 50 CHECK (conversion_potential >= 0 AND conversion_potential <= 100),
  visibility_score INTEGER DEFAULT 50 CHECK (visibility_score >= 0 AND visibility_score <= 100),
  
  -- Improvement suggestions
  improvement_suggestions JSONB DEFAULT '[]'::jsonb,
  
  -- Analysis metadata
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  analysis_confidence DECIMAL(3,2) DEFAULT 0.75 CHECK (analysis_confidence >= 0 AND analysis_confidence <= 1),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- INTERNAL LINKING ANALYSIS TABLE - Store linking structure analysis
-- =============================================================================

CREATE TABLE IF NOT EXISTS internal_linking_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  
  -- Link details
  anchor_text TEXT NOT NULL,
  link_context VARCHAR(50) CHECK (link_context IN (
    'navigation', 'footer', 'sidebar', 'content', 'breadcrumb', 'related_posts'
  )),
  link_type VARCHAR(50) CHECK (link_type IN (
    'blog', 'product', 'service', 'about', 'contact', 'page', 'category', 'tag'
  )),
  
  -- SEO analysis
  anchor_text_length INTEGER,
  is_descriptive BOOLEAN DEFAULT FALSE, -- Whether anchor text is descriptive vs generic
  seo_value INTEGER DEFAULT 50 CHECK (seo_value >= 0 AND seo_value <= 100),
  
  -- Link analysis
  link_relevance INTEGER DEFAULT 50 CHECK (link_relevance >= 0 AND link_relevance <= 100),
  user_value INTEGER DEFAULT 50 CHECK (user_value >= 0 AND user_value <= 100),
  
  -- Discovery metadata
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint to prevent duplicate link records
  CONSTRAINT unique_org_link UNIQUE (organization_id, source_url, target_url, anchor_text)
);

-- =============================================================================
-- CONTENT ANALYSIS RESULTS TABLE - Store AI-powered content analysis
-- =============================================================================

CREATE TABLE IF NOT EXISTS content_analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Analysis scope
  analysis_type VARCHAR(50) NOT NULL DEFAULT 'comprehensive' CHECK (analysis_type IN (
    'comprehensive', 'tone_analysis', 'cta_analysis', 'linking_analysis', 'content_gaps'
  )),
  pages_analyzed INTEGER DEFAULT 0,
  blog_posts_analyzed INTEGER DEFAULT 0,
  
  -- Content pattern analysis
  tone_analysis JSONB DEFAULT '{}'::jsonb, -- AI analysis of brand voice and tone
  style_patterns JSONB DEFAULT '{}'::jsonb, -- Writing style patterns
  content_themes JSONB DEFAULT '[]'::jsonb, -- Array of discovered content themes
  brand_voice_keywords JSONB DEFAULT '[]'::jsonb, -- Keywords that define brand voice
  
  -- CTA strategy analysis
  cta_strategy_analysis JSONB DEFAULT '{}'::jsonb, -- Overall CTA effectiveness and strategy
  total_ctas_found INTEGER DEFAULT 0,
  cta_recommendations JSONB DEFAULT '[]'::jsonb, -- Specific CTA improvements
  
  -- Internal linking strategy analysis
  linking_strategy_analysis JSONB DEFAULT '{}'::jsonb, -- Overall linking effectiveness
  total_internal_links INTEGER DEFAULT 0,
  linking_recommendations JSONB DEFAULT '[]'::jsonb, -- Specific linking improvements
  
  -- Content gap analysis
  content_gaps JSONB DEFAULT '[]'::jsonb, -- Missing content opportunities
  content_opportunities JSONB DEFAULT '[]'::jsonb, -- Specific content suggestions
  
  -- Analysis quality and confidence
  analysis_quality_score INTEGER DEFAULT 0 CHECK (analysis_quality_score >= 0 AND analysis_quality_score <= 100),
  confidence_score DECIMAL(3,2) DEFAULT 0.75 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  analysis_completeness INTEGER DEFAULT 0 CHECK (analysis_completeness >= 0 AND analysis_completeness <= 100),
  
  -- AI analysis metadata
  ai_model_used VARCHAR(50),
  analysis_duration_ms INTEGER,
  
  -- Raw analysis backup
  raw_analysis_data JSONB, -- Complete analysis results for debugging
  
  -- Versioning
  analysis_version INTEGER DEFAULT 1,
  is_current BOOLEAN DEFAULT TRUE,
  superseded_by UUID REFERENCES content_analysis_results(id),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- MANUAL CONTENT UPLOADS TABLE - Store manually uploaded content
-- =============================================================================

CREATE TABLE IF NOT EXISTS manual_content_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Upload details
  upload_type VARCHAR(50) NOT NULL CHECK (upload_type IN (
    'blog_posts', 'single_post', 'content_export', 'text_paste', 'file_upload'
  )),
  file_name VARCHAR(255),
  file_size INTEGER, -- Size in bytes
  file_type VARCHAR(100), -- MIME type or file extension
  
  -- Content data
  title TEXT,
  content TEXT,
  processed_content JSONB, -- Parsed and structured content
  
  -- Processing status
  processing_status VARCHAR(50) DEFAULT 'pending' CHECK (processing_status IN (
    'pending', 'processing', 'completed', 'failed', 'cancelled'
  )),
  processing_error TEXT,
  posts_extracted INTEGER DEFAULT 0,
  
  -- Analysis integration
  integrated_with_analysis BOOLEAN DEFAULT FALSE,
  analysis_contribution_score INTEGER DEFAULT 0 CHECK (analysis_contribution_score >= 0 AND analysis_contribution_score <= 100),
  
  uploaded_by UUID REFERENCES users(id), -- Track who uploaded the content
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

-- Website pages indexes
CREATE INDEX IF NOT EXISTS idx_website_pages_org_type ON website_pages(organization_id, page_type);
CREATE INDEX IF NOT EXISTS idx_website_pages_url ON website_pages(url);
CREATE INDEX IF NOT EXISTS idx_website_pages_scraped ON website_pages(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_website_pages_quality ON website_pages(analysis_quality_score DESC) WHERE analysis_quality_score > 0;
CREATE INDEX IF NOT EXISTS idx_website_pages_content_hash ON website_pages(content_hash) WHERE content_hash IS NOT NULL;

-- CTA analysis indexes
CREATE INDEX IF NOT EXISTS idx_cta_analysis_org ON cta_analysis(organization_id);
CREATE INDEX IF NOT EXISTS idx_cta_analysis_type ON cta_analysis(cta_type);
CREATE INDEX IF NOT EXISTS idx_cta_analysis_placement ON cta_analysis(placement);
CREATE INDEX IF NOT EXISTS idx_cta_analysis_potential ON cta_analysis(conversion_potential DESC);
CREATE INDEX IF NOT EXISTS idx_cta_analysis_page ON cta_analysis(page_url);

-- Internal linking analysis indexes
CREATE INDEX IF NOT EXISTS idx_internal_linking_org ON internal_linking_analysis(organization_id);
CREATE INDEX IF NOT EXISTS idx_internal_linking_source ON internal_linking_analysis(source_url);
CREATE INDEX IF NOT EXISTS idx_internal_linking_target ON internal_linking_analysis(target_url);
CREATE INDEX IF NOT EXISTS idx_internal_linking_type ON internal_linking_analysis(link_type);
CREATE INDEX IF NOT EXISTS idx_internal_linking_seo_value ON internal_linking_analysis(seo_value DESC);

-- Content analysis results indexes
CREATE INDEX IF NOT EXISTS idx_content_analysis_org ON content_analysis_results(organization_id);
CREATE INDEX IF NOT EXISTS idx_content_analysis_current ON content_analysis_results(organization_id, is_current) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS idx_content_analysis_type ON content_analysis_results(analysis_type);
CREATE INDEX IF NOT EXISTS idx_content_analysis_quality ON content_analysis_results(analysis_quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_content_analysis_created ON content_analysis_results(created_at DESC);

-- Manual content uploads indexes
CREATE INDEX IF NOT EXISTS idx_manual_uploads_org ON manual_content_uploads(organization_id);
CREATE INDEX IF NOT EXISTS idx_manual_uploads_status ON manual_content_uploads(processing_status);
CREATE INDEX IF NOT EXISTS idx_manual_uploads_uploaded ON manual_content_uploads(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_uploads_user ON manual_content_uploads(uploaded_by) WHERE uploaded_by IS NOT NULL;

-- =============================================================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS update_website_pages_updated_at 
    BEFORE UPDATE ON website_pages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER IF NOT EXISTS update_cta_analysis_updated_at 
    BEFORE UPDATE ON cta_analysis
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER IF NOT EXISTS update_internal_linking_analysis_updated_at 
    BEFORE UPDATE ON internal_linking_analysis
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER IF NOT EXISTS update_content_analysis_results_updated_at 
    BEFORE UPDATE ON content_analysis_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER IF NOT EXISTS update_manual_content_uploads_updated_at 
    BEFORE UPDATE ON manual_content_uploads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- UTILITY FUNCTIONS
-- =============================================================================

-- Function to get current website content analysis
CREATE OR REPLACE FUNCTION get_current_content_analysis(p_organization_id UUID)
RETURNS JSONB AS $$
DECLARE
    analysis_data JSONB;
BEGIN
    SELECT row_to_json(car.*) INTO analysis_data
    FROM content_analysis_results car
    WHERE car.organization_id = p_organization_id 
      AND car.is_current = TRUE
      AND car.analysis_type = 'comprehensive'
    ORDER BY car.created_at DESC
    LIMIT 1;
    
    RETURN analysis_data;
END;
$$ LANGUAGE plpgsql;

-- Function to get website content summary
CREATE OR REPLACE FUNCTION get_website_content_summary(p_organization_id UUID)
RETURNS JSONB AS $$
DECLARE
    summary_data JSONB;
BEGIN
    SELECT json_build_object(
        'total_pages', COUNT(*),
        'blog_posts', COUNT(*) FILTER (WHERE page_type = 'blog_post'),
        'landing_pages', COUNT(*) FILTER (WHERE page_type = 'landing_page'),
        'average_word_count', AVG(word_count),
        'total_internal_links', SUM(jsonb_array_length(COALESCE(internal_links, '[]'::jsonb))),
        'last_scraped', MAX(scraped_at),
        'analysis_quality', AVG(analysis_quality_score)
    ) INTO summary_data
    FROM website_pages
    WHERE organization_id = p_organization_id;
    
    RETURN summary_data;
END;
$$ LANGUAGE plpgsql;

-- Function to get CTA effectiveness summary
CREATE OR REPLACE FUNCTION get_cta_effectiveness_summary(p_organization_id UUID)
RETURNS JSONB AS $$
DECLARE
    cta_summary JSONB;
BEGIN
    SELECT json_build_object(
        'total_ctas', COUNT(*),
        'average_conversion_potential', AVG(conversion_potential),
        'cta_types', json_agg(DISTINCT cta_type),
        'placement_distribution', json_object_agg(
            placement, 
            COUNT(*) FILTER (WHERE placement = placement)
        ),
        'high_potential_ctas', COUNT(*) FILTER (WHERE conversion_potential >= 80),
        'improvement_needed', COUNT(*) FILTER (WHERE conversion_potential < 60)
    ) INTO cta_summary
    FROM cta_analysis
    WHERE organization_id = p_organization_id;
    
    RETURN cta_summary;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- VIEWS FOR COMPREHENSIVE ANALYSIS
-- =============================================================================

-- Enhanced website analysis view combining all data sources
CREATE OR REPLACE VIEW comprehensive_website_analysis_view AS
SELECT 
    o.id as organization_id,
    o.name as organization_name,
    o.website_url,
    
    -- Content summary
    get_website_content_summary(o.id) as content_summary,
    
    -- CTA analysis
    get_cta_effectiveness_summary(o.id) as cta_summary,
    
    -- Current analysis results
    get_current_content_analysis(o.id) as current_analysis,
    
    -- Manual upload status
    (SELECT COUNT(*) FROM manual_content_uploads WHERE organization_id = o.id AND processing_status = 'completed') as manual_uploads_count,
    
    -- Analysis completeness score
    CASE 
        WHEN EXISTS (SELECT 1 FROM website_pages WHERE organization_id = o.id AND page_type = 'blog_post') 
             AND EXISTS (SELECT 1 FROM cta_analysis WHERE organization_id = o.id)
             AND EXISTS (SELECT 1 FROM content_analysis_results WHERE organization_id = o.id AND is_current = TRUE)
        THEN 100
        WHEN EXISTS (SELECT 1 FROM website_pages WHERE organization_id = o.id) 
        THEN 60
        ELSE 20
    END as analysis_completeness_score,
    
    o.last_analyzed_at,
    o.updated_at
    
FROM organizations o
WHERE o.website_url IS NOT NULL
ORDER BY o.updated_at DESC;

-- =============================================================================
-- COMMENTS FOR DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE website_pages IS 'Stores discovered website content including blog posts, landing pages, and other content for analysis';
COMMENT ON TABLE cta_analysis IS 'Analysis of call-to-action elements found on website pages for conversion optimization';
COMMENT ON TABLE internal_linking_analysis IS 'Analysis of internal linking structure for SEO and user navigation optimization';
COMMENT ON TABLE content_analysis_results IS 'AI-powered analysis results including tone, style, content gaps, and strategic recommendations';
COMMENT ON TABLE manual_content_uploads IS 'Tracks manually uploaded content that supplements automated website analysis';

COMMENT ON COLUMN website_pages.content_hash IS 'SHA-256 hash of content for deduplication and change detection';
COMMENT ON COLUMN website_pages.analysis_quality_score IS 'Quality score (0-100) based on content completeness and analysis depth';
COMMENT ON COLUMN cta_analysis.conversion_potential IS 'AI-assessed conversion potential (0-100) based on text, placement, and context';
COMMENT ON COLUMN internal_linking_analysis.seo_value IS 'SEO value score (0-100) based on anchor text quality and link relevance';
COMMENT ON COLUMN content_analysis_results.analysis_completeness IS 'Percentage of analysis completed based on available data sources';

-- =============================================================================
-- GRANT PERMISSIONS
-- =============================================================================

-- Grant permissions (skip if authenticated_user role does not exist, e.g. test DB)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON website_pages TO authenticated_user';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON cta_analysis TO authenticated_user';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON internal_linking_analysis TO authenticated_user';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON content_analysis_results TO authenticated_user';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON manual_content_uploads TO authenticated_user';
    EXECUTE 'GRANT SELECT ON comprehensive_website_analysis_view TO authenticated_user';
    EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated_user';
  END IF;
END $$;

-- =============================================================================
-- INSERT SCHEMA VERSION TRACKING
-- =============================================================================

-- Schema version tracking (skip if schema_versions table does not exist, e.g. test DB)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_versions') THEN
    INSERT INTO schema_versions (version, description, applied_at) VALUES (15, 'Website Content Storage & Analysis Tables', NOW()) ON CONFLICT (version) DO NOTHING;
  END IF;
END $$;

-- =============================================================================
-- LOG COMPLETION
-- =============================================================================

DO $$
BEGIN
    RAISE NOTICE '✅ Website content storage migration completed successfully';
    RAISE NOTICE 'Tables created: website_pages, cta_analysis, internal_linking_analysis, content_analysis_results, manual_content_uploads';
    RAISE NOTICE 'Views created: comprehensive_website_analysis_view';
    RAISE NOTICE 'Functions created: get_current_content_analysis(), get_website_content_summary(), get_cta_effectiveness_summary()';
END $$;