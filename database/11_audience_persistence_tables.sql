-- Migration 11: Audience Persistence Tables
-- Purpose: Create tables for audience strategies, SEO keywords, and update existing tables
-- Date: January 4, 2026
-- Dependencies: Requires existing organization_intelligence, users, content_topics, content_strategies tables

BEGIN;

-- =============================================================================
-- Create audiences table
-- Stores core audience strategy data generated from analysis scenarios
-- =============================================================================
CREATE TABLE audiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) NULL, -- NULL for anonymous sessions
    session_id VARCHAR(255), -- For anonymous users (session-based persistence)
    project_id UUID REFERENCES projects(id) NULL, -- Link to projects table
    organization_intelligence_id UUID REFERENCES organization_intelligence(id) NULL, -- Made nullable since org_intel uses organization_id
    target_segment JSONB NOT NULL,
    customer_problem TEXT,
    customer_language JSONB,
    conversion_path TEXT,
    business_value JSONB,
    priority INTEGER DEFAULT 1 CHECK (priority >= 1 AND priority <= 10),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints to ensure either user_id OR session_id is provided (but not both)
    CONSTRAINT chk_user_or_session CHECK (
        (user_id IS NOT NULL AND session_id IS NULL) OR 
        (user_id IS NULL AND session_id IS NOT NULL)
    )
);

-- =============================================================================
-- Create seo_keywords table  
-- Manages SEO keywords associated with each audience strategy
-- =============================================================================
CREATE TABLE seo_keywords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) NULL,
    session_id VARCHAR(255),
    project_id UUID REFERENCES projects(id) NULL, -- Link to projects table
    audience_id UUID REFERENCES audiences(id) ON DELETE CASCADE NOT NULL,
    keyword TEXT NOT NULL,
    search_volume INTEGER CHECK (search_volume >= 0),
    competition VARCHAR(20) CHECK (competition IN ('low', 'medium', 'high')),
    relevance_score DECIMAL(3,2) CHECK (relevance_score >= 0.0 AND relevance_score <= 1.0),
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints to ensure either user_id OR session_id is provided
    CONSTRAINT chk_keywords_user_or_session CHECK (
        (user_id IS NOT NULL AND session_id IS NULL) OR 
        (user_id IS NULL AND session_id IS NOT NULL)
    ),
    
    -- Prevent duplicate keywords per audience
    UNIQUE(audience_id, keyword)
);

-- =============================================================================
-- Update existing content_topics table
-- Add foreign key relationships to audiences for proper normalization
-- =============================================================================
ALTER TABLE content_topics ADD COLUMN audience_id UUID REFERENCES audiences(id) ON DELETE SET NULL;
ALTER TABLE content_topics ADD COLUMN session_id VARCHAR(255);

-- Note: content_topics uses project_id, so we don't add user_id/session_id constraints
-- The relationship will be maintained through project_id linkage

-- =============================================================================
-- Update existing content_strategies table
-- Add foreign key relationships to audiences for proper normalization  
-- =============================================================================
ALTER TABLE content_strategies ADD COLUMN audience_id UUID REFERENCES audiences(id) ON DELETE SET NULL;
ALTER TABLE content_strategies ADD COLUMN session_id VARCHAR(255);

-- Note: content_strategies uses project_id, so we don't add user_id/session_id constraints  
-- The relationship will be maintained through project_id linkage

-- =============================================================================
-- Create indexes for performance optimization
-- =============================================================================

-- Audiences table indexes
CREATE INDEX idx_audiences_user_id ON audiences(user_id);
CREATE INDEX idx_audiences_session_id ON audiences(session_id);
CREATE INDEX idx_audiences_org_intelligence ON audiences(organization_intelligence_id);
CREATE INDEX idx_audiences_project_id ON audiences(project_id);
CREATE INDEX idx_audiences_priority ON audiences(priority);
CREATE INDEX idx_audiences_created_at ON audiences(created_at);

-- SEO keywords table indexes  
CREATE INDEX idx_seo_keywords_audience_id ON seo_keywords(audience_id);
CREATE INDEX idx_seo_keywords_user_id ON seo_keywords(user_id);
CREATE INDEX idx_seo_keywords_session_id ON seo_keywords(session_id);
CREATE INDEX idx_seo_keywords_project_id ON seo_keywords(project_id);
CREATE INDEX idx_seo_keywords_keyword ON seo_keywords(keyword);
CREATE INDEX idx_seo_keywords_relevance ON seo_keywords(relevance_score DESC);

-- Updated existing table indexes
CREATE INDEX idx_content_topics_audience_id ON content_topics(audience_id);
CREATE INDEX idx_content_topics_session_id ON content_topics(session_id);

CREATE INDEX idx_content_strategies_audience_id ON content_strategies(audience_id);
CREATE INDEX idx_content_strategies_session_id ON content_strategies(session_id);

-- =============================================================================
-- Create updated_at trigger for audiences table
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_audiences_updated_at BEFORE UPDATE ON audiences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- Insert test data for validation (optional - remove for production)
-- =============================================================================
-- Uncomment below for development testing

/*
-- Test data insertion to validate schema
DO $$
DECLARE
    test_user_id UUID;
    test_org_intel_id UUID;
    test_audience_id UUID;
BEGIN
    -- Get a test user (assumes at least one user exists)
    SELECT id INTO test_user_id FROM users LIMIT 1;
    
    -- Get a test project record (assumes at least one exists)
    SELECT id INTO test_org_intel_id FROM projects LIMIT 1;
    
    IF test_user_id IS NOT NULL AND test_org_intel_id IS NOT NULL THEN
        -- Insert test audience
        INSERT INTO audiences (user_id, project_id, target_segment, customer_problem, priority) 
        VALUES (
            test_user_id,
            test_org_intel_id,
            '{"demographics": "Parents of children aged 2-12", "psychographics": "Value-driven customers", "searchBehavior": "Active researchers"}',
            'Finding safe, effective products for sensitive children',
            1
        ) RETURNING id INTO test_audience_id;
        
        -- Insert test keywords
        INSERT INTO seo_keywords (user_id, audience_id, keyword, search_volume, competition, relevance_score)
        VALUES 
            (test_user_id, test_audience_id, 'sensitive skin products for kids', 1200, 'medium', 0.90),
            (test_user_id, test_audience_id, 'natural baby skincare', 800, 'low', 0.85);
        
        -- Update existing content_topics to link to audience (if any exist)
        UPDATE content_topics 
        SET audience_id = test_audience_id 
        WHERE project_id = test_org_intel_id 
        AND audience_id IS NULL;
        
        RAISE NOTICE 'Test data inserted successfully. Audience ID: %', test_audience_id;
    ELSE
        RAISE NOTICE 'No test data inserted - missing user or project records';
    END IF;
END $$;
*/

-- =============================================================================
-- Validation queries to verify schema creation
-- =============================================================================
DO $$
BEGIN
    -- Check if all tables exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audiences') THEN
        RAISE EXCEPTION 'audiences table was not created';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seo_keywords') THEN
        RAISE EXCEPTION 'seo_keywords table was not created';
    END IF;
    
    -- Check if columns were added to existing tables
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'content_topics' AND column_name = 'audience_id') THEN
        RAISE EXCEPTION 'audience_id column not added to content_topics';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'content_strategies' AND column_name = 'audience_id') THEN
        RAISE EXCEPTION 'audience_id column not added to content_strategies';
    END IF;
    
    RAISE NOTICE 'Migration 11 completed successfully - all schema changes applied';
END $$;

COMMIT;

-- =============================================================================
-- Post-migration information
-- =============================================================================
SELECT 
    'Migration 11: Audience Persistence Tables' as migration_name,
    'Completed successfully' as status,
    NOW() as completed_at;

-- Show created tables and columns
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name IN ('audiences', 'seo_keywords')
ORDER BY table_name, ordinal_position;