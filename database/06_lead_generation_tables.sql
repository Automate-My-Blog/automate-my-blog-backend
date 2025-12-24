-- AutoBlog Platform - Lead Generation & Conversion Tracking Tables
-- This file creates tables for lead generation from website analysis entries

-- =============================================================================
-- LEAD GENERATION TABLES
-- =============================================================================

-- 23. Website Leads table - Track all website entries for lead generation
CREATE TABLE website_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id VARCHAR(100), -- Anonymous session tracking
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL for anonymous users
    website_url VARCHAR(500) NOT NULL,
    website_domain VARCHAR(255), -- Extracted domain for grouping
    analysis_data JSONB, -- Complete website analysis results
    business_type VARCHAR(255),
    business_name VARCHAR(255),
    target_audience TEXT,
    content_focus TEXT,
    brand_voice VARCHAR(100),
    estimated_company_size VARCHAR(50), -- 'startup', 'small', 'medium', 'enterprise'
    industry_category VARCHAR(100),
    geographic_location VARCHAR(100), -- Based on IP or domain
    lead_source VARCHAR(50) DEFAULT 'organic', -- 'organic', 'referral', 'campaign'
    utm_source VARCHAR(100),
    utm_medium VARCHAR(100),
    utm_campaign VARCHAR(100),
    ip_address INET,
    user_agent TEXT,
    referrer TEXT,
    converted_to_user_id UUID REFERENCES users(id), -- Set when lead converts
    converted_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'converted', 'lost')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 24. Lead Scoring table - Automated lead quality assessment
CREATE TABLE lead_scoring (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    website_lead_id UUID REFERENCES website_leads(id) ON DELETE CASCADE,
    overall_score INTEGER CHECK (overall_score >= 0 AND overall_score <= 100),
    business_size_score INTEGER DEFAULT 0, -- Based on estimated company size
    industry_fit_score INTEGER DEFAULT 0, -- How well industry matches our target
    engagement_score INTEGER DEFAULT 0, -- How much they used the tool
    content_quality_score INTEGER DEFAULT 0, -- Quality of their website/content
    technical_readiness_score INTEGER DEFAULT 0, -- Likelihood they can implement
    budget_indicator_score INTEGER DEFAULT 0, -- Signs they have budget
    urgency_score INTEGER DEFAULT 0, -- How quickly they need solution
    scoring_factors JSONB, -- Detailed breakdown of scoring logic
    auto_generated BOOLEAN DEFAULT TRUE,
    manual_override BOOLEAN DEFAULT FALSE,
    manual_score INTEGER, -- Manual override score
    manual_notes TEXT,
    scored_by_user_id UUID REFERENCES users(id), -- Who manually scored
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 25. Conversion Tracking table - Monitor lead progression and conversion
CREATE TABLE conversion_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    website_lead_id UUID REFERENCES website_leads(id) ON DELETE CASCADE,
    conversion_step VARCHAR(50) NOT NULL, -- 'website_analysis', 'topic_generation', 'content_creation', 'registration', 'first_payment'
    step_completed_at TIMESTAMP NOT NULL,
    step_data JSONB, -- Data about what they did in this step
    session_id VARCHAR(100), -- Track session continuity
    time_from_previous_step INTEGER, -- Minutes from previous step
    total_time_to_conversion INTEGER, -- Total minutes from first touch
    conversion_value DECIMAL(10,2), -- Revenue attributed to this step
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 26. Lead Interactions table - Track all touchpoints with leads
CREATE TABLE lead_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    website_lead_id UUID REFERENCES website_leads(id) ON DELETE CASCADE,
    interaction_type VARCHAR(50) NOT NULL, -- 'website_visit', 'email_sent', 'email_opened', 'demo_request', 'support_contact'
    interaction_channel VARCHAR(50), -- 'email', 'phone', 'chat', 'form', 'app'
    interaction_details JSONB, -- Specific details about the interaction
    performed_by_user_id UUID REFERENCES users(id), -- Staff member who performed action
    automated BOOLEAN DEFAULT FALSE, -- Whether this was an automated interaction
    successful BOOLEAN DEFAULT TRUE, -- Whether interaction was successful
    response_received BOOLEAN DEFAULT FALSE, -- Whether lead responded
    next_followup_at TIMESTAMP, -- When to follow up next
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 27. Lead Enrichment table - Additional data gathered about leads
CREATE TABLE lead_enrichment (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    website_lead_id UUID REFERENCES website_leads(id) ON DELETE CASCADE,
    enrichment_source VARCHAR(50), -- 'clearbit', 'linkedin', 'manual_research', 'social_media'
    company_data JSONB, -- Company information from external sources
    contact_data JSONB, -- Contact person information
    social_media_data JSONB, -- Social media profiles and activity
    technology_stack JSONB, -- Technologies they use (from website analysis)
    funding_data JSONB, -- Investment/funding information if available
    employee_count INTEGER,
    annual_revenue DECIMAL(15,2),
    data_confidence DECIMAL(3,2), -- Confidence level in the data (0.0 to 1.0)
    last_enriched_at TIMESTAMP,
    enrichment_status VARCHAR(20) DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'enriched', 'failed', 'manual_review')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- =============================================================================

-- Create triggers for tables with updated_at columns
CREATE TRIGGER update_website_leads_updated_at BEFORE UPDATE ON website_leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lead_scoring_updated_at BEFORE UPDATE ON lead_scoring
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lead_enrichment_updated_at BEFORE UPDATE ON lead_enrichment
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- INDEXES FOR LEAD GENERATION TABLES
-- =============================================================================

-- Website leads indexes
CREATE INDEX idx_website_leads_domain ON website_leads(website_domain);
CREATE INDEX idx_website_leads_user_id ON website_leads(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_website_leads_session_id ON website_leads(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_website_leads_created_at ON website_leads(created_at DESC);
CREATE INDEX idx_website_leads_status ON website_leads(status);
CREATE INDEX idx_website_leads_business_type ON website_leads(business_type) WHERE business_type IS NOT NULL;
CREATE INDEX idx_website_leads_converted_user ON website_leads(converted_to_user_id) WHERE converted_to_user_id IS NOT NULL;
CREATE INDEX idx_website_leads_source_campaign ON website_leads(lead_source, utm_campaign) WHERE utm_campaign IS NOT NULL;

-- Lead scoring indexes
CREATE INDEX idx_lead_scoring_website_lead ON lead_scoring(website_lead_id);
CREATE INDEX idx_lead_scoring_overall_score ON lead_scoring(overall_score DESC);
CREATE INDEX idx_lead_scoring_created_at ON lead_scoring(created_at DESC);
CREATE INDEX idx_lead_scoring_manual_override ON lead_scoring(manual_override) WHERE manual_override = TRUE;

-- Conversion tracking indexes
CREATE INDEX idx_conversion_tracking_website_lead ON conversion_tracking(website_lead_id);
CREATE INDEX idx_conversion_tracking_step ON conversion_tracking(conversion_step, step_completed_at DESC);
CREATE INDEX idx_conversion_tracking_session ON conversion_tracking(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_conversion_tracking_time ON conversion_tracking(step_completed_at DESC);

-- Lead interactions indexes
CREATE INDEX idx_lead_interactions_website_lead ON lead_interactions(website_lead_id);
CREATE INDEX idx_lead_interactions_type_time ON lead_interactions(interaction_type, created_at DESC);
CREATE INDEX idx_lead_interactions_performed_by ON lead_interactions(performed_by_user_id) WHERE performed_by_user_id IS NOT NULL;
CREATE INDEX idx_lead_interactions_followup ON lead_interactions(next_followup_at) WHERE next_followup_at IS NOT NULL;

-- Lead enrichment indexes
CREATE INDEX idx_lead_enrichment_website_lead ON lead_enrichment(website_lead_id);
CREATE INDEX idx_lead_enrichment_status ON lead_enrichment(enrichment_status);
CREATE INDEX idx_lead_enrichment_source ON lead_enrichment(enrichment_source);

-- =============================================================================
-- FUNCTIONS FOR LEAD GENERATION
-- =============================================================================

-- Function to automatically score leads based on analysis data
CREATE OR REPLACE FUNCTION auto_score_lead(p_website_lead_id UUID)
RETURNS INTEGER AS $$
DECLARE
    lead_data RECORD;
    score INTEGER := 0;
    scoring_factors JSONB := '{}';
BEGIN
    -- Get lead data
    SELECT * INTO lead_data FROM website_leads WHERE id = p_website_lead_id;
    
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    
    -- Business size scoring (0-25 points)
    CASE lead_data.estimated_company_size
        WHEN 'enterprise' THEN 
            score := score + 25;
            scoring_factors := scoring_factors || '{"business_size": {"score": 25, "reason": "Enterprise company"}}';
        WHEN 'medium' THEN 
            score := score + 20;
            scoring_factors := scoring_factors || '{"business_size": {"score": 20, "reason": "Medium company"}}';
        WHEN 'small' THEN 
            score := score + 15;
            scoring_factors := scoring_factors || '{"business_size": {"score": 15, "reason": "Small company"}}';
        WHEN 'startup' THEN 
            score := score + 10;
            scoring_factors := scoring_factors || '{"business_size": {"score": 10, "reason": "Startup"}}';
        ELSE 
            score := score + 5;
            scoring_factors := scoring_factors || '{"business_size": {"score": 5, "reason": "Unknown size"}}';
    END CASE;
    
    -- Industry fit scoring (0-25 points)
    -- Higher scores for industries that typically need content marketing
    CASE lead_data.industry_category
        WHEN 'Technology' THEN score := score + 25;
        WHEN 'Healthcare' THEN score := score + 20;
        WHEN 'Professional Services' THEN score := score + 20;
        WHEN 'E-commerce' THEN score := score + 25;
        WHEN 'Education' THEN score := score + 15;
        WHEN 'Financial Services' THEN score := score + 20;
        ELSE score := score + 10;
    END CASE;
    
    -- Website quality scoring (0-25 points)
    -- Based on analysis data quality and completeness
    IF lead_data.analysis_data IS NOT NULL THEN
        -- Check if analysis found comprehensive data
        IF jsonb_array_length(COALESCE(lead_data.analysis_data->'keywords', '[]')) > 5 THEN
            score := score + 10;
        END IF;
        
        IF length(COALESCE(lead_data.target_audience, '')) > 50 THEN
            score := score + 8;
        END IF;
        
        IF length(COALESCE(lead_data.content_focus, '')) > 50 THEN
            score := score + 7;
        END IF;
    END IF;
    
    -- Engagement scoring (0-25 points)
    -- This would be calculated based on conversion tracking data
    -- For now, give base engagement score
    score := score + 15;
    
    -- Cap at 100
    IF score > 100 THEN
        score := 100;
    END IF;
    
    -- Insert or update lead scoring
    INSERT INTO lead_scoring (
        website_lead_id, 
        overall_score, 
        business_size_score, 
        industry_fit_score, 
        engagement_score,
        content_quality_score,
        scoring_factors
    )
    VALUES (
        p_website_lead_id,
        score,
        CASE lead_data.estimated_company_size
            WHEN 'enterprise' THEN 25
            WHEN 'medium' THEN 20
            WHEN 'small' THEN 15
            WHEN 'startup' THEN 10
            ELSE 5
        END,
        CASE lead_data.industry_category
            WHEN 'Technology' THEN 25
            WHEN 'E-commerce' THEN 25
            WHEN 'Healthcare' THEN 20
            WHEN 'Professional Services' THEN 20
            WHEN 'Financial Services' THEN 20
            WHEN 'Education' THEN 15
            ELSE 10
        END,
        15, -- Base engagement score
        LEAST(25, (length(COALESCE(lead_data.content_focus, '')) / 2)), -- Content quality based on length
        scoring_factors
    )
    ON CONFLICT (website_lead_id) 
    DO UPDATE SET 
        overall_score = EXCLUDED.overall_score,
        business_size_score = EXCLUDED.business_size_score,
        industry_fit_score = EXCLUDED.industry_fit_score,
        scoring_factors = EXCLUDED.scoring_factors,
        updated_at = CURRENT_TIMESTAMP;
    
    RETURN score;
END;
$$ LANGUAGE plpgsql;

-- Function to track conversion steps
CREATE OR REPLACE FUNCTION track_conversion_step(
    p_website_lead_id UUID,
    p_conversion_step VARCHAR(50),
    p_step_data JSONB DEFAULT NULL,
    p_session_id VARCHAR(100) DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    conversion_id UUID;
    previous_step RECORD;
    time_from_previous INTEGER := 0;
    total_time INTEGER := 0;
BEGIN
    -- Get previous conversion step for timing
    SELECT * INTO previous_step 
    FROM conversion_tracking 
    WHERE website_lead_id = p_website_lead_id 
    ORDER BY step_completed_at DESC 
    LIMIT 1;
    
    -- Calculate time differences
    IF previous_step.id IS NOT NULL THEN
        time_from_previous := EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - previous_step.step_completed_at)) / 60;
    END IF;
    
    -- Calculate total time from first touch
    SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(step_completed_at))) / 60 INTO total_time
    FROM conversion_tracking 
    WHERE website_lead_id = p_website_lead_id;
    
    -- Insert conversion tracking record
    INSERT INTO conversion_tracking (
        website_lead_id,
        conversion_step,
        step_completed_at,
        step_data,
        session_id,
        time_from_previous_step,
        total_time_to_conversion
    )
    VALUES (
        p_website_lead_id,
        p_conversion_step,
        CURRENT_TIMESTAMP,
        p_step_data,
        p_session_id,
        time_from_previous,
        COALESCE(total_time, 0)
    )
    RETURNING id INTO conversion_id;
    
    -- Auto-score the lead after new conversion data
    PERFORM auto_score_lead(p_website_lead_id);
    
    RETURN conversion_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- VIEWS FOR LEAD GENERATION ANALYTICS
-- =============================================================================

-- View: Lead generation summary for sales dashboard
CREATE VIEW lead_generation_summary AS
SELECT 
    wl.id,
    wl.website_url,
    wl.website_domain,
    wl.business_name,
    wl.business_type,
    wl.industry_category,
    wl.estimated_company_size,
    wl.status,
    wl.created_at as lead_created_at,
    ls.overall_score,
    ls.scoring_factors,
    COUNT(DISTINCT ct.id) as conversion_steps_completed,
    MAX(ct.step_completed_at) as last_activity_at,
    COUNT(DISTINCT li.id) as total_interactions,
    wl.converted_to_user_id IS NOT NULL as is_converted,
    wl.converted_at
FROM website_leads wl
LEFT JOIN lead_scoring ls ON wl.id = ls.website_lead_id
LEFT JOIN conversion_tracking ct ON wl.id = ct.website_lead_id
LEFT JOIN lead_interactions li ON wl.id = li.website_lead_id
GROUP BY wl.id, wl.website_url, wl.website_domain, wl.business_name, wl.business_type, 
         wl.industry_category, wl.estimated_company_size, wl.status, wl.created_at,
         ls.overall_score, ls.scoring_factors, wl.converted_to_user_id, wl.converted_at
ORDER BY ls.overall_score DESC NULLS LAST, wl.created_at DESC;

-- View: Conversion funnel analytics
CREATE VIEW conversion_funnel_analytics AS
SELECT 
    conversion_step,
    COUNT(*) as total_leads,
    COUNT(DISTINCT website_lead_id) as unique_leads,
    AVG(time_from_previous_step) as avg_time_from_previous,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_from_previous_step) as median_time_from_previous
FROM conversion_tracking
GROUP BY conversion_step
ORDER BY 
    CASE conversion_step
        WHEN 'website_analysis' THEN 1
        WHEN 'topic_generation' THEN 2
        WHEN 'content_creation' THEN 3
        WHEN 'registration' THEN 4
        WHEN 'first_payment' THEN 5
        ELSE 6
    END;

-- =============================================================================
-- COMMENTS FOR DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE website_leads IS 'Track all website entries for lead generation, both anonymous and from logged-in users';
COMMENT ON TABLE lead_scoring IS 'Automated lead quality assessment based on business analysis and engagement';
COMMENT ON TABLE conversion_tracking IS 'Monitor lead progression through the conversion funnel';
COMMENT ON TABLE lead_interactions IS 'Track all touchpoints and interactions with leads';
COMMENT ON TABLE lead_enrichment IS 'Additional data gathered about leads from external sources';

COMMENT ON FUNCTION auto_score_lead IS 'Automatically score leads based on business size, industry fit, and engagement';
COMMENT ON FUNCTION track_conversion_step IS 'Track lead progression through conversion funnel with timing';

COMMENT ON VIEW lead_generation_summary IS 'Comprehensive lead dashboard view for sales team';
COMMENT ON VIEW conversion_funnel_analytics IS 'Conversion funnel performance metrics';

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Lead generation tables created successfully.';
    RAISE NOTICE 'Tables: website_leads, lead_scoring, conversion_tracking, lead_interactions, lead_enrichment';
    RAISE NOTICE 'Functions: auto_score_lead(), track_conversion_step()';
    RAISE NOTICE 'Views: lead_generation_summary, conversion_funnel_analytics';
    RAISE NOTICE 'Lead scoring algorithm: Business size (25pts) + Industry fit (25pts) + Content quality (25pts) + Engagement (25pts)';
END $$;