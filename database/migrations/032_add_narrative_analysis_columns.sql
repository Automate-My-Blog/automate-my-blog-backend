-- Migration 032: Add narrative analysis columns to organization_intelligence
-- Purpose: Support GET /api/v1/analysis/recent and narrative pipeline (run by CI setup-test-db.sh)
-- Matches migrations/add-narrative-analysis.js for parity

ALTER TABLE organization_intelligence
  ADD COLUMN IF NOT EXISTS narrative_analysis TEXT,
  ADD COLUMN IF NOT EXISTS narrative_confidence DECIMAL(3,2) DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS key_insights JSONB;

CREATE INDEX IF NOT EXISTS idx_org_intelligence_narrative
  ON organization_intelligence(organization_id)
  WHERE narrative_analysis IS NOT NULL;
