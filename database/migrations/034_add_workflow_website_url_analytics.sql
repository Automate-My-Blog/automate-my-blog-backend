-- Migration 034: Add workflow_website_url to user_activity_events
-- Purpose: Store workflow input URL (site being analyzed) for keying/aggregation by site and funnel-by-URL
-- Date: February 2026
-- Related: Issue #202 - Analytics track by workflow URL, no 401 when logged out

-- workflow_website_url: URL the user entered in step 1 of the workflow (site they're analyzing)
ALTER TABLE user_activity_events ADD COLUMN IF NOT EXISTS workflow_website_url TEXT;

COMMENT ON COLUMN user_activity_events.workflow_website_url IS 'Workflow input URL (site being analyzed); used for aggregation by site and anonymous session keying';

CREATE INDEX IF NOT EXISTS idx_activity_events_workflow_website_url ON user_activity_events(workflow_website_url) WHERE workflow_website_url IS NOT NULL;
