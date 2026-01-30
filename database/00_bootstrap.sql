-- Bootstrap: prerequisites used by later migrations (schema_versions, authenticated_user).
-- Run first so test DB and any fresh install match production. Idempotent (IF NOT EXISTS / exception handling).

-- Table used by migrations 14, 15, 16 for version tracking
CREATE TABLE IF NOT EXISTS schema_versions (
  version INT PRIMARY KEY,
  description TEXT,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE schema_versions IS 'Migration version tracking; used by migrations that record their version after applying';

-- Role used by migrations 14, 15, 16 for table/sequence grants (e.g. Supabase-style or app role)
DO $$
BEGIN
  CREATE ROLE authenticated_user NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL; -- role already exists (e.g. production or re-run)
END $$;
