-- Migration: Add structured analysis fields to projects table
-- This migration extracts key OpenAI analysis data from JSONB to dedicated columns for better querying and display

-- Add structured fields for OpenAI analysis data
ALTER TABLE projects 
ADD COLUMN keywords JSONB,
ADD COLUMN description TEXT,
ADD COLUMN decision_makers TEXT,
ADD COLUMN end_users TEXT,
ADD COLUMN business_model TEXT,
ADD COLUMN website_goals TEXT,
ADD COLUMN blog_strategy TEXT,
ADD COLUMN search_behavior TEXT,
ADD COLUMN connection_message TEXT;

-- Add indexes for better query performance
CREATE INDEX idx_projects_keywords ON projects USING GIN(keywords) WHERE keywords IS NOT NULL;
CREATE INDEX idx_projects_business_model ON projects(business_model) WHERE business_model IS NOT NULL;
CREATE INDEX idx_projects_decision_makers ON projects(decision_makers) WHERE decision_makers IS NOT NULL;

-- Migrate existing data from business_analysis JSONB to structured columns
UPDATE projects 
SET 
  keywords = (business_analysis->>'keywords')::JSONB,
  description = business_analysis->>'description',
  decision_makers = business_analysis->>'decisionMakers', 
  end_users = business_analysis->>'endUsers',
  business_model = business_analysis->>'businessModel',
  website_goals = business_analysis->>'websiteGoals',
  blog_strategy = business_analysis->>'blogStrategy',
  search_behavior = business_analysis->>'searchBehavior',
  connection_message = business_analysis->>'connectionMessage'
WHERE business_analysis IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN projects.keywords IS 'General business keywords from OpenAI analysis for SEO and content planning';
COMMENT ON COLUMN projects.description IS 'Business description extracted from OpenAI analysis';
COMMENT ON COLUMN projects.decision_makers IS 'Who makes purchasing decisions for this business target audience';
COMMENT ON COLUMN projects.end_users IS 'Who actually uses the product/service (may differ from decision makers)';
COMMENT ON COLUMN projects.business_model IS 'How this business makes money based on website analysis';
COMMENT ON COLUMN projects.website_goals IS 'Primary conversion objectives inferred from CTAs and user flows';
COMMENT ON COLUMN projects.blog_strategy IS 'How blog content should support business conversion goals';
COMMENT ON COLUMN projects.search_behavior IS 'When and how target customers search (urgency, emotional state, timing)';
COMMENT ON COLUMN projects.connection_message IS 'How this business connects with customers through content psychology';

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Added structured analysis fields to projects table and migrated existing data';
    RAISE NOTICE 'New fields: keywords, description, decision_makers, end_users, business_model, website_goals, blog_strategy, search_behavior, connection_message';
END $$;