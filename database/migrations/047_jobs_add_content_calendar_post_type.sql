-- Migration 047: Add 'content_calendar_post' to jobs.type for scheduled calendar post generation

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check CHECK (
  type IN ('website_analysis', 'content_generation', 'analyze_voice_sample', 'content_calendar', 'content_calendar_post')
);

COMMENT ON COLUMN jobs.type IS 'Job type: website_analysis, content_generation, analyze_voice_sample, content_calendar, content_calendar_post';
