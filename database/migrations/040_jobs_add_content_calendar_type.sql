-- Migration 040: Add 'content_calendar' to jobs.type for 30-day calendar generation
-- Enables BullMQ worker to process content calendar jobs on strategy purchase (Issue #270).

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check CHECK (
  type IN ('website_analysis', 'content_generation', 'analyze_voice_sample', 'content_calendar')
);

COMMENT ON COLUMN jobs.type IS 'Job type: website_analysis, content_generation, analyze_voice_sample, content_calendar';
