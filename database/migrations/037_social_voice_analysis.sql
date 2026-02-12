-- Migration 037: Social voice analysis table (brand voice derived from social content)
-- See docs/brand-voice-from-social-media-proposal.md. One current row per org; history kept by is_current.

CREATE TABLE IF NOT EXISTS social_voice_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Ingested content summary (no raw posts stored long-term)
  platforms_used TEXT[] DEFAULT '{}',
  corpus_word_count INTEGER DEFAULT 0,

  -- AI-derived voice (same shape as content_analysis_results for blog merge)
  tone_analysis JSONB DEFAULT '{}'::jsonb,
  style_patterns JSONB DEFAULT '{}'::jsonb,
  brand_voice_keywords JSONB DEFAULT '[]'::jsonb,

  -- Metadata
  ai_model_used VARCHAR(50),
  analysis_duration_ms INTEGER,
  is_current BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE social_voice_analysis IS 'Brand voice derived from social media content (YouTube, etc.); used to enrich blog generation context.';

CREATE INDEX IF NOT EXISTS idx_social_voice_analysis_org ON social_voice_analysis(organization_id);
CREATE INDEX IF NOT EXISTS idx_social_voice_analysis_current ON social_voice_analysis(organization_id, is_current) WHERE is_current = TRUE;

DROP TRIGGER IF EXISTS update_social_voice_analysis_updated_at ON social_voice_analysis;
CREATE TRIGGER update_social_voice_analysis_updated_at
  BEFORE UPDATE ON social_voice_analysis
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
