-- Analytics Performance Indexes
-- Created: 2026-01-24
-- Purpose: Optimize queries for product analytics system

-- User Activity Events Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_activity_events_user_time
  ON user_activity_events(user_id, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_activity_events_session
  ON user_activity_events(session_id, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_activity_events_type
  ON user_activity_events(event_type, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_activity_events_funnel
  ON user_activity_events(conversion_funnel_step, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_activity_events_revenue
  ON user_activity_events(revenue_attributed)
  WHERE revenue_attributed > 0;

-- User Sessions Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_user
  ON user_sessions(user_id, started_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_duration
  ON user_sessions(duration_seconds DESC)
  WHERE duration_seconds > 0;

-- Subscriptions for Revenue Attribution
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_revenue
  ON subscriptions(status, current_period_start DESC)
  WHERE status = 'active';

-- Composite indexes for common analytics queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_activity_events_analytics
  ON user_activity_events(user_id, event_type, conversion_funnel_step, timestamp DESC);

-- Index for cohort analysis queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at
  ON users(created_at DESC);

-- Index for pay-per-use revenue queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pay_per_use_charged_at
  ON pay_per_use_charges(user_id, charged_at DESC);

-- Success message
SELECT '✅ Analytics indexes created successfully' as status;
