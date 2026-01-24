-- Add Professional Plan to plan_definitions
-- Professional: 8 posts per month at $50/month

INSERT INTO plan_definitions (
  name,
  slug,
  price_monthly,
  price_per_generation,
  features,
  is_unlimited,
  active,
  display_order
) VALUES (
  'Professional',
  'professional',
  50.00,
  NULL,
  '{"generations": "8", "strategies": "unlimited", "topics": "unlimited"}',
  false,
  true,
  3
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  price_monthly = EXCLUDED.price_monthly,
  features = EXCLUDED.features,
  is_unlimited = EXCLUDED.is_unlimited,
  active = EXCLUDED.active,
  display_order = EXCLUDED.display_order;

-- Verification
SELECT name, slug, price_monthly, features->>'generations' as generations, is_unlimited
FROM plan_definitions
ORDER BY display_order;
