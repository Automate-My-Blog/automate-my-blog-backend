-- Migration 037: Voice & Style Adaptation – voice_samples, aggregated_voice_profiles, org settings
-- Enables users to upload content samples for AI voice/style analysis (see GitHub issue #244, #245).
-- Dependencies: organizations (01_core_tables), users (01_core_tables).

-- =============================================================================
-- VOICE SAMPLES TABLE – User-uploaded content for voice analysis
-- =============================================================================

CREATE TABLE IF NOT EXISTS voice_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Source metadata
  source_type VARCHAR(50) NOT NULL CHECK (source_type IN (
    'blog_post', 'whitepaper', 'email', 'newsletter', 'social_post', 'call_summary', 'other_document'
  )),
  file_name VARCHAR(500),
  file_size_bytes INTEGER,
  source_url TEXT,

  -- Content (extracted text)
  title TEXT,
  raw_content TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),

  -- Analysis results (populated by VoiceAnalyzerService)
  style_analysis JSONB DEFAULT '{}'::jsonb,
  vocabulary_analysis JSONB DEFAULT '{}'::jsonb,
  structural_patterns JSONB DEFAULT '{}'::jsonb,
  formatting_preferences JSONB DEFAULT '{}'::jsonb,

  -- Quality & status
  quality_score INTEGER CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 100)),
  processing_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (processing_status IN (
    'pending', 'processing', 'completed', 'failed'
  )),
  error_message TEXT,

  -- Weight for aggregation (higher = more influence)
  weight DECIMAL(3,2) NOT NULL DEFAULT 1.0 CHECK (weight > 0 AND weight <= 5.0),

  -- Metadata
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE voice_samples IS 'User-uploaded content samples (blog, email, whitepaper, etc.) for voice/style analysis';
COMMENT ON COLUMN voice_samples.source_type IS 'Content type: blog_post, whitepaper, email, newsletter, social_post, call_summary, other_document';
COMMENT ON COLUMN voice_samples.processing_status IS 'pending → processing → completed | failed';
COMMENT ON COLUMN voice_samples.weight IS 'Influence in aggregation (1.0–5.0)';

CREATE INDEX IF NOT EXISTS idx_voice_samples_organization_id ON voice_samples(organization_id);
CREATE INDEX IF NOT EXISTS idx_voice_samples_processing_status ON voice_samples(processing_status);
CREATE INDEX IF NOT EXISTS idx_voice_samples_org_active ON voice_samples(organization_id, is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_voice_samples_created_at ON voice_samples(created_at DESC);

-- =============================================================================
-- AGGREGATED VOICE PROFILES TABLE – One per organization, used in blog generation
-- =============================================================================

CREATE TABLE IF NOT EXISTS aggregated_voice_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,

  -- Aggregated analysis (weighted blend of all active completed samples)
  style JSONB NOT NULL DEFAULT '{}'::jsonb,
  vocabulary JSONB NOT NULL DEFAULT '{}'::jsonb,
  structure JSONB NOT NULL DEFAULT '{}'::jsonb,
  formatting JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Metadata
  sample_count INTEGER NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  total_word_count INTEGER NOT NULL DEFAULT 0 CHECK (total_word_count >= 0),
  confidence_score INTEGER NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 100),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE aggregated_voice_profiles IS 'One row per org: aggregated voice/style profile from voice_samples';
COMMENT ON COLUMN aggregated_voice_profiles.confidence_score IS '0–100; used to gate inclusion in blog prompts (e.g. >= 50)';

CREATE UNIQUE INDEX IF NOT EXISTS idx_aggregated_voice_profiles_org ON aggregated_voice_profiles(organization_id);

-- =============================================================================
-- ORGANIZATIONS – voice_adaptation_settings and data_availability extension
-- =============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS voice_adaptation_settings JSONB DEFAULT '{
    "enabled": true,
    "min_samples_required": 1,
    "adaptation_strength": 1.0,
    "confidence_threshold": 50
  }'::jsonb;

COMMENT ON COLUMN organizations.voice_adaptation_settings IS 'Voice adaptation: enabled, min_samples_required, adaptation_strength, confidence_threshold';

-- data_availability is existing JSONB; we add keys via the function below.
-- New keys: has_voice_samples (boolean), last_voice_profile_at (timestamp, optional).

-- =============================================================================
-- UPDATE update_organization_data_availability – include voice samples
-- =============================================================================

CREATE OR REPLACE FUNCTION update_organization_data_availability(p_organization_id UUID)
RETURNS JSONB AS $$
DECLARE
  availability JSONB;
  has_blog BOOLEAN;
  has_ctas BOOLEAN;
  has_visual BOOLEAN;
  has_links BOOLEAN;
  has_manual BOOLEAN;
  has_voice BOOLEAN;
  last_voice_at TIMESTAMP WITH TIME ZONE;
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

  SELECT has_blog INTO has_visual;

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

  -- Check for voice profile (aggregated profile exists with at least one completed sample)
  SELECT EXISTS(
    SELECT 1 FROM aggregated_voice_profiles avp
    WHERE avp.organization_id = p_organization_id
      AND avp.sample_count > 0
      AND avp.confidence_score > 0
  ) INTO has_voice;

  SELECT MAX(updated_at) INTO last_voice_at
  FROM aggregated_voice_profiles
  WHERE organization_id = p_organization_id;

  -- Completeness: existing components sum to 100; voice adds up to 15, cap at 100
  completeness := LEAST(100,
    (CASE WHEN has_blog THEN 25 ELSE 0 END) +
    (CASE WHEN has_ctas THEN 20 ELSE 0 END) +
    (CASE WHEN has_visual THEN 20 ELSE 0 END) +
    (CASE WHEN has_links THEN 15 ELSE 0 END) +
    (CASE WHEN has_manual THEN 20 ELSE 0 END) +
    (CASE WHEN has_voice THEN 15 ELSE 0 END)
  );

  availability := json_build_object(
    'has_blog_content', has_blog,
    'has_cta_data', has_ctas,
    'has_visual_design', has_visual,
    'has_internal_links', has_links,
    'has_manual_inputs', has_manual,
    'has_voice_samples', has_voice,
    'last_analysis_date', NOW(),
    'last_voice_profile_at', last_voice_at,
    'completeness_score', completeness
  );

  UPDATE organizations
  SET data_availability = availability
  WHERE id = p_organization_id;

  RETURN availability;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- TRIGGERS: updated_at (uses existing update_updated_at_column from 01_core_tables)
-- =============================================================================

DROP TRIGGER IF EXISTS update_voice_samples_updated_at ON voice_samples;
CREATE TRIGGER update_voice_samples_updated_at
  BEFORE UPDATE ON voice_samples
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_aggregated_voice_profiles_updated_at ON aggregated_voice_profiles;
CREATE TRIGGER update_aggregated_voice_profiles_updated_at
  BEFORE UPDATE ON aggregated_voice_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
