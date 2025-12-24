-- AutoBlog Platform - Phase 3: Referral System & Analytics Tables
-- This file creates tables for referral system and comprehensive analytics

-- =============================================================================
-- REFERRAL SYSTEM TABLES
-- =============================================================================

-- 13. User Invites table - Manage referral invitations and tracking
CREATE TABLE user_invites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inviter_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255),
    invite_code VARCHAR(20) UNIQUE NOT NULL,
    invite_type VARCHAR(50) DEFAULT 'referral' CHECK (invite_type IN ('referral', 'organization_member', 'beta_access')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
    expires_at TIMESTAMP NOT NULL,
    sent_at TIMESTAMP,
    accepted_at TIMESTAMP,
    accepted_by_user_id UUID REFERENCES users(id),
    reward_granted_to_inviter BOOLEAN DEFAULT FALSE,
    reward_granted_to_invitee BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 14. Referral Rewards table - Track and manage referral rewards
CREATE TABLE referral_rewards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    earned_from_invite_id UUID REFERENCES user_invites(id),
    reward_type VARCHAR(50) NOT NULL, -- 'free_generation', 'bonus_strategies', 'month_free'
    reward_value DECIMAL(10,2), -- Monetary value for tracking ($15 for free generation)
    quantity INTEGER DEFAULT 1, -- For non-monetary rewards
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'used', 'expired')),
    granted_at TIMESTAMP,
    expires_at TIMESTAMP,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- ANALYTICS & REPORTING TABLES
-- =============================================================================

-- 15. Generation History table - Comprehensive log of all AI generation requests
CREATE TABLE generation_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id),
    project_id UUID REFERENCES projects(id),
    type VARCHAR(50) NOT NULL, -- 'website_analysis', 'trending_topics', 'blog_content', 'regeneration'
    input_data JSONB, -- Request parameters
    output_data JSONB, -- Generated content (truncated for privacy)
    tokens_used INTEGER,
    duration_ms INTEGER,
    cost_cents INTEGER,
    success_status BOOLEAN NOT NULL,
    error_message TEXT,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 16. User Sessions table - Track user session behavior and engagement
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id VARCHAR(100) UNIQUE NOT NULL,
    started_at TIMESTAMP NOT NULL,
    ended_at TIMESTAMP,
    duration_seconds INTEGER,
    ip_address INET,
    user_agent TEXT,
    device_type VARCHAR(50),
    browser VARCHAR(100),
    country VARCHAR(100),
    city VARCHAR(100),
    pages_visited INTEGER DEFAULT 0,
    actions_performed INTEGER DEFAULT 0,
    last_activity_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 17. User Activity Events table - Detailed event tracking for conversion analysis
CREATE TABLE user_activity_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id VARCHAR(100),
    event_type VARCHAR(100) NOT NULL, -- 'signup', 'login', 'website_analysis', 'content_generation', etc.
    event_data JSONB,
    page_url TEXT,
    referrer TEXT,
    utm_source VARCHAR(100),
    utm_medium VARCHAR(100),
    utm_campaign VARCHAR(100),
    conversion_funnel_step VARCHAR(100),
    revenue_attributed DECIMAL(10,2),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 18. Daily Metrics table - Aggregated daily platform metrics for dashboards
CREATE TABLE daily_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(15,2) NOT NULL,
    segment VARCHAR(100), -- 'all', 'free_users', 'paid_users', etc.
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, metric_name, segment)
);

-- =============================================================================
-- INDEXES FOR REFERRAL TABLES
-- =============================================================================

-- User invites indexes
CREATE INDEX idx_user_invites_inviter ON user_invites(inviter_user_id);
CREATE INDEX idx_user_invites_code ON user_invites(invite_code);
CREATE INDEX idx_user_invites_email ON user_invites(email);
CREATE INDEX idx_user_invites_status ON user_invites(status);
CREATE INDEX idx_user_invites_expires ON user_invites(expires_at);

-- Referral rewards indexes
CREATE INDEX idx_referral_rewards_user_id ON referral_rewards(user_id);
CREATE INDEX idx_referral_rewards_invite_id ON referral_rewards(earned_from_invite_id);
CREATE INDEX idx_referral_rewards_status ON referral_rewards(status);
CREATE INDEX idx_referral_rewards_type ON referral_rewards(reward_type);

-- =============================================================================
-- INDEXES FOR ANALYTICS TABLES
-- =============================================================================

-- Generation history indexes
CREATE INDEX idx_generation_history_user_created ON generation_history(user_id, created_at);
CREATE INDEX idx_generation_history_type ON generation_history(type);
CREATE INDEX idx_generation_history_project ON generation_history(project_id);
CREATE INDEX idx_generation_history_success ON generation_history(success_status);

-- User sessions indexes
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_session_id ON user_sessions(session_id);
CREATE INDEX idx_user_sessions_started_at ON user_sessions(started_at);

-- User activity events indexes
CREATE INDEX idx_activity_events_user_id ON user_activity_events(user_id);
CREATE INDEX idx_activity_events_session_id ON user_activity_events(session_id);
CREATE INDEX idx_activity_events_event_type ON user_activity_events(event_type);
CREATE INDEX idx_activity_events_timestamp ON user_activity_events(timestamp);
CREATE INDEX idx_activity_events_funnel ON user_activity_events(conversion_funnel_step);

-- Daily metrics indexes
CREATE INDEX idx_daily_metrics_date_metric ON daily_metrics(date, metric_name);
CREATE INDEX idx_daily_metrics_segment ON daily_metrics(segment);

-- =============================================================================
-- FUNCTIONS FOR REFERRAL SYSTEM
-- =============================================================================

-- Function to generate unique referral codes
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS VARCHAR(20) AS $$
DECLARE
    new_code VARCHAR(20);
    code_exists BOOLEAN;
BEGIN
    LOOP
        -- Generate a random 8-character alphanumeric code
        new_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
        
        -- Check if code already exists
        SELECT EXISTS(SELECT 1 FROM users WHERE referral_code = new_code) INTO code_exists;
        
        -- If code doesn't exist, break the loop
        IF NOT code_exists THEN
            EXIT;
        END IF;
    END LOOP;
    
    RETURN new_code;
END;
$$ LANGUAGE plpgsql;

-- Function to generate unique invite codes
CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS VARCHAR(20) AS $$
DECLARE
    new_code VARCHAR(20);
    code_exists BOOLEAN;
BEGIN
    LOOP
        -- Generate a random 12-character alphanumeric code for invites
        new_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 12));
        
        -- Check if code already exists
        SELECT EXISTS(SELECT 1 FROM user_invites WHERE invite_code = new_code) INTO code_exists;
        
        -- If code doesn't exist, break the loop
        IF NOT code_exists THEN
            EXIT;
        END IF;
    END LOOP;
    
    RETURN new_code;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- TRIGGERS FOR AUTOMATIC CODE GENERATION
-- =============================================================================

-- Trigger to auto-generate referral code for new users
CREATE OR REPLACE FUNCTION auto_generate_referral_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.referral_code IS NULL THEN
        NEW.referral_code := generate_referral_code();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_referral_code 
    BEFORE INSERT ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION auto_generate_referral_code();

-- Trigger to auto-generate invite code for new invites
CREATE OR REPLACE FUNCTION auto_generate_invite_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.invite_code IS NULL THEN
        NEW.invite_code := generate_invite_code();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_invite_code 
    BEFORE INSERT ON user_invites 
    FOR EACH ROW 
    EXECUTE FUNCTION auto_generate_invite_code();

-- =============================================================================
-- VIEWS FOR ANALYTICS DASHBOARDS
-- =============================================================================

-- View: User engagement metrics
CREATE VIEW user_engagement_summary AS
SELECT 
    u.id as user_id,
    u.email,
    u.plan_tier,
    u.created_at as signup_date,
    COUNT(DISTINCT us.id) as total_sessions,
    AVG(us.duration_seconds) as avg_session_duration,
    COUNT(DISTINCT gh.id) as total_generations,
    COUNT(DISTINCT p.id) as total_projects,
    MAX(u.last_login_at) as last_activity
FROM users u
LEFT JOIN user_sessions us ON u.id = us.user_id
LEFT JOIN generation_history gh ON u.id = gh.user_id
LEFT JOIN projects p ON u.id = p.user_id
GROUP BY u.id, u.email, u.plan_tier, u.created_at;

-- View: Referral program metrics
CREATE VIEW referral_program_summary AS
SELECT 
    u.id as user_id,
    u.email,
    u.referral_code,
    u.total_referrals_made,
    u.successful_referrals,
    u.lifetime_referral_rewards_earned,
    COUNT(ui.id) as invites_sent,
    COUNT(CASE WHEN ui.status = 'accepted' THEN 1 END) as invites_accepted,
    COUNT(rr.id) as total_rewards_earned,
    SUM(rr.reward_value) as total_reward_value
FROM users u
LEFT JOIN user_invites ui ON u.id = ui.inviter_user_id
LEFT JOIN referral_rewards rr ON u.id = rr.user_id
GROUP BY u.id, u.email, u.referral_code, u.total_referrals_made, u.successful_referrals, u.lifetime_referral_rewards_earned;

-- =============================================================================
-- COMMENTS FOR DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE user_invites IS 'Manage referral invitations with unique codes and tracking';
COMMENT ON TABLE referral_rewards IS 'Track and manage referral rewards worth $15 per successful referral';
COMMENT ON TABLE generation_history IS 'Comprehensive log of all AI generation requests for analytics';
COMMENT ON TABLE user_sessions IS 'Track user session behavior and engagement metrics';
COMMENT ON TABLE user_activity_events IS 'Detailed event tracking for conversion funnel analysis';
COMMENT ON TABLE daily_metrics IS 'Aggregated daily platform metrics for admin dashboards';

COMMENT ON VIEW user_engagement_summary IS 'User engagement metrics for admin analytics dashboard';
COMMENT ON VIEW referral_program_summary IS 'Referral program performance metrics for admin dashboard';

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Phase 3 referral and analytics tables created successfully.';
    RAISE NOTICE 'Tables: user_invites, referral_rewards, generation_history, user_sessions, user_activity_events, daily_metrics';
    RAISE NOTICE 'Views: user_engagement_summary, referral_program_summary';
    RAISE NOTICE 'Functions: generate_referral_code(), generate_invite_code()';
END $$;