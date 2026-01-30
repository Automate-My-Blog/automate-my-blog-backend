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

MIGRATIONS_STRICT=(
  "01_core_tables.sql"
  "02_billing_tables.sql"
  "03_referral_analytics_tables.sql"
  "04_admin_security_tables.sql"
  "04_credit_system.sql"
  "06_lead_generation_tables.sql"
  "07_add_website_to_organizations.sql"
)

for f in "${MIGRATIONS_STRICT[@]}"; do
  path="$DB_DIR/$f"
  if [ ! -f "$path" ]; then
    echo "⚠️  Skip $f (not found)"
    continue
  fi
  echo "▶ $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$path"
  echo "   ✅"
done

# 08: uses CREATE TRIGGER IF NOT EXISTS (unsupported in Postgres). Run with ON_ERROR_STOP=0,
# then 25 fixes the triggers. Do not edit 08 so migration history stays unchanged.
path="$DB_DIR/08_organization_intelligence_tables.sql"
if [ -f "$path" ]; then
  echo "▶ 08_organization_intelligence_tables.sql (trigger errors allowed; 25 fixes them)"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f "$path" || true
  echo "   ✅"
fi

path="$DB_DIR/25_fix_org_intelligence_triggers.sql"
if [ -f "$path" ]; then
  echo "▶ 25_fix_org_intelligence_triggers.sql"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$path"
  echo "   ✅"
fi

for f in "13_organization_intelligence_session_adoption.sql" "20_email_system.sql" "24_billing_accounts_and_referrals.sql"; do
  path="$DB_DIR/$f"
  if [ ! -f "$path" ]; then
    echo "⚠️  Skip $f (not found)"
    continue
  fi
  echo "▶ $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$path"
  echo "   ✅"
done

# Migrations in database/migrations/ (only those that don't require audiences table).
# Skip 028_strategy_subscriptions, 029, 030, 031 — they reference audiences (from 11_audience_persistence_tables.sql, not run in test setup).
MIGRATIONS_DIR="$DB_DIR/migrations"
if [ -d "$MIGRATIONS_DIR" ]; then
  for f in 026_add_first_login_tracking.sql 027_pending_founder_emails.sql 028_add_lead_notification_tracking.sql; do
    path="$MIGRATIONS_DIR/$f"
    if [ -f "$path" ]; then
      echo "▶ migrations/$f"
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$path"
      echo "   ✅"
    fi
  done
fi

# 05_create_all_indexes: some indexes use predicates that can fail (e.g. CURRENT_TIMESTAMP)
path="$DB_DIR/05_create_all_indexes.sql"
if [ -f "$path" ]; then
  echo "▶ 05_create_all_indexes.sql (partial failures allowed)"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f "$path" || true
  echo "   ✅"
fi

echo ""
echo "✅ Test database ready."
