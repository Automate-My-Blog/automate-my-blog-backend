-- Migration 038: Add 'analyze_voice_sample' to jobs.type for voice adaptation async analysis
-- Enables BullMQ worker to process voice sample analysis jobs (see GitHub issue #249).

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check CHECK (
  type IN ('website_analysis', 'content_generation', 'analyze_voice_sample')
);

COMMENT ON COLUMN jobs.type IS 'Job type: website_analysis, content_generation, analyze_voice_sample';
