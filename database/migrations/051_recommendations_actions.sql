-- Migration 051: User recommendation dismiss/complete actions
-- Supports recommendations board: GET /api/v1/recommendations and dismiss/complete endpoints.
-- Once a user dismisses or completes a recommendation (by its stable id), it is excluded from future GET.

CREATE TABLE IF NOT EXISTS user_recommendation_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recommendation_key VARCHAR(255) NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('dismissed', 'completed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, recommendation_key)
);

CREATE INDEX IF NOT EXISTS idx_user_recommendation_actions_user
    ON user_recommendation_actions(user_id);

COMMENT ON TABLE user_recommendation_actions IS 'Tracks which recommendations a user has dismissed or completed so they are excluded from GET /api/v1/recommendations';
