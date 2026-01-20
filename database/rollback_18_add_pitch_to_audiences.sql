-- Rollback Migration: Remove pitch column from audiences table
-- Date: 2026-01-20
-- Purpose: Rollback the addition of pitch column

-- Remove pitch column from audiences table
ALTER TABLE audiences
DROP COLUMN IF EXISTS pitch;
