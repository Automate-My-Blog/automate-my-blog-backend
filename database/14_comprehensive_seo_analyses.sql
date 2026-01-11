-- Migration 14: Comprehensive SEO Analysis System
-- Creates table for storing AI-powered comprehensive SEO analysis results
-- This supports educational, solopreneur-friendly SEO insights with detailed explanations

-- Create comprehensive_seo_analyses table
CREATE TABLE IF NOT EXISTS comprehensive_seo_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id UUID REFERENCES blog_posts(id) ON DELETE SET NULL,
  
  -- Content Identification
  content_hash VARCHAR(64) NOT NULL, -- SHA-256 for deduplication
  content_preview TEXT, -- First 200 characters for UI identification
  content_word_count INTEGER,
  
  -- Analysis Results (JSON for flexibility)
  title_analysis JSONB NOT NULL DEFAULT '{}',
  content_flow JSONB NOT NULL DEFAULT '{}',
  engagement_ux JSONB NOT NULL DEFAULT '{}',
  authority_eat JSONB NOT NULL DEFAULT '{}',
  technical_seo JSONB NOT NULL DEFAULT '{}',
  conversion_optimization JSONB NOT NULL DEFAULT '{}',
  content_depth JSONB NOT NULL DEFAULT '{}',
  mobile_accessibility JSONB NOT NULL DEFAULT '{}',
  social_sharing JSONB NOT NULL DEFAULT '{}',
  content_freshness JSONB NOT NULL DEFAULT '{}',
  competitive_differentiation JSONB NOT NULL DEFAULT '{}',
  
  -- Summary Data
  overall_score INTEGER NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  top_strengths JSONB DEFAULT '[]', -- Array of top 3 strengths with explanations
  top_improvements JSONB DEFAULT '[]', -- Array of top 3 improvement areas
  ai_summary TEXT, -- Overall assessment in solopreneur-friendly language
  
  -- Metadata
  analysis_version VARCHAR(10) NOT NULL DEFAULT 'v1.0',
  openai_model VARCHAR(50),
  analysis_duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_analyses_user_created ON comprehensive_seo_analyses(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_post ON comprehensive_seo_analyses(post_id);
CREATE INDEX IF NOT EXISTS idx_analyses_score ON comprehensive_seo_analyses(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_content_hash ON comprehensive_seo_analyses(content_hash);

-- Create unique constraint for deduplication (user can't analyze same content hash twice)
ALTER TABLE comprehensive_seo_analyses 
ADD CONSTRAINT unique_user_content UNIQUE(content_hash, user_id);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_comprehensive_seo_analyses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_comprehensive_seo_analyses_updated_at
    BEFORE UPDATE ON comprehensive_seo_analyses
    FOR EACH ROW
    EXECUTE FUNCTION update_comprehensive_seo_analyses_updated_at();

-- Add comments for documentation
COMMENT ON TABLE comprehensive_seo_analyses IS 'Stores AI-powered comprehensive SEO analysis results with educational explanations for solopreneurs';
COMMENT ON COLUMN comprehensive_seo_analyses.content_hash IS 'SHA-256 hash of content for deduplication';
COMMENT ON COLUMN comprehensive_seo_analyses.overall_score IS 'Overall SEO score from 1-100';
COMMENT ON COLUMN comprehensive_seo_analyses.title_analysis IS 'Analysis of title effectiveness, length, click-through potential, and headline hierarchy';
COMMENT ON COLUMN comprehensive_seo_analyses.content_flow IS 'Analysis of introduction effectiveness, logical progression, paragraph length, transitions, and conclusion strength';
COMMENT ON COLUMN comprehensive_seo_analyses.engagement_ux IS 'Analysis of reading level, sentence variety, active voice usage, questions, and storytelling elements';
COMMENT ON COLUMN comprehensive_seo_analyses.authority_eat IS 'Analysis of expertise demonstration, authority signals, trustworthiness indicators, and personal experience';
COMMENT ON COLUMN comprehensive_seo_analyses.technical_seo IS 'Analysis of internal linking opportunities, external link quality, featured snippet optimization, and schema markup potential';
COMMENT ON COLUMN comprehensive_seo_analyses.conversion_optimization IS 'Analysis of value proposition clarity, trust building elements, urgency creation, lead magnet potential, and email capture optimization';
COMMENT ON COLUMN comprehensive_seo_analyses.content_depth IS 'Analysis of topic coverage, competing content analysis, information gaps, unique angle, and resource completeness';
COMMENT ON COLUMN comprehensive_seo_analyses.mobile_accessibility IS 'Analysis of mobile readability, voice search optimization, accessibility considerations, and loading speed impact';
COMMENT ON COLUMN comprehensive_seo_analyses.social_sharing IS 'Analysis of shareability factors, social proof integration, visual content needs, and viral potential';
COMMENT ON COLUMN comprehensive_seo_analyses.content_freshness IS 'Analysis of evergreen potential, update requirements, seasonal relevance, and content series potential';
COMMENT ON COLUMN comprehensive_seo_analyses.competitive_differentiation IS 'Analysis of unique value adds, content gap analysis, competitive advantages, and market positioning';

-- Insert initial schema version tracking
INSERT INTO schema_versions (version, description, applied_at) 
VALUES (14, 'Comprehensive SEO Analysis System', NOW())
ON CONFLICT (version) DO NOTHING;

-- Grant permissions (assuming standard user roles exist)
GRANT SELECT, INSERT, UPDATE, DELETE ON comprehensive_seo_analyses TO authenticated_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated_user;