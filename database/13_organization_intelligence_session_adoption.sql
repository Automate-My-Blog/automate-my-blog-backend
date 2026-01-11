-- Migration 13: Organization Intelligence Session Adoption Support
-- Purpose: Add session-based persistence for website analysis (organization intelligence) to enable anonymous user workflow
-- Date: January 7, 2026
-- Dependencies: Requires organizations and organization_intelligence tables from migration 08

BEGIN;

-- =============================================================================
-- Update organizations table to support session-based persistence
-- =============================================================================
ALTER TABLE organizations ADD COLUMN session_id VARCHAR(255);

-- Make owner_user_id nullable to allow anonymous sessions
ALTER TABLE organizations ALTER COLUMN owner_user_id DROP NOT NULL;

-- Add constraint to ensure either owner_user_id OR session_id is provided (but not both)
ALTER TABLE organizations ADD CONSTRAINT chk_organizations_user_or_session CHECK (
    (owner_user_id IS NOT NULL AND session_id IS NULL) OR 
    (owner_user_id IS NULL AND session_id IS NOT NULL)
);

-- =============================================================================
-- Update organization_intelligence table to support session-based persistence
-- =============================================================================
ALTER TABLE organization_intelligence ADD COLUMN session_id VARCHAR(255);

-- Add constraint to ensure data is linked to either authenticated org OR session
-- (organization_id can be null for session-based records before adoption)
ALTER TABLE organization_intelligence ADD CONSTRAINT chk_org_intelligence_session CHECK (
    (organization_id IS NOT NULL AND session_id IS NULL) OR 
    (organization_id IS NULL AND session_id IS NOT NULL)
);

-- =============================================================================
-- Create indexes for performance optimization
-- =============================================================================

-- Organizations session-based indexes
CREATE INDEX idx_organizations_session_id ON organizations(session_id);
CREATE INDEX idx_organizations_session_updated ON organizations(session_id, updated_at);

-- Organization intelligence session-based indexes  
CREATE INDEX idx_org_intelligence_session_id ON organization_intelligence(session_id);
CREATE INDEX idx_org_intelligence_session_created ON organization_intelligence(session_id, created_at);

-- Compound indexes for session adoption queries
CREATE INDEX idx_organizations_user_session_lookup ON organizations(owner_user_id, session_id);
CREATE INDEX idx_org_intelligence_org_session_lookup ON organization_intelligence(organization_id, session_id);

-- =============================================================================
-- Create session adoption function for organization intelligence
-- =============================================================================
CREATE OR REPLACE FUNCTION adopt_organization_intelligence_session(
    target_user_id UUID,
    source_session_id VARCHAR(255)
)
RETURNS TABLE (
    adopted_organizations_count INTEGER,
    adopted_intelligence_count INTEGER,
    latest_organization_data JSONB,
    latest_intelligence_data JSONB
) AS $$
DECLARE
    orgs_count INTEGER := 0;
    intel_count INTEGER := 0;
    latest_org_record organizations%ROWTYPE;
    latest_intel_record organization_intelligence%ROWTYPE;
    org_data JSONB := '{}';
    intel_data JSONB := '{}';
BEGIN
    -- Get the most recent organization and intelligence data before adoption
    SELECT * INTO latest_org_record
    FROM organizations 
    WHERE session_id = source_session_id 
    ORDER BY updated_at DESC 
    LIMIT 1;
    
    SELECT * INTO latest_intel_record
    FROM organization_intelligence 
    WHERE session_id = source_session_id 
    ORDER BY created_at DESC 
    LIMIT 1;
    
    -- Adopt organizations (set owner to user)
    UPDATE organizations 
    SET owner_user_id = target_user_id, session_id = NULL, updated_at = NOW()
    WHERE session_id = source_session_id AND owner_user_id IS NULL;
    
    GET DIAGNOSTICS orgs_count = ROW_COUNT;
    
    -- Adopt organization intelligence (link to adopted organization)
    -- First, link session-based intelligence to the newly adopted organization
    UPDATE organization_intelligence oi
    SET organization_id = o.id, session_id = NULL, updated_at = NOW()
    FROM organizations o
    WHERE oi.session_id = source_session_id 
    AND o.owner_user_id = target_user_id
    AND oi.organization_id IS NULL;
    
    GET DIAGNOSTICS intel_count = ROW_COUNT;
    
    -- Build response data from captured records
    IF latest_org_record.id IS NOT NULL THEN
        org_data := jsonb_build_object(
            'id', latest_org_record.id,
            'name', latest_org_record.name,
            'business_type', latest_org_record.business_type,
            'industry_category', latest_org_record.industry_category,
            'business_model', latest_org_record.business_model,
            'description', latest_org_record.description,
            'target_audience', latest_org_record.target_audience,
            'brand_voice', latest_org_record.brand_voice,
            'website_goals', latest_org_record.website_goals,
            'website_url', (SELECT website_url FROM organizations WHERE owner_user_id = target_user_id LIMIT 1)
        );
    END IF;
    
    IF latest_intel_record.id IS NOT NULL THEN
        intel_data := jsonb_build_object(
            'customer_scenarios', latest_intel_record.customer_scenarios,
            'business_value_assessment', latest_intel_record.business_value_assessment,
            'customer_language_patterns', latest_intel_record.customer_language_patterns,
            'search_behavior_insights', latest_intel_record.search_behavior_insights,
            'seo_opportunities', latest_intel_record.seo_opportunities,
            'content_strategy_recommendations', latest_intel_record.content_strategy_recommendations,
            'competitive_intelligence', latest_intel_record.competitive_intelligence,
            'analysis_confidence_score', latest_intel_record.analysis_confidence_score,
            'data_sources', latest_intel_record.data_sources,
            'ai_model_used', latest_intel_record.ai_model_used,
            'raw_openai_response', latest_intel_record.raw_openai_response,
            'is_current', latest_intel_record.is_current
        );
    END IF;
    
    -- Log the adoption
    RAISE NOTICE 'Organization intelligence session adoption completed for user % from session %: % organizations, % intelligence records', 
        target_user_id, source_session_id, orgs_count, intel_count;
    
    -- Return adoption counts and data
    RETURN QUERY SELECT orgs_count, intel_count, org_data, intel_data;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Add comments for documentation
-- =============================================================================
COMMENT ON COLUMN organizations.session_id IS 'Session ID for anonymous users before registration/login';
COMMENT ON COLUMN organization_intelligence.session_id IS 'Session ID for anonymous intelligence data before user registration';
COMMENT ON FUNCTION adopt_organization_intelligence_session IS 'Transfer organization and intelligence data from session to authenticated user';

-- =============================================================================
-- Validation queries to verify schema changes
-- =============================================================================
DO $$
BEGIN
    -- Check if session_id column was added to organizations
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'session_id') THEN
        RAISE EXCEPTION 'session_id column not added to organizations';
    END IF;
    
    -- Check if session_id column was added to organization_intelligence
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organization_intelligence' AND column_name = 'session_id') THEN
        RAISE EXCEPTION 'session_id column not added to organization_intelligence';
    END IF;
    
    -- Check if constraints were added
    IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints 
                   WHERE constraint_name = 'chk_organizations_user_or_session') THEN
        RAISE EXCEPTION 'User/session constraint not added to organizations';
    END IF;
    
    -- Check if adoption function was created
    IF NOT EXISTS (SELECT 1 FROM information_schema.routines 
                   WHERE routine_name = 'adopt_organization_intelligence_session') THEN
        RAISE EXCEPTION 'adopt_organization_intelligence_session function not created';
    END IF;
    
    RAISE NOTICE 'Migration 13 completed successfully - organization intelligence session adoption support added';
END $$;

COMMIT;

-- =============================================================================
-- Post-migration information
-- =============================================================================
SELECT 
    'Migration 13: Organization Intelligence Session Adoption Support' as migration_name,
    'Completed successfully' as status,
    NOW() as completed_at;

-- Show updated table structures
SELECT 'Organizations table structure:' as info;
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'organizations'
ORDER BY ordinal_position;

SELECT 'Organization Intelligence table structure:' as info;
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'organization_intelligence'
ORDER BY ordinal_position;