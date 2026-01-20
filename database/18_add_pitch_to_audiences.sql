-- Migration: Add pitch column to audiences table
-- Date: 2026-01-20
-- Purpose: Store OpenAI-generated agency pitch for audience strategies

-- Add pitch column to audiences table
ALTER TABLE audiences
ADD COLUMN pitch TEXT;

-- Add comment for documentation
COMMENT ON COLUMN audiences.pitch IS 'OpenAI-generated professional business case explaining why this audience is strategically valuable (2-3 sentences, max 280 chars)';
