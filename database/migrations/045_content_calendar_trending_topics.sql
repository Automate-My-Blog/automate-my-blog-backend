-- Migration 045: Store trending topics used when generating content calendar
-- Enables frontend to show "Topics used for this calendar" from GET content-calendar and GET audience.

ALTER TABLE audiences ADD COLUMN IF NOT EXISTS content_calendar_trending_topics JSONB;

COMMENT ON COLUMN audiences.content_calendar_trending_topics IS 'Snapshot of trending topics (query, value) used when content_ideas was last generated; for display on frontend';
