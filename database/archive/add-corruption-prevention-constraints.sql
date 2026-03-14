-- Database constraints to prevent JSON corruption
-- These constraints enforce data integrity at the database level

-- 1. Ensure target_segment is valid JSON and has required structure
ALTER TABLE audiences 
ADD CONSTRAINT check_target_segment_valid_json 
CHECK (
  target_segment IS NULL 
  OR (
    jsonb_typeof(target_segment) = 'object'
    AND target_segment ? 'demographics'
    AND target_segment ? 'psychographics'
    AND target_segment ? 'searchBehavior'
  )
);

-- 2. Prevent [object Object] corruption patterns in target_segment
ALTER TABLE audiences 
ADD CONSTRAINT check_target_segment_not_corrupted 
CHECK (
  target_segment IS NULL 
  OR target_segment::text !~* '\[object Object\]'
);

-- 3. Ensure target_segment doesn't contain generic placeholder text
ALTER TABLE audiences 
ADD CONSTRAINT check_target_segment_not_generic 
CHECK (
  target_segment IS NULL 
  OR (
    target_segment::text !~* 'General Audience'
    AND target_segment::text !~* 'generic'
    AND target_segment::text !~* 'placeholder'
  )
);

-- 4. Ensure customer_language is valid JSON when not null
ALTER TABLE audiences 
ADD CONSTRAINT check_customer_language_valid_json 
CHECK (
  customer_language IS NULL 
  OR (
    jsonb_typeof(customer_language) = 'object'
    AND customer_language::text !~* '\[object Object\]'
  )
);

-- 5. Ensure business_value is valid JSON when not null
ALTER TABLE audiences 
ADD CONSTRAINT check_business_value_valid_json 
CHECK (
  business_value IS NULL 
  OR (
    jsonb_typeof(business_value) = 'object'
    AND business_value::text !~* '\[object Object\]'
  )
);

-- 6. Ensure customer_problem is not empty or just placeholder text
ALTER TABLE audiences 
ADD CONSTRAINT check_customer_problem_meaningful 
CHECK (
  customer_problem IS NULL 
  OR (
    LENGTH(TRIM(customer_problem)) > 10
    AND customer_problem !~* 'placeholder'
    AND customer_problem !~* 'generic'
    AND customer_problem !~* 'example'
  )
);

-- Create indexes to help with constraint checking performance
CREATE INDEX IF NOT EXISTS idx_audiences_target_segment_gin 
ON audiences USING GIN (target_segment);

CREATE INDEX IF NOT EXISTS idx_audiences_customer_language_gin 
ON audiences USING GIN (customer_language);

CREATE INDEX IF NOT EXISTS idx_audiences_business_value_gin 
ON audiences USING GIN (business_value);

-- Test the constraints with sample data (these should fail)
/*
-- This should fail - missing required fields
INSERT INTO audiences (user_id, target_segment) 
VALUES ('test-user-id', '{"demographics": "test"}');

-- This should fail - contains [object Object]
INSERT INTO audiences (user_id, target_segment) 
VALUES ('test-user-id', '{"demographics": "[object Object]", "psychographics": "test", "searchBehavior": "test"}');

-- This should fail - contains "General Audience"
INSERT INTO audiences (user_id, target_segment) 
VALUES ('test-user-id', '{"demographics": "General Audience", "psychographics": "test", "searchBehavior": "test"}');
*/

-- Add comments for documentation
COMMENT ON CONSTRAINT check_target_segment_valid_json ON audiences 
IS 'Ensures target_segment is a valid JSON object with required fields: demographics, psychographics, searchBehavior';

COMMENT ON CONSTRAINT check_target_segment_not_corrupted ON audiences 
IS 'Prevents storage of corrupted [object Object] patterns in target_segment field';

COMMENT ON CONSTRAINT check_target_segment_not_generic ON audiences 
IS 'Prevents storage of generic placeholder text like "General Audience" in target_segment';

COMMENT ON CONSTRAINT check_customer_language_valid_json ON audiences 
IS 'Ensures customer_language is valid JSON when not null';

COMMENT ON CONSTRAINT check_business_value_valid_json ON audiences 
IS 'Ensures business_value is valid JSON when not null';

COMMENT ON CONSTRAINT check_customer_problem_meaningful ON audiences 
IS 'Ensures customer_problem contains meaningful content, not just placeholder text';