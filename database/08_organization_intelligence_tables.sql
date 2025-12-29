-- Migration: Organization-Centric Business Intelligence Tables
-- Creates tables for storing rich business intelligence data extracted from OpenAI website analysis

-- =============================================================================
-- ORGANIZATION ENHANCEMENT
-- =============================================================================

-- Add business intelligence fields to organizations table
DO $$
BEGIN
    -- Add columns only if they don't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'business_type') THEN
        ALTER TABLE organizations ADD COLUMN business_type VARCHAR(255);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'industry_category') THEN
        ALTER TABLE organizations ADD COLUMN industry_category VARCHAR(100);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'business_model') THEN
        ALTER TABLE organizations ADD COLUMN business_model TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'company_size') THEN
        ALTER TABLE organizations ADD COLUMN company_size VARCHAR(50);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'description') THEN
        ALTER TABLE organizations ADD COLUMN description TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'target_audience') THEN
        ALTER TABLE organizations ADD COLUMN target_audience TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'brand_voice') THEN
        ALTER TABLE organizations ADD COLUMN brand_voice VARCHAR(100);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'website_goals') THEN
        ALTER TABLE organizations ADD COLUMN website_goals TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'search_behavior_summary') THEN
        ALTER TABLE organizations ADD COLUMN search_behavior_summary TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'last_analyzed_at') THEN
        ALTER TABLE organizations ADD COLUMN last_analyzed_at TIMESTAMP;
    END IF;
END $$;

-- Add indexes for commonly queried fields
CREATE INDEX IF NOT EXISTS idx_organizations_business_type ON organizations(business_type) WHERE business_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_industry ON organizations(industry_category) WHERE industry_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_company_size ON organizations(company_size) WHERE company_size IS NOT NULL;

-- =============================================================================
-- ORGANIZATION CONTACTS TABLE
-- =============================================================================

-- Store contact information and decision makers extracted from website analysis
CREATE TABLE IF NOT EXISTS organization_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255),
    title VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    role_type VARCHAR(50) DEFAULT 'unknown' CHECK (role_type IN (
        'decision_maker', 'end_user', 'influencer', 'executive', 'manager', 'employee', 'unknown'
    )),
    department VARCHAR(100),
    seniority_level VARCHAR(50) CHECK (seniority_level IN (
        'executive', 'senior', 'mid', 'junior', 'unknown'
    )),
    data_source VARCHAR(50) DEFAULT 'website_analysis' CHECK (data_source IN (
        'website_analysis', 'linkedin', 'manual_research', 'user_registration', 'crunchbase'
    )),
    confidence_level DECIMAL(3,2) DEFAULT 0.50 CHECK (confidence_level >= 0 AND confidence_level <= 1),
    contact_data JSONB, -- Additional structured contact information
    is_primary_contact BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- ORGANIZATION INTELLIGENCE TABLE  
-- =============================================================================

-- Store rich business intelligence and customer scenarios from OpenAI analysis
CREATE TABLE IF NOT EXISTS organization_intelligence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Customer scenarios and business psychology
    customer_scenarios JSONB, -- 4-5 detailed customer scenarios with demographics/psychographics
    business_value_assessment JSONB, -- Search volume, competition, conversion potential per scenario
    customer_language_patterns JSONB, -- What customers actually type into Google
    search_behavior_insights JSONB, -- When/how customers search, urgency patterns
    
    -- SEO and content strategy
    seo_opportunities JSONB, -- Keywords, search gaps, content opportunities
    content_strategy_recommendations JSONB, -- Blog post ideas, content themes
    competitive_intelligence JSONB, -- Competitor analysis, market positioning
    
    -- Analysis metadata
    analysis_type VARCHAR(50) DEFAULT 'website_analysis' CHECK (analysis_type IN (
        'website_analysis', 'manual_research', 'competitor_analysis', 'customer_interview'
    )),
    analysis_confidence_score DECIMAL(3,2) DEFAULT 0.75 CHECK (analysis_confidence_score >= 0 AND analysis_confidence_score <= 1),
    data_sources JSONB, -- ["website_scraping", "web_search", "linkedin"] 
    ai_model_used VARCHAR(50), -- "gpt-4", "gpt-3.5-turbo"
    web_enhancement_successful BOOLEAN DEFAULT FALSE,
    
    -- Raw analysis data backup
    raw_openai_response JSONB, -- Complete OpenAI response for debugging/reprocessing
    
    -- Versioning and tracking
    analysis_version INTEGER DEFAULT 1,
    superseded_by UUID REFERENCES organization_intelligence(id),
    is_current BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- UPDATE WEBSITE LEADS TABLE
-- =============================================================================

-- Add organization reference to website_leads table
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'website_leads' AND column_name = 'organization_id') THEN
        ALTER TABLE website_leads ADD COLUMN organization_id UUID REFERENCES organizations(id);
    END IF;
END $$;

-- Create index for organization lookups
CREATE INDEX IF NOT EXISTS idx_website_leads_organization ON website_leads(organization_id) WHERE organization_id IS NOT NULL;

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

-- Organization contacts indexes
CREATE INDEX IF NOT EXISTS idx_organization_contacts_org_id ON organization_contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_contacts_role ON organization_contacts(role_type) WHERE role_type != 'unknown';
CREATE INDEX IF NOT EXISTS idx_organization_contacts_primary ON organization_contacts(organization_id, is_primary_contact) WHERE is_primary_contact = TRUE;
CREATE INDEX IF NOT EXISTS idx_organization_contacts_email ON organization_contacts(email) WHERE email IS NOT NULL;

-- Organization intelligence indexes  
CREATE INDEX IF NOT EXISTS idx_organization_intelligence_org_id ON organization_intelligence(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_intelligence_current ON organization_intelligence(organization_id, is_current) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS idx_organization_intelligence_confidence ON organization_intelligence(analysis_confidence_score) WHERE analysis_confidence_score > 0.8;
CREATE INDEX IF NOT EXISTS idx_organization_intelligence_created ON organization_intelligence(created_at DESC);

-- =============================================================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS update_organization_contacts_updated_at 
    BEFORE UPDATE ON organization_contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER IF NOT EXISTS update_organization_intelligence_updated_at 
    BEFORE UPDATE ON organization_intelligence  
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- UTILITY FUNCTIONS
-- =============================================================================

-- Function to get current organization intelligence
CREATE OR REPLACE FUNCTION get_current_organization_intelligence(p_organization_id UUID)
RETURNS JSONB AS $$
DECLARE
    intelligence_data JSONB;
BEGIN
    SELECT row_to_json(oi.*) INTO intelligence_data
    FROM organization_intelligence oi
    WHERE oi.organization_id = p_organization_id 
      AND oi.is_current = TRUE
    ORDER BY oi.created_at DESC
    LIMIT 1;
    
    RETURN intelligence_data;
END;
$$ LANGUAGE plpgsql;

-- Function to get organization decision makers
CREATE OR REPLACE FUNCTION get_organization_decision_makers(p_organization_id UUID)
RETURNS JSONB AS $$
DECLARE
    decision_makers JSONB;
BEGIN
    SELECT json_agg(
        json_build_object(
            'name', name,
            'title', title,
            'email', email,
            'seniority_level', seniority_level,
            'confidence_level', confidence_level,
            'is_primary_contact', is_primary_contact
        )
    ) INTO decision_makers
    FROM organization_contacts
    WHERE organization_id = p_organization_id 
      AND role_type IN ('decision_maker', 'executive')
      AND confidence_level > 0.3
    ORDER BY 
        is_primary_contact DESC,
        seniority_level = 'executive' DESC,
        confidence_level DESC;
    
    RETURN COALESCE(decision_makers, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- VIEWS FOR ENRICHED LEAD DATA
-- =============================================================================

-- Enhanced lead view with organization intelligence
CREATE OR REPLACE VIEW enriched_leads_view AS
SELECT 
    wl.id as lead_id,
    wl.website_url,
    wl.lead_source,
    wl.status as lead_status,
    wl.created_at as lead_created_at,
    wl.converted_to_user_id,
    wl.converted_at,
    
    -- Organization data
    o.id as organization_id,
    o.name as organization_name,
    o.business_type,
    o.industry_category,
    o.company_size,
    o.business_model,
    o.description as organization_description,
    o.target_audience,
    o.brand_voice,
    
    -- Lead scoring data (existing)
    ls.overall_score as lead_score,
    ls.business_size_score,
    ls.industry_fit_score,
    ls.engagement_score,
    
    -- Intelligence data
    oi.customer_scenarios,
    oi.business_value_assessment,
    oi.analysis_confidence_score,
    
    -- Decision makers
    get_organization_decision_makers(o.id) as decision_makers,
    
    -- Conversion metrics
    COUNT(DISTINCT ct.id) as conversion_steps_count,
    EXTRACT(EPOCH FROM (COALESCE(wl.converted_at, NOW()) - wl.created_at)) / 86400 as days_in_funnel
    
FROM website_leads wl
LEFT JOIN organizations o ON wl.organization_id = o.id
LEFT JOIN lead_scoring ls ON wl.id = ls.website_lead_id
LEFT JOIN organization_intelligence oi ON o.id = oi.organization_id AND oi.is_current = TRUE
LEFT JOIN conversion_tracking ct ON wl.id = ct.website_lead_id
GROUP BY 
    wl.id, wl.website_url, wl.lead_source, wl.status, wl.created_at, 
    wl.converted_to_user_id, wl.converted_at,
    o.id, o.name, o.business_type, o.industry_category, o.company_size, 
    o.business_model, o.description, o.target_audience, o.brand_voice,
    ls.overall_score, ls.business_size_score, ls.industry_fit_score, ls.engagement_score,
    oi.customer_scenarios, oi.business_value_assessment, oi.analysis_confidence_score
ORDER BY wl.created_at DESC;

-- =============================================================================
-- COMMENTS FOR DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE organization_contacts IS 'Contact information and decision makers for organizations, extracted from website analysis and other sources';
COMMENT ON TABLE organization_intelligence IS 'Rich business intelligence data including customer scenarios, business value assessments, and AI analysis results';
COMMENT ON COLUMN organization_intelligence.customer_scenarios IS 'JSONB array of 4-5 customer scenarios with demographics, psychographics, and business value';
COMMENT ON COLUMN organization_intelligence.analysis_confidence_score IS 'AI confidence in analysis quality (0.0-1.0), higher = more reliable data';
COMMENT ON COLUMN organization_contacts.confidence_level IS 'Confidence in contact data accuracy (0.0-1.0), extracted contacts typically 0.5-0.8';

-- =============================================================================
-- LOG COMPLETION
-- =============================================================================

DO $$
BEGIN
    RAISE NOTICE '✅ Organization intelligence tables created successfully';
    RAISE NOTICE 'Tables: organization_contacts, organization_intelligence';
    RAISE NOTICE 'Enhanced: organizations table with business intelligence fields';
    RAISE NOTICE 'Updated: website_leads table with organization_id reference';
    RAISE NOTICE 'Functions: get_current_organization_intelligence(), get_organization_decision_makers()';
    RAISE NOTICE 'Views: enriched_leads_view for comprehensive lead data';
END $$;