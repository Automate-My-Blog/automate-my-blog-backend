-- AutoBlog Platform - Phase 1: Core Database Tables
-- This file creates the fundamental tables needed for MVP functionality
-- Safe to run without affecting the current application (uses in-memory storage)

-- Enable UUID extension for PostgreSQL
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- CORE ENTITY TABLES
-- =============================================================================

-- 1. Users table - Core user accounts with authentication and profile information
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
    plan_tier VARCHAR(50) DEFAULT 'free' CHECK (plan_tier IN ('free', 'pay_as_you_go', 'starter', 'pro')),
    referral_code VARCHAR(20) UNIQUE,
    email_verified_at TIMESTAMP,
    last_login_at TIMESTAMP,
    timezone VARCHAR(50) DEFAULT 'UTC',
    language VARCHAR(10) DEFAULT 'en',
    trial_ends_at TIMESTAMP,
    plan_started_at TIMESTAMP,
    usage_reset_date DATE,
    total_referrals_made INTEGER DEFAULT 0,
    successful_referrals INTEGER DEFAULT 0,
    lifetime_referral_rewards_earned DECIMAL(10,2) DEFAULT 0.00,
    is_internal_user BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Organizations table - Multi-user workspaces for teams and businesses
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    billing_email VARCHAR(255),
    tax_id VARCHAR(100),
    address_data JSONB,
    plan_tier VARCHAR(50) DEFAULT 'free',
    seat_limit INTEGER DEFAULT 1,
    custom_branding JSONB,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Organization Members table - User membership in organizations with role-based permissions
CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    permissions JSONB,
    invited_by UUID REFERENCES users(id),
    joined_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, user_id)
);

-- =============================================================================
-- CONTENT MANAGEMENT TABLES
-- =============================================================================

-- 4. Projects table - Individual websites/brands that users analyze and create content for
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    website_url VARCHAR(500),
    business_analysis JSONB, -- Stores website analysis results
    brand_colors JSONB, -- Primary, secondary, accent colors
    target_audience TEXT,
    content_focus TEXT,
    brand_voice VARCHAR(100),
    business_type VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Content Strategies table - Content strategy configurations for different campaign goals
CREATE TABLE content_strategies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    goal VARCHAR(50) CHECK (goal IN ('awareness', 'consideration', 'conversion', 'retention')),
    voice VARCHAR(50) CHECK (voice IN ('expert', 'friendly', 'insider', 'storyteller')),
    template VARCHAR(50) CHECK (template IN ('how-to', 'problem-solution', 'listicle', 'case-study', 'comprehensive')),
    length VARCHAR(20) CHECK (length IN ('quick', 'standard', 'deep')),
    target_audience TEXT,
    content_focus TEXT,
    customer_psychology JSONB, -- Decision makers, problems, search behavior
    scenarios JSONB, -- Customer journey scenarios
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Blog Posts table - Generated blog posts with version history and metadata
CREATE TABLE blog_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    strategy_id UUID REFERENCES content_strategies(id),
    parent_post_id UUID REFERENCES blog_posts(id), -- For versions/regenerations
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    version_number INTEGER DEFAULT 1,
    topic_data JSONB, -- Original topic selection data
    generation_metadata JSONB, -- AI generation parameters, tokens used, etc.
    custom_feedback TEXT, -- User feedback for regeneration
    export_count INTEGER DEFAULT 0,
    published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Content Topics table - Generated topic ideas with engagement scoring
CREATE TABLE content_topics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    subheader TEXT,
    keywords JSONB,
    scenario_data JSONB, -- Customer psychology scenario
    seo_keywords JSONB,
    engagement_score DECIMAL(5,2),
    difficulty_score DECIMAL(5,2),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- =============================================================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for tables with updated_at columns
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_strategies_updated_at BEFORE UPDATE ON content_strategies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_blog_posts_updated_at BEFORE UPDATE ON blog_posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- BASIC INDEXES FOR CORE TABLES
-- =============================================================================

-- Users indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_plan_tier ON users(plan_tier);
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_created_at ON users(created_at);

-- Organizations indexes
CREATE INDEX idx_organizations_owner_user_id ON organizations(owner_user_id);
CREATE INDEX idx_organizations_slug ON organizations(slug);

-- Organization members indexes
CREATE INDEX idx_org_members_user_id ON organization_members(user_id);
CREATE INDEX idx_org_members_org_id ON organization_members(organization_id);

-- Projects indexes
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_organization_id ON projects(organization_id);

-- Content strategies indexes
CREATE INDEX idx_content_strategies_project_id ON content_strategies(project_id);

-- Blog posts indexes
CREATE INDEX idx_blog_posts_project_id ON blog_posts(project_id);
CREATE INDEX idx_blog_posts_user_id ON blog_posts(user_id);
CREATE INDEX idx_blog_posts_status ON blog_posts(status);
CREATE INDEX idx_blog_posts_created_at ON blog_posts(created_at);

-- Content topics indexes
CREATE INDEX idx_content_topics_project_id ON content_topics(project_id);
CREATE INDEX idx_content_topics_created_at ON content_topics(created_at);

-- =============================================================================
-- COMMENTS FOR DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE users IS 'Core user accounts with authentication, profile information, and plan details';
COMMENT ON TABLE organizations IS 'Multi-user workspaces for teams and businesses with billing and branding';
COMMENT ON TABLE organization_members IS 'User membership in organizations with role-based permissions';
COMMENT ON TABLE projects IS 'Individual websites/brands that users analyze and create content for';
COMMENT ON TABLE content_strategies IS 'Content strategy configurations for different campaign goals';
COMMENT ON TABLE blog_posts IS 'Generated blog posts with version history and metadata';
COMMENT ON TABLE content_topics IS 'Generated topic ideas with engagement scoring and SEO data';

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Phase 1 core tables created successfully. Tables: users, organizations, organization_members, projects, content_strategies, blog_posts, content_topics';
END $$;