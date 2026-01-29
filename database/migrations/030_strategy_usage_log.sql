-- Migration: Add strategy usage logging table
-- Created: 2026-01-28
-- Description: Tracks post generation usage per strategy subscription
--              for quota enforcement and analytics

CREATE TABLE IF NOT EXISTS strategy_usage_log (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  purchase_id INTEGER REFERENCES strategy_purchases(id) ON DELETE SET NULL,

  -- Usage Details
  action VARCHAR(50) NOT NULL, -- 'topic_generation', 'content_generation', etc.
  posts_decremented INTEGER DEFAULT 0,

  -- Context (optional JSON for additional metadata)
  context JSONB,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX idx_strategy_usage_log_user_date ON strategy_usage_log(user_id, created_at DESC);
CREATE INDEX idx_strategy_usage_log_strategy_date ON strategy_usage_log(strategy_id, created_at DESC);
CREATE INDEX idx_strategy_usage_log_purchase ON strategy_usage_log(purchase_id);
CREATE INDEX idx_strategy_usage_log_action ON strategy_usage_log(action);

-- Add comments for documentation
COMMENT ON TABLE strategy_usage_log IS 'Tracks all strategy subscription usage for quota enforcement and analytics';
COMMENT ON COLUMN strategy_usage_log.action IS 'Type of action: topic_generation, content_generation, etc.';
COMMENT ON COLUMN strategy_usage_log.posts_decremented IS 'Number of posts deducted from subscription quota (typically 1)';
COMMENT ON COLUMN strategy_usage_log.context IS 'Optional JSON metadata: post_id, title, keywords, etc.';
