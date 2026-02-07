-- Migration 035: Organization analysis confirm and edit tracking (Issue #261)
-- Purpose: Support guided funnel "Confirm & Continue" and "Edit" flow
-- Add analysis_confirmed_at, analysis_edited, edited_fields to organizations

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS analysis_confirmed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS analysis_edited BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS edited_fields JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN organizations.analysis_confirmed_at IS 'When user confirmed analysis in guided funnel (Confirm & Continue)';
COMMENT ON COLUMN organizations.analysis_edited IS 'Whether user edited analysis fields before confirming';
COMMENT ON COLUMN organizations.edited_fields IS 'List of field names user edited (e.g. ["businessName","targetAudience"])';
