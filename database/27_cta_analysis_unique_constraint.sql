-- Migration 27: Unique constraint on cta_analysis for ON CONFLICT support
-- Used by website-analysis pipeline and legacy analyze-website flow.
-- Safe to run idempotently.

DO $$
BEGIN
  ALTER TABLE cta_analysis
  ADD CONSTRAINT cta_analysis_org_page_text_placement_key
  UNIQUE (organization_id, page_url, cta_text, placement);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
