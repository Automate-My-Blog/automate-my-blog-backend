-- AutoBlog Platform - Complete Database Indexes
-- This file creates all critical indexes for optimal database performance
-- Run this after creating all tables for best performance

-- =============================================================================
-- CRITICAL PERFORMANCE INDEXES
-- =============================================================================

-- Users table indexes (most frequently queried)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_btree ON users USING btree(email);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_plan_tier_status ON users(plan_tier, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_referral_code_unique ON users(referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at_desc ON users(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_last_login ON users(last_login_at DESC) WHERE last_login_at IS NOT NULL;

-- Organizations table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_owner_user_id ON organizations(owner_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_slug_unique ON organizations(slug);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_status ON organizations(status);

-- Organization members table indexes (for team queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_org_members_user_org ON organization_members(user_id, organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_org_members_org_role ON organization_members(organization_id, role);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_org_members_status ON organization_members(status);

-- Projects table indexes (content creation hub)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_user_id_created ON projects(user_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_organization_id ON projects(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_status_active ON projects(status) WHERE status = 'active';

-- Content strategies table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_strategies_project_id ON content_strategies(project_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_strategies_goal_voice ON content_strategies(goal, voice);

-- Blog posts table indexes (high-volume content)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_posts_project_user ON blog_posts(project_id, user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_posts_status_created ON blog_posts(status, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_posts_parent_version ON blog_posts(parent_post_id, version_number) WHERE parent_post_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_posts_published ON blog_posts(published_at DESC) WHERE status = 'published';

-- Content topics table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_topics_project_score ON content_topics(project_id, engagement_score DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_topics_created ON content_topics(created_at DESC);

-- =============================================================================
-- BILLING & USAGE INDEXES
-- =============================================================================

-- Plan definitions table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plan_definitions_slug_active ON plan_definitions(slug, active);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plan_definitions_display_order ON plan_definitions(display_order) WHERE active = TRUE;

-- User usage tracking table indexes (frequently updated)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_tracking_user_feature_period ON user_usage_tracking(user_id, feature_type, period_start, period_end);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_tracking_resets_at ON user_usage_tracking(resets_at) WHERE resets_at IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_tracking_bonus_source ON user_usage_tracking(bonus_source) WHERE bonus_source IS NOT NULL;

-- Subscriptions table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_period_end ON subscriptions(current_period_end) WHERE status = 'active';

-- Billing cycles table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_cycles_user_cycle ON billing_cycles(user_id, cycle_start, cycle_end);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_cycles_status_paid ON billing_cycles(status, paid_at) WHERE status != 'pending';

-- Pay per use charges table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pay_per_use_user_charged ON pay_per_use_charges(user_id, charged_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pay_per_use_feature_type ON pay_per_use_charges(feature_type, charged_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pay_per_use_billing_cycle ON pay_per_use_charges(billing_cycle_id) WHERE billing_cycle_id IS NOT NULL;

-- =============================================================================
-- REFERRAL SYSTEM INDEXES
-- =============================================================================

-- User invites table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_invites_inviter_status ON user_invites(inviter_user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_invites_code_unique ON user_invites(invite_code);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_invites_email_status ON user_invites(email, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_invites_expires_pending ON user_invites(expires_at) WHERE status = 'pending';

-- Referral rewards table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referral_rewards_user_status ON referral_rewards(user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referral_rewards_type_granted ON referral_rewards(reward_type, granted_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referral_rewards_expires ON referral_rewards(expires_at) WHERE expires_at IS NOT NULL;

-- =============================================================================
-- ANALYTICS & REPORTING INDEXES
-- =============================================================================

-- Generation history table indexes (high-volume analytics)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_history_user_created ON generation_history(user_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_history_type_success ON generation_history(type, success_status, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_history_project_created ON generation_history(project_id, created_at DESC) WHERE project_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_history_cost ON generation_history(cost_cents, created_at DESC) WHERE cost_cents IS NOT NULL;

-- User sessions table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_user_started ON user_sessions(user_id, started_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_session_id_unique ON user_sessions(session_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_duration ON user_sessions(duration_seconds DESC) WHERE duration_seconds IS NOT NULL;

-- User activity events table indexes (highest volume)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_events_user_timestamp ON user_activity_events(user_id, timestamp DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_events_session_timestamp ON user_activity_events(session_id, timestamp DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_events_type_timestamp ON user_activity_events(event_type, timestamp DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_events_funnel_step ON user_activity_events(conversion_funnel_step, timestamp DESC) WHERE conversion_funnel_step IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_events_revenue ON user_activity_events(revenue_attributed DESC) WHERE revenue_attributed > 0;

-- Daily metrics table indexes (dashboard queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_metrics_date_metric_segment ON daily_metrics(date DESC, metric_name, segment);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_metrics_metric_date ON daily_metrics(metric_name, date DESC);

-- =============================================================================
-- ADMIN & SECURITY INDEXES
-- =============================================================================

-- User roles table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_roles_name_unique ON user_roles(name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_roles_hierarchy ON user_roles(hierarchy_level DESC);

-- Audit logs table indexes (security and compliance)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_action_created ON audit_logs(action, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_created_only ON audit_logs(created_at DESC);

-- Feature flags table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feature_flags_name_unique ON feature_flags(name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feature_flags_enabled_rollout ON feature_flags(enabled, rollout_percentage) WHERE enabled = TRUE;

-- API keys table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_user_active ON api_keys(user_id, active);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_hash_unique ON api_keys(key_hash) WHERE active = TRUE;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_last_used ON api_keys(last_used_at DESC) WHERE last_used_at IS NOT NULL;

-- =============================================================================
-- COMPOSITE INDEXES FOR COMPLEX QUERIES
-- =============================================================================

-- User engagement analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_engagement_composite ON users(plan_tier, created_at, last_login_at) WHERE status = 'active';

-- Revenue reporting
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_analysis ON pay_per_use_charges(charged_at DESC, feature_type, total_amount);

-- Referral effectiveness
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referral_effectiveness ON user_invites(inviter_user_id, status, accepted_at) WHERE status = 'accepted';

-- Content performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_performance ON blog_posts(project_id, status, export_count, created_at) WHERE status != 'archived';

-- =============================================================================
-- PARTIAL INDEXES FOR EFFICIENCY
-- =============================================================================

-- Active subscriptions only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_active_subscriptions ON subscriptions(user_id, current_period_end) WHERE status = 'active';

-- Pending invites only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pending_invites ON user_invites(expires_at, inviter_user_id) WHERE status = 'pending';

-- Failed generations for debugging
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_failed_generations ON generation_history(created_at DESC, error_message) WHERE success_status = FALSE;

-- Recent activity for dashboards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recent_activity ON user_activity_events(timestamp DESC) WHERE timestamp > CURRENT_TIMESTAMP - INTERVAL '30 days';

-- =============================================================================
-- GIN INDEXES FOR JSONB COLUMNS
-- =============================================================================

-- Business analysis data search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_business_analysis_gin ON projects USING gin(business_analysis) WHERE business_analysis IS NOT NULL;

-- Feature permissions search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_roles_permissions_gin ON user_roles USING gin(permissions);

-- Feature flag criteria search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feature_flags_criteria_gin ON feature_flags USING gin(user_criteria) WHERE user_criteria IS NOT NULL;

-- Generation metadata search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_metadata_gin ON blog_posts USING gin(generation_metadata) WHERE generation_metadata IS NOT NULL;

-- Event data search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_event_data_gin ON user_activity_events USING gin(event_data) WHERE event_data IS NOT NULL;

-- =============================================================================
-- UNIQUE CONSTRAINTS AND ADDITIONAL CONSTRAINTS
-- =============================================================================

-- Ensure unique email addresses (case-insensitive)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_lower_unique ON users(LOWER(email));

-- Ensure unique organization slugs (case-insensitive)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_slug_lower_unique ON organizations(LOWER(slug));

-- Prevent duplicate organization memberships
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_org_members_unique_active ON organization_members(organization_id, user_id) WHERE status = 'active';

-- Ensure unique session IDs
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_session_unique ON user_sessions(session_id);

-- =============================================================================
-- INDEX STATISTICS AND MONITORING
-- =============================================================================

-- Create a view to monitor index usage
CREATE OR REPLACE VIEW index_usage_stats AS
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch,
    idx_scan,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes 
ORDER BY idx_scan DESC;

-- =============================================================================
-- COMMENTS AND DOCUMENTATION
-- =============================================================================

COMMENT ON VIEW index_usage_stats IS 'Monitor database index usage and performance statistics';

-- Log completion with detailed statistics
DO $$
DECLARE
    total_indexes INTEGER;
    btree_indexes INTEGER;
    gin_indexes INTEGER;
    unique_indexes INTEGER;
BEGIN
    -- Count different types of indexes
    SELECT COUNT(*) INTO total_indexes
    FROM pg_indexes 
    WHERE schemaname = 'public';
    
    SELECT COUNT(*) INTO btree_indexes
    FROM pg_indexes 
    WHERE schemaname = 'public' 
    AND indexdef LIKE '%USING btree%';
    
    SELECT COUNT(*) INTO gin_indexes
    FROM pg_indexes 
    WHERE schemaname = 'public' 
    AND indexdef LIKE '%USING gin%';
    
    SELECT COUNT(*) INTO unique_indexes
    FROM pg_indexes 
    WHERE schemaname = 'public' 
    AND indexdef LIKE '%UNIQUE%';
    
    RAISE NOTICE '=== DATABASE INDEXING COMPLETED ===';
    RAISE NOTICE 'Total indexes created: %', total_indexes;
    RAISE NOTICE 'B-tree indexes: %', btree_indexes;
    RAISE NOTICE 'GIN indexes (JSONB): %', gin_indexes;
    RAISE NOTICE 'Unique indexes: %', unique_indexes;
    RAISE NOTICE '';
    RAISE NOTICE 'Index categories:';
    RAISE NOTICE '- Performance indexes: Core table lookups and joins';
    RAISE NOTICE '- Analytics indexes: Time-series and reporting queries';
    RAISE NOTICE '- Security indexes: Audit logs and access control';
    RAISE NOTICE '- Composite indexes: Multi-column complex queries';
    RAISE NOTICE '- Partial indexes: Filtered for efficiency';
    RAISE NOTICE '- GIN indexes: JSONB column search capabilities';
    RAISE NOTICE '';
    RAISE NOTICE 'Monitor index usage with: SELECT * FROM index_usage_stats;';
    RAISE NOTICE '=====================================';
END $$;