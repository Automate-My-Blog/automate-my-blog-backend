-- Migration 036: Add social_handles to organizations for brand voice discovery
-- Stores discovered or manually set social media handles (e.g. Twitter, LinkedIn, Instagram)
-- used to tailor blog post voice from social content (see docs/brand-voice-from-social-media-proposal.md).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS social_handles JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN organizations.social_handles IS 'Social media handles per platform, e.g. {"twitter":["@acme"],"linkedin":["company/acme"],"instagram":["acme"]}. Discovered from website links or set via PATCH.';

CREATE INDEX IF NOT EXISTS idx_organizations_social_handles
  ON organizations USING GIN (social_handles)
  WHERE social_handles IS NOT NULL AND social_handles != '{}'::jsonb;
