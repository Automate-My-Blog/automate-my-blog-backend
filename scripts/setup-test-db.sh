#!/usr/bin/env bash
# Setup test database: run migrations in order.
# Requires: DATABASE_URL pointing at test DB (e.g. automate_my_blog_test).
# Usage: DATABASE_URL='postgresql://...' ./scripts/setup-test-db.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$SCRIPT_DIR/../database"

if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL is not set. Use a separate test database."
  exit 1
fi

echo "🔄 Setting up test database..."
echo "   Migrations: $DB_DIR"
echo ""

MIGRATIONS=(
  "01_core_tables.sql"
  "02_billing_tables.sql"
  "03_referral_analytics_tables.sql"
  "04_admin_security_tables.sql"
  "04_credit_system.sql"
  "06_lead_generation_tables.sql"
  "07_add_website_to_organizations.sql"
  "08_organization_intelligence_tables.sql"
  "13_organization_intelligence_session_adoption.sql"
  "24_billing_accounts_and_referrals.sql"
)

for f in "${MIGRATIONS[@]}"; do
  path="$DB_DIR/$f"
  if [ ! -f "$path" ]; then
    echo "⚠️  Skip $f (not found)"
    continue
  fi
  echo "▶ $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$path"
  echo "   ✅"
done

# 05_create_all_indexes: some indexes use predicates that can fail (e.g. CURRENT_TIMESTAMP)
# Run with ON_ERROR_STOP=0 so partial success doesn't fail the job
path="$DB_DIR/05_create_all_indexes.sql"
if [ -f "$path" ]; then
  echo "▶ 05_create_all_indexes.sql (partial failures allowed)"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f "$path" || true
  echo "   ✅"
fi

echo ""
echo "✅ Test database ready."
