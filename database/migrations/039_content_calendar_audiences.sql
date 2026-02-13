-- Migration 039: Add content_ideas and content_calendar_generated_at to audiences
-- Enables 30-day content calendar storage when users subscribe to a strategy (Issue #270).

ALTER TABLE audiences ADD COLUMN IF NOT EXISTS content_ideas JSONB;
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS content_calendar_generated_at TIMESTAMP;

COMMENT ON COLUMN audiences.content_ideas IS '30-day content calendar: array of { dayNumber, title, searchIntent?, format?, keywords? } per strategy purchase';
COMMENT ON COLUMN audiences.content_calendar_generated_at IS 'When the 30-day calendar was last generated for this audience/strategy';
