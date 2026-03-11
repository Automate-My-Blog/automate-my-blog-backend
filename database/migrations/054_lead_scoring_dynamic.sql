-- Migration 054: Dynamic lead scoring for AdminLeadsTab (Issue #164)
-- Adds initial_score and score_updated_at so frontend can show "Updated" when score was recalculated.

-- Ensure one row per lead for ON CONFLICT (website_lead_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_scoring_website_lead_id ON lead_scoring(website_lead_id);

ALTER TABLE lead_scoring
  ADD COLUMN IF NOT EXISTS initial_score INTEGER CHECK (initial_score >= 0 AND initial_score <= 100),
  ADD COLUMN IF NOT EXISTS score_updated_at TIMESTAMP;

COMMENT ON COLUMN lead_scoring.initial_score IS 'Score when lead was first scored; preserved after recalculation for comparison';
COMMENT ON COLUMN lead_scoring.score_updated_at IS 'When score was last recalculated (null if never recalculated)';

-- Backfill: treat current overall_score as initial for existing rows
UPDATE lead_scoring
SET initial_score = overall_score
WHERE initial_score IS NULL AND overall_score IS NOT NULL;

-- Update auto_score_lead: set initial_score on insert, set score_updated_at on update
CREATE OR REPLACE FUNCTION auto_score_lead(p_website_lead_id UUID)
RETURNS INTEGER AS $$
DECLARE
    lead_data RECORD;
    score INTEGER := 0;
    scoring_factors JSONB := '{}';
BEGIN
    SELECT * INTO lead_data FROM website_leads WHERE id = p_website_lead_id;
    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    -- Business size scoring (0-25 points)
    CASE lead_data.estimated_company_size
        WHEN 'enterprise' THEN score := score + 25; scoring_factors := scoring_factors || '{"business_size": {"score": 25, "reason": "Enterprise company"}}';
        WHEN 'medium' THEN score := score + 20; scoring_factors := scoring_factors || '{"business_size": {"score": 20, "reason": "Medium company"}}';
        WHEN 'small' THEN score := score + 15; scoring_factors := scoring_factors || '{"business_size": {"score": 15, "reason": "Small company"}}';
        WHEN 'startup' THEN score := score + 10; scoring_factors := scoring_factors || '{"business_size": {"score": 10, "reason": "Startup"}}';
        ELSE score := score + 5; scoring_factors := scoring_factors || '{"business_size": {"score": 5, "reason": "Unknown size"}}';
    END CASE;

    -- Industry fit (0-25)
    CASE lead_data.industry_category
        WHEN 'Technology' THEN score := score + 25;
        WHEN 'Healthcare' THEN score := score + 20;
        WHEN 'Professional Services' THEN score := score + 20;
        WHEN 'E-commerce' THEN score := score + 25;
        WHEN 'Education' THEN score := score + 15;
        WHEN 'Financial Services' THEN score := score + 20;
        ELSE score := score + 10;
    END CASE;

    IF lead_data.analysis_data IS NOT NULL THEN
        IF jsonb_array_length(COALESCE(lead_data.analysis_data->'keywords', '[]')) > 5 THEN score := score + 10; END IF;
        IF length(COALESCE(lead_data.target_audience, '')) > 50 THEN score := score + 8; END IF;
        IF length(COALESCE(lead_data.content_focus, '')) > 50 THEN score := score + 7; END IF;
    END IF;
    score := score + 15;
    IF score > 100 THEN score := 100; END IF;

    INSERT INTO lead_scoring (
        website_lead_id, overall_score, business_size_score, industry_fit_score,
        engagement_score, content_quality_score, scoring_factors,
        initial_score, score_updated_at
    )
    VALUES (
        p_website_lead_id, score,
        CASE lead_data.estimated_company_size WHEN 'enterprise' THEN 25 WHEN 'medium' THEN 20 WHEN 'small' THEN 15 WHEN 'startup' THEN 10 ELSE 5 END,
        CASE lead_data.industry_category WHEN 'Technology' THEN 25 WHEN 'E-commerce' THEN 25 WHEN 'Healthcare' THEN 20 WHEN 'Professional Services' THEN 20 WHEN 'Financial Services' THEN 20 WHEN 'Education' THEN 15 ELSE 10 END,
        15, LEAST(25, (length(COALESCE(lead_data.content_focus, '')) / 2)), scoring_factors,
        score, NULL
    )
    ON CONFLICT (website_lead_id)
    DO UPDATE SET
        overall_score = EXCLUDED.overall_score,
        business_size_score = EXCLUDED.business_size_score,
        industry_fit_score = EXCLUDED.industry_fit_score,
        scoring_factors = EXCLUDED.scoring_factors,
        updated_at = CURRENT_TIMESTAMP,
        score_updated_at = CURRENT_TIMESTAMP;

    RETURN score;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_score_lead IS 'Score leads; sets initial_score on first run, score_updated_at on recalculation (Issue #164)';
