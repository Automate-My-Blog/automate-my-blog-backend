-- AutoBlog Platform - Phase 4: Admin & Security Tables
-- This file creates tables for advanced admin features, security, and system configuration

-- =============================================================================
-- ADMIN & SECURITY TABLES
-- =============================================================================

-- 19. User Roles table - Define system roles and permissions
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL, -- Array of permission strings
    is_system_role BOOLEAN DEFAULT FALSE,
    hierarchy_level INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 20. Audit Logs table - Security audit trail for admin actions
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id),
    action VARCHAR(100) NOT NULL, -- 'user_created', 'billing_updated', 'content_deleted'
    resource_type VARCHAR(50), -- 'user', 'organization', 'blog_post'
    resource_id UUID,
    changes JSONB, -- Before/after values
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- SYSTEM CONFIGURATION TABLES
-- =============================================================================

-- 21. Feature Flags table - Control feature rollouts and A/B testing
CREATE TABLE feature_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    enabled BOOLEAN DEFAULT FALSE,
    user_criteria JSONB, -- Targeting rules
    rollout_percentage INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 22. API Keys table - API access management for integrations
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    key_hash VARCHAR(255) UNIQUE NOT NULL,
    permissions JSONB,
    last_used_at TIMESTAMP,
    expires_at TIMESTAMP,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- =============================================================================

-- Create triggers for tables with updated_at columns
CREATE TRIGGER update_feature_flags_updated_at BEFORE UPDATE ON feature_flags
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- INDEXES FOR ADMIN & SECURITY TABLES
-- =============================================================================

-- User roles indexes
CREATE INDEX idx_user_roles_name ON user_roles(name);
CREATE INDEX idx_user_roles_hierarchy ON user_roles(hierarchy_level);

-- Audit logs indexes
CREATE INDEX idx_audit_logs_user_created ON audit_logs(user_id, created_at);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- Feature flags indexes
CREATE INDEX idx_feature_flags_name ON feature_flags(name);
CREATE INDEX idx_feature_flags_enabled ON feature_flags(enabled);

-- API keys indexes
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_active ON api_keys(active);

-- =============================================================================
-- SEED DATA FOR USER ROLES
-- =============================================================================

-- Insert system roles with proper permissions hierarchy
INSERT INTO user_roles (name, description, permissions, is_system_role, hierarchy_level)
VALUES 
(
    'user',
    'Standard user with basic platform access',
    '["create_projects", "generate_content", "view_own_analytics", "export_content", "invite_users"]',
    TRUE,
    10
),
(
    'admin',
    'Organization admin with team management capabilities',
    '["create_projects", "generate_content", "view_own_analytics", "export_content", "invite_users", "manage_team", "view_team_analytics", "manage_billing", "manage_organization"]',
    TRUE,
    50
),
(
    'super_admin',
    'Platform super admin with full system access',
    '["create_projects", "generate_content", "view_own_analytics", "export_content", "invite_users", "manage_team", "view_team_analytics", "manage_billing", "manage_organization", "view_all_users", "manage_users", "view_platform_analytics", "manage_feature_flags", "view_audit_logs", "manage_system_settings"]',
    TRUE,
    100
);

-- =============================================================================
-- SEED DATA FOR FEATURE FLAGS
-- =============================================================================

-- Insert initial feature flags for platform management
INSERT INTO feature_flags (name, description, enabled, user_criteria, rollout_percentage)
VALUES 
(
    'advanced_analytics_dashboard',
    'Show advanced analytics dashboard to admin users',
    TRUE,
    '{"roles": ["admin", "super_admin"]}',
    100
),
(
    'referral_program',
    'Enable referral program with $15 rewards',
    TRUE,
    '{"plan_tiers": ["free", "pay_as_you_go", "starter", "pro"]}',
    100
),
(
    'beta_features',
    'Access to beta features for testing',
    FALSE,
    '{"is_internal_user": true}',
    0
),
(
    'premium_templates',
    'Access to premium content templates',
    TRUE,
    '{"plan_tiers": ["starter", "pro"]}',
    100
),
(
    'unlimited_regenerations',
    'Unlimited content regenerations',
    TRUE,
    '{"plan_tiers": ["pro"]}',
    100
);

-- =============================================================================
-- FUNCTIONS FOR AUDIT LOGGING
-- =============================================================================

-- Function to log user actions automatically
CREATE OR REPLACE FUNCTION log_user_action(
    p_user_id UUID,
    p_action VARCHAR(100),
    p_resource_type VARCHAR(50) DEFAULT NULL,
    p_resource_id UUID DEFAULT NULL,
    p_changes JSONB DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    log_id UUID;
BEGIN
    INSERT INTO audit_logs (
        user_id, action, resource_type, resource_id, 
        changes, ip_address, user_agent
    )
    VALUES (
        p_user_id, p_action, p_resource_type, p_resource_id,
        p_changes, p_ip_address, p_user_agent
    )
    RETURNING id INTO log_id;
    
    RETURN log_id;
END;
$$ LANGUAGE plpgsql;

-- Function to check user permissions
CREATE OR REPLACE FUNCTION user_has_permission(
    p_user_id UUID,
    p_permission VARCHAR(100)
)
RETURNS BOOLEAN AS $$
DECLARE
    user_role VARCHAR(50);
    role_permissions JSONB;
BEGIN
    -- Get user's role
    SELECT role INTO user_role
    FROM users 
    WHERE id = p_user_id;
    
    -- Get role permissions
    SELECT permissions INTO role_permissions
    FROM user_roles 
    WHERE name = user_role;
    
    -- Check if permission exists in role
    RETURN role_permissions ? p_permission;
END;
$$ LANGUAGE plpgsql;

-- Function to check feature flag for user
CREATE OR REPLACE FUNCTION user_has_feature(
    p_user_id UUID,
    p_feature_name VARCHAR(100)
)
RETURNS BOOLEAN AS $$
DECLARE
    flag_enabled BOOLEAN;
    user_criteria JSONB;
    user_role VARCHAR(50);
    user_plan VARCHAR(50);
    user_internal BOOLEAN;
    rollout_percent INTEGER;
    user_hash INTEGER;
BEGIN
    -- Get feature flag info
    SELECT enabled, user_criteria, rollout_percentage 
    INTO flag_enabled, user_criteria, rollout_percent
    FROM feature_flags 
    WHERE name = p_feature_name;
    
    -- If flag doesn't exist or is disabled, return false
    IF NOT FOUND OR NOT flag_enabled THEN
        RETURN FALSE;
    END IF;
    
    -- Get user info
    SELECT role, plan_tier, is_internal_user 
    INTO user_role, user_plan, user_internal
    FROM users 
    WHERE id = p_user_id;
    
    -- Check user criteria if specified
    IF user_criteria IS NOT NULL THEN
        -- Check role criteria
        IF user_criteria ? 'roles' THEN
            IF NOT (user_criteria->'roles' @> to_jsonb(user_role)) THEN
                RETURN FALSE;
            END IF;
        END IF;
        
        -- Check plan tier criteria
        IF user_criteria ? 'plan_tiers' THEN
            IF NOT (user_criteria->'plan_tiers' @> to_jsonb(user_plan)) THEN
                RETURN FALSE;
            END IF;
        END IF;
        
        -- Check internal user criteria
        IF user_criteria ? 'is_internal_user' THEN
            IF (user_criteria->>'is_internal_user')::BOOLEAN != user_internal THEN
                RETURN FALSE;
            END IF;
        END IF;
    END IF;
    
    -- Check rollout percentage
    IF rollout_percent < 100 THEN
        -- Use user ID hash for consistent rollout
        user_hash := (hashtext(p_user_id::TEXT) % 100) + 1;
        IF user_hash > rollout_percent THEN
            RETURN FALSE;
        END IF;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- VIEWS FOR ADMIN DASHBOARDS
-- =============================================================================

-- View: User management summary for admins
CREATE VIEW admin_user_summary AS
SELECT 
    u.id,
    u.email,
    u.first_name,
    u.last_name,
    u.role,
    u.plan_tier,
    u.status,
    u.created_at,
    u.last_login_at,
    COUNT(DISTINCT p.id) as total_projects,
    COUNT(DISTINCT bp.id) as total_blog_posts,
    COUNT(DISTINCT gh.id) as total_generations,
    COALESCE(SUM(ppu.total_amount), 0) as total_revenue
FROM users u
LEFT JOIN projects p ON u.id = p.user_id
LEFT JOIN blog_posts bp ON u.id = bp.user_id
LEFT JOIN generation_history gh ON u.id = gh.user_id
LEFT JOIN pay_per_use_charges ppu ON u.id = ppu.user_id
GROUP BY u.id, u.email, u.first_name, u.last_name, u.role, u.plan_tier, u.status, u.created_at, u.last_login_at;

-- View: Platform metrics summary
CREATE VIEW platform_metrics_summary AS
SELECT 
    COUNT(DISTINCT u.id) as total_users,
    COUNT(DISTINCT CASE WHEN u.plan_tier != 'free' THEN u.id END) as paid_users,
    COUNT(DISTINCT p.id) as total_projects,
    COUNT(DISTINCT bp.id) as total_blog_posts,
    COUNT(DISTINCT gh.id) as total_generations,
    COALESCE(SUM(ppu.total_amount), 0) as total_revenue,
    COUNT(DISTINCT ui.id) as total_invites_sent,
    COUNT(DISTINCT CASE WHEN ui.status = 'accepted' THEN ui.id END) as successful_referrals
FROM users u
LEFT JOIN projects p ON u.id = p.user_id
LEFT JOIN blog_posts bp ON u.id = bp.user_id  
LEFT JOIN generation_history gh ON u.id = gh.user_id
LEFT JOIN pay_per_use_charges ppu ON u.id = ppu.user_id
LEFT JOIN user_invites ui ON u.id = ui.inviter_user_id;

-- =============================================================================
-- COMMENTS FOR DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE user_roles IS 'Define system roles with hierarchical permissions for platform access control';
COMMENT ON TABLE audit_logs IS 'Security audit trail for all admin actions and sensitive operations';
COMMENT ON TABLE feature_flags IS 'Control feature rollouts and A/B testing with user targeting';
COMMENT ON TABLE api_keys IS 'API access management for third-party integrations and services';

COMMENT ON FUNCTION log_user_action IS 'Utility function to log user actions for audit trail';
COMMENT ON FUNCTION user_has_permission IS 'Check if user has specific permission based on their role';
COMMENT ON FUNCTION user_has_feature IS 'Check if user has access to specific feature flag';

COMMENT ON VIEW admin_user_summary IS 'User management summary for admin dashboard with key metrics';
COMMENT ON VIEW platform_metrics_summary IS 'High-level platform metrics for super admin dashboard';

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Phase 4 admin and security tables created successfully.';
    RAISE NOTICE 'Tables: user_roles, audit_logs, feature_flags, api_keys';
    RAISE NOTICE 'Views: admin_user_summary, platform_metrics_summary';
    RAISE NOTICE 'Functions: log_user_action(), user_has_permission(), user_has_feature()';
    RAISE NOTICE 'Inserted 3 system roles: user, admin, super_admin';
    RAISE NOTICE 'Inserted 5 feature flags: advanced_analytics, referral_program, beta_features, premium_templates, unlimited_regenerations';
END $$;