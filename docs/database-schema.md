# AutoBlog Platform - Database Schema Documentation

## Overview

This document defines the complete database schema for the AutoBlog platform, supporting AI-powered blog content generation with user management, billing, analytics, and referral systems.

## Architecture Principles

- **Multi-tenant**: Organizations with multiple users
- **Usage-based billing**: Free, pay-per-use, and subscription tiers
- **Analytics-driven**: Comprehensive tracking for product optimization
- **Scalable**: Designed for growth from MVP to enterprise
- **Compliant**: GDPR-ready with audit trails and data retention policies

## Implementation Phases

- **Phase 1**: Core tables (users, organizations, basic content) - MVP
- **Phase 2**: Usage tracking and billing - Revenue
- **Phase 3**: Analytics and referral system - Growth
- **Phase 4**: Advanced admin features - Scale
- **Phase 5**: Lead generation and conversion tracking - Sales

---

## Core Entity Tables

### 1. users
**Purpose**: Core user accounts with authentication and profile information

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
```

**Indexes**:
- `email` (unique)
- `referral_code` (unique)
- `plan_tier`, `status`
- `created_at`

### 2. organizations
**Purpose**: Multi-user workspaces for teams and businesses

```sql
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
```

### 3. organization_members
**Purpose**: User membership in organizations with role-based permissions

```sql
CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
```

---

## Content Management Tables

### 4. projects
**Purpose**: Individual websites/brands that users analyze and create content for

```sql
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
```

### 5. content_strategies
**Purpose**: Content strategy configurations for different campaign goals

```sql
CREATE TABLE content_strategies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
```

### 6. blog_posts
**Purpose**: Generated blog posts with version history and metadata

```sql
CREATE TABLE blog_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
```

### 7. content_topics
**Purpose**: Generated topic ideas with engagement scoring

```sql
CREATE TABLE content_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
```

---

## Billing & Usage Tables

### 8. plan_definitions
**Purpose**: Define subscription plans and usage limits

```sql
CREATE TABLE plan_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    price_monthly DECIMAL(10,2),
    price_per_generation DECIMAL(10,2),
    features JSONB, -- {"website_scans": 1, "strategies": 1, "regenerations": 1, "downloads": 1, "generations": 4}
    is_unlimited BOOLEAN DEFAULT FALSE,
    display_order INTEGER,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 9. user_usage_tracking
**Purpose**: Track user usage against plan limits

```sql
CREATE TABLE user_usage_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    feature_type VARCHAR(50) NOT NULL, -- 'website_scan', 'generation', 'strategy', 'regeneration', 'download'
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    usage_count INTEGER DEFAULT 0,
    limit_count INTEGER,
    bonus_usage_count INTEGER DEFAULT 0, -- From referrals, promotions
    bonus_source VARCHAR(50), -- 'referral_reward', 'promotion', 'admin_grant'
    resets_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, feature_type, period_start)
);
```

### 10. subscriptions
**Purpose**: Manage user subscriptions and billing cycles

```sql
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id),
    plan_name VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('active', 'cancelled', 'past_due', 'unpaid')),
    current_period_start TIMESTAMP NOT NULL,
    current_period_end TIMESTAMP NOT NULL,
    trial_start TIMESTAMP,
    trial_end TIMESTAMP,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    cancelled_at TIMESTAMP,
    stripe_subscription_id VARCHAR(100),
    stripe_customer_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 11. billing_cycles
**Purpose**: Track billing periods and usage charges

```sql
CREATE TABLE billing_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id),
    cycle_start DATE NOT NULL,
    cycle_end DATE NOT NULL,
    plan_tier VARCHAR(50),
    base_amount DECIMAL(10,2) DEFAULT 0.00,
    usage_charges DECIMAL(10,2) DEFAULT 0.00,
    total_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 12. pay_per_use_charges
**Purpose**: Track individual pay-per-use transactions

```sql
CREATE TABLE pay_per_use_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    feature_type VARCHAR(50) NOT NULL,
    feature_details JSONB, -- What was generated, project context
    unit_price DECIMAL(10,2) NOT NULL,
    quantity INTEGER DEFAULT 1,
    total_amount DECIMAL(10,2) NOT NULL,
    billing_cycle_id UUID REFERENCES billing_cycles(id),
    charged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Referral System Tables

### 13. user_invites
**Purpose**: Manage referral invitations and tracking

```sql
CREATE TABLE user_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
```

### 14. referral_rewards
**Purpose**: Track and manage referral rewards

```sql
CREATE TABLE referral_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    earned_from_invite_id UUID REFERENCES user_invites(id),
    reward_type VARCHAR(50) NOT NULL, -- 'free_generation', 'bonus_strategies', 'month_free'
    reward_value DECIMAL(10,2), -- Monetary value for tracking
    quantity INTEGER DEFAULT 1, -- For non-monetary rewards
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'used', 'expired')),
    granted_at TIMESTAMP,
    expires_at TIMESTAMP,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Analytics & Reporting Tables

### 15. generation_history
**Purpose**: Comprehensive log of all AI generation requests

```sql
CREATE TABLE generation_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
```

### 16. user_sessions
**Purpose**: Track user session behavior and engagement

```sql
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
```

### 17. user_activity_events
**Purpose**: Detailed event tracking for conversion analysis

```sql
CREATE TABLE user_activity_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
```

### 18. daily_metrics
**Purpose**: Aggregated daily platform metrics for dashboards

```sql
CREATE TABLE daily_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(15,2) NOT NULL,
    segment VARCHAR(100), -- 'all', 'free_users', 'paid_users', etc.
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, metric_name, segment)
);
```

---

## Admin & Security Tables

### 19. user_roles
**Purpose**: Define system roles and permissions

```sql
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL, -- Array of permission strings
    is_system_role BOOLEAN DEFAULT FALSE,
    hierarchy_level INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 20. audit_logs
**Purpose**: Security audit trail for admin actions

```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
```

---

## System Configuration Tables

### 21. feature_flags
**Purpose**: Control feature rollouts and A/B testing

```sql
CREATE TABLE feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    enabled BOOLEAN DEFAULT FALSE,
    user_criteria JSONB, -- Targeting rules
    rollout_percentage INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 22. api_keys
**Purpose**: API access management for integrations

```sql
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    key_hash VARCHAR(255) UNIQUE NOT NULL,
    permissions JSONB,
    last_used_at TIMESTAMP,
    expires_at TIMESTAMP,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Indexes and Performance

### Critical Indexes
```sql
-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_plan_tier ON users(plan_tier);
CREATE INDEX idx_users_referral_code ON users(referral_code);

-- Content
CREATE INDEX idx_blog_posts_project_id ON blog_posts(project_id);
CREATE INDEX idx_blog_posts_user_id ON blog_posts(user_id);
CREATE INDEX idx_blog_posts_status ON blog_posts(status);

-- Usage Tracking
CREATE INDEX idx_usage_tracking_user_period ON user_usage_tracking(user_id, feature_type, period_start);

-- Analytics
CREATE INDEX idx_generation_history_user_created ON generation_history(user_id, created_at);
CREATE INDEX idx_daily_metrics_date_metric ON daily_metrics(date, metric_name);

-- Audit
CREATE INDEX idx_audit_logs_user_created ON audit_logs(user_id, created_at);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
```

## Migration Strategy

### Phase 1: Core MVP (Immediate)
1. Users, organizations, organization_members
2. Projects, blog_posts, content_topics
3. Basic usage tracking

### Phase 2: Billing System (Revenue)
1. Plan definitions, subscriptions
2. Billing cycles, pay-per-use charges
3. Enhanced usage tracking

### Phase 3: Growth Features (Scale)
1. Referral system (invites, rewards)
2. Analytics tables
3. Feature flags

### Phase 4: Enterprise (Advanced)
1. Advanced admin features
2. API keys and integrations
3. Comprehensive audit logging

### Phase 5: Lead Generation (Sales)
1. Lead capture and tracking
2. Conversion funnel analytics
3. Lead scoring and enrichment

---

## Lead Generation & Sales Tables

### 23. website_leads
**Purpose**: Track all website entries for lead generation from both anonymous and logged-in users

```sql
CREATE TABLE website_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id VARCHAR(100), -- Anonymous session tracking
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    website_url VARCHAR(500) NOT NULL,
    website_domain VARCHAR(255), -- Extracted domain for grouping
    analysis_data JSONB, -- Complete website analysis results
    business_type VARCHAR(255),
    business_name VARCHAR(255),
    target_audience TEXT,
    content_focus TEXT,
    brand_voice VARCHAR(100),
    estimated_company_size VARCHAR(50),
    industry_category VARCHAR(100),
    geographic_location VARCHAR(100),
    lead_source VARCHAR(50) DEFAULT 'organic',
    utm_source VARCHAR(100),
    utm_medium VARCHAR(100),
    utm_campaign VARCHAR(100),
    ip_address INET,
    user_agent TEXT,
    referrer TEXT,
    converted_to_user_id UUID REFERENCES users(id),
    converted_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'new',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 24. lead_scoring
**Purpose**: Automated lead quality assessment based on business analysis and engagement

```sql
CREATE TABLE lead_scoring (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    website_lead_id UUID REFERENCES website_leads(id) ON DELETE CASCADE,
    overall_score INTEGER CHECK (overall_score >= 0 AND overall_score <= 100),
    business_size_score INTEGER DEFAULT 0,
    industry_fit_score INTEGER DEFAULT 0,
    engagement_score INTEGER DEFAULT 0,
    content_quality_score INTEGER DEFAULT 0,
    technical_readiness_score INTEGER DEFAULT 0,
    budget_indicator_score INTEGER DEFAULT 0,
    urgency_score INTEGER DEFAULT 0,
    scoring_factors JSONB, -- Detailed breakdown of scoring logic
    auto_generated BOOLEAN DEFAULT TRUE,
    manual_override BOOLEAN DEFAULT FALSE,
    manual_score INTEGER,
    manual_notes TEXT,
    scored_by_user_id UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 25. conversion_tracking
**Purpose**: Monitor lead progression through the conversion funnel with timing analytics

```sql
CREATE TABLE conversion_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    website_lead_id UUID REFERENCES website_leads(id) ON DELETE CASCADE,
    conversion_step VARCHAR(50) NOT NULL, -- 'website_analysis', 'topic_generation', 'content_creation', 'registration', 'first_payment'
    step_completed_at TIMESTAMP NOT NULL,
    step_data JSONB,
    session_id VARCHAR(100),
    time_from_previous_step INTEGER, -- Minutes from previous step
    total_time_to_conversion INTEGER, -- Total minutes from first touch
    conversion_value DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 26. lead_interactions
**Purpose**: Track all touchpoints and interactions with leads for sales management

```sql
CREATE TABLE lead_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    website_lead_id UUID REFERENCES website_leads(id) ON DELETE CASCADE,
    interaction_type VARCHAR(50) NOT NULL,
    interaction_channel VARCHAR(50),
    interaction_details JSONB,
    performed_by_user_id UUID REFERENCES users(id),
    automated BOOLEAN DEFAULT FALSE,
    successful BOOLEAN DEFAULT TRUE,
    response_received BOOLEAN DEFAULT FALSE,
    next_followup_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 27. lead_enrichment
**Purpose**: Additional data gathered about leads from external sources

```sql
CREATE TABLE lead_enrichment (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    website_lead_id UUID REFERENCES website_leads(id) ON DELETE CASCADE,
    enrichment_source VARCHAR(50),
    company_data JSONB,
    contact_data JSONB,
    social_media_data JSONB,
    technology_stack JSONB,
    funding_data JSONB,
    employee_count INTEGER,
    annual_revenue DECIMAL(15,2),
    data_confidence DECIMAL(3,2),
    last_enriched_at TIMESTAMP,
    enrichment_status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Lead Generation Features**:
- **Automatic Lead Capture**: Every website analysis creates a lead record
- **Anonymous Tracking**: Track users before they register
- **Lead Scoring**: Automated 0-100 scoring based on business size, industry, engagement
- **Conversion Funnel**: Track progression from analysis → registration → payment
- **Sales Intelligence**: Rich business data for sales team follow-up
- **Campaign Tracking**: UTM parameter tracking for marketing attribution

---

## Data Retention & Compliance

- **User data**: Retained for account lifetime + 30 days after deletion
- **Analytics data**: 2 years retention, then aggregated/anonymized
- **Audit logs**: 7 years retention for compliance
- **Content**: User-controlled retention with export options
- **GDPR**: Complete user data export and deletion capabilities

---

This schema supports the complete AutoBlog platform from MVP to enterprise scale, with clear upgrade paths and comprehensive business intelligence capabilities.