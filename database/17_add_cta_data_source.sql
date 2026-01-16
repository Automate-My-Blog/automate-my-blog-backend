-- Migration 17: Add data_source tracking to CTA analysis
-- Tracks whether CTAs were captured during website scraping or manually entered by user

-- Add data_source column to track origin of CTA data
ALTER TABLE cta_analysis
ADD COLUMN IF NOT EXISTS data_source VARCHAR(20) DEFAULT 'scraped'
CHECK (data_source IN ('scraped', 'manual'));

-- Update existing records to have 'scraped' source (they came from website analysis)
UPDATE cta_analysis
SET data_source = 'scraped'
WHERE data_source IS NULL;

-- Make column NOT NULL after backfilling
ALTER TABLE cta_analysis
ALTER COLUMN data_source SET NOT NULL;

-- Add index for filtering by data source
CREATE INDEX IF NOT EXISTS idx_cta_analysis_data_source ON cta_analysis(data_source);

-- Add comment for documentation
COMMENT ON COLUMN cta_analysis.data_source IS 'Origin of CTA data: scraped from website or manually entered by user';

-- Update database summary
COMMENT ON TABLE cta_analysis IS 'Stores CTA analysis results from website scraping and manual user input. Used to provide real CTAs during content generation instead of placeholder links.';
