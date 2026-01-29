-- Add profit and margin tracking to audiences table
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS projected_revenue_low INTEGER;
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS projected_revenue_high INTEGER;
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS projected_profit_low INTEGER;
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS projected_profit_high INTEGER;
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS profit_margin_percent DECIMAL(5,2);
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS price_per_unit INTEGER;
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS unit_type VARCHAR(50) DEFAULT 'consultation';

-- Add indexes for pricing queries
CREATE INDEX IF NOT EXISTS idx_audiences_profit ON audiences(projected_profit_low, projected_profit_high);
CREATE INDEX IF NOT EXISTS idx_audiences_revenue ON audiences(projected_revenue_low, projected_revenue_high);

-- Add comments
COMMENT ON COLUMN audiences.projected_revenue_low IS 'Low end of projected monthly revenue range';
COMMENT ON COLUMN audiences.projected_revenue_high IS 'High end of projected monthly revenue range';
COMMENT ON COLUMN audiences.projected_profit_low IS 'Low end of projected monthly profit range';
COMMENT ON COLUMN audiences.projected_profit_high IS 'High end of projected monthly profit range';
COMMENT ON COLUMN audiences.profit_margin_percent IS 'Gross profit margin percentage (e.g., 80.00 for 80%)';
COMMENT ON COLUMN audiences.price_per_unit IS 'Price per unit of service (e.g., consultation fee)';
COMMENT ON COLUMN audiences.unit_type IS 'Type of unit being sold (consultation, session, product, etc.)';
