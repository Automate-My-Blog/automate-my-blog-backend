-- Migration: Add website_url to organizations table for website field unification
-- This ensures organizations have a primary website field that can be inherited by projects

-- Add website_url column to organizations table
ALTER TABLE organizations 
ADD COLUMN website_url VARCHAR(500);

-- Add index for website URL lookups
CREATE INDEX idx_organizations_website_url ON organizations(website_url) WHERE website_url IS NOT NULL;

-- Update organizations that already have projects with website_url
-- Copy the first project's website_url to the organization
UPDATE organizations 
SET website_url = (
  SELECT p.website_url 
  FROM projects p 
  WHERE p.organization_id = organizations.id 
    AND p.website_url IS NOT NULL 
  ORDER BY p.created_at ASC 
  LIMIT 1
)
WHERE website_url IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN organizations.website_url IS 'Primary website URL for the organization, inherited by projects';

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Added website_url field to organizations table for website field unification';
    RAISE NOTICE 'Updated existing organizations with website_url from their first project';
END $$;