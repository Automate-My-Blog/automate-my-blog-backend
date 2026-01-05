-- AutoBlog Platform - Add Anonymous Project Linking to Website Leads
-- This migration adds project_id and anonymous_user_id to website_leads table

-- Add columns to link anonymous projects to leads
ALTER TABLE website_leads 
ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
ADD COLUMN anonymous_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Add indexes for the new columns
CREATE INDEX idx_website_leads_project_id ON website_leads(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_website_leads_anonymous_user_id ON website_leads(anonymous_user_id) WHERE anonymous_user_id IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN website_leads.project_id IS 'Links to anonymous project created with structured OpenAI fields';
COMMENT ON COLUMN website_leads.anonymous_user_id IS 'Links to temporary anonymous user account for projects';

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Added anonymous project linking columns to website_leads table.';
    RAISE NOTICE 'Columns: project_id (links to projects), anonymous_user_id (links to users)';
END $$;