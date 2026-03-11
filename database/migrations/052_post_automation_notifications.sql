-- Migration 052: Post automation status and notifications (issue #171)
-- Backend handoff for smart post automation notifications in the returning-user dashboard.
-- Tracks per-user automation state (paused, next run) and generated-post notifications (viewed/dismissed).

-- Per-user automation state (one row per user)
CREATE TABLE IF NOT EXISTS post_automation_state (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  next_run_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE post_automation_state IS 'Per-user post automation state: paused flag and next scheduled run for dashboard status line';

-- Notifications for generated-post events (e.g. content calendar draft ready)
CREATE TABLE IF NOT EXISTS post_automation_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(64) NOT NULL DEFAULT 'post_generated',
  post_id UUID REFERENCES blog_posts(id) ON DELETE SET NULL,
  viewed_at TIMESTAMP WITH TIME ZONE,
  dismissed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_automation_notifications_user_created
  ON post_automation_notifications(user_id, created_at DESC);

COMMENT ON TABLE post_automation_notifications IS 'Notifications for auto-generated posts; frontend uses postId to open draft and marks viewed on View now';
