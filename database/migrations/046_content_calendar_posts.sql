-- Migration 046: Track which content calendar days have been turned into blog posts
-- Used by the daily scheduler to avoid duplicate generation and to record created posts.

CREATE TABLE IF NOT EXISTS content_calendar_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_id UUID NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL CHECK (day_number >= 1 AND day_number <= 30),
  blog_post_id UUID REFERENCES blog_posts(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(audience_id, day_number)
);

CREATE INDEX IF NOT EXISTS idx_content_calendar_posts_audience_day ON content_calendar_posts(audience_id, day_number);
CREATE INDEX IF NOT EXISTS idx_content_calendar_posts_blog_post ON content_calendar_posts(blog_post_id) WHERE blog_post_id IS NOT NULL;

COMMENT ON TABLE content_calendar_posts IS 'One row per (audience, day_number) when a calendar day is claimed for generation or completed; blog_post_id set when post is saved';
