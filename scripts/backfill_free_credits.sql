-- Backfill free credits for existing Free plan users who don't have any credits yet
-- Run this once to give existing users their free post

INSERT INTO user_credits (
  user_id,
  source_type,
  source_id,
  source_description,
  quantity,
  value_usd,
  status,
  priority,
  created_at
)
SELECT
  s.user_id,
  'subscription' as source_type,
  s.id as source_id,
  'Free Plan - Welcome Post (Backfilled)' as source_description,
  1 as quantity,
  0.00 as value_usd,
  'active' as status,
  25 as priority,
  NOW() as created_at
FROM subscriptions s
WHERE s.plan_name = 'Free'
  AND s.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM user_credits uc
    WHERE uc.user_id = s.user_id
  )
ON CONFLICT DO NOTHING;

-- Show results
SELECT
  u.email,
  s.plan_name,
  COUNT(uc.id) as credits
FROM users u
JOIN subscriptions s ON s.user_id = u.id
LEFT JOIN user_credits uc ON uc.user_id = u.id AND uc.status = 'active'
WHERE s.plan_name = 'Free' AND s.status = 'active'
GROUP BY u.email, s.plan_name
ORDER BY u.email;
