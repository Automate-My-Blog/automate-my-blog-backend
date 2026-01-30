#!/usr/bin/env bash
# Setup test database: run all migrations in deterministic order.
# Discovers database/*.sql and database/migrations/*.sql so new migrations
# are picked up automatically. Requires: DATABASE_URL.
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

# Run a single migration file. Usage: run_migration <path> [strict]
# strict=1 (default): ON_ERROR_STOP=1. strict=0: allow errors (for 08, 05).
run_migration() {
  local path="$1"
  local strict="${2:-1}"
  local name="${path#$DB_DIR/}"
  echo "▶ $name"
  if [ "$strict" = "1" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$path"
  else
    psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f "$path" || true
  fi
  echo "   ✅"
}

# 1. Run all database/*.sql in version-sorted order (exclude rollbacks).
#    New files are picked up automatically. 08 and 05 allow errors (triggers/indexes).
while IFS= read -r fullpath; do
  [ -n "$fullpath" ] || continue
  path=$(basename "$fullpath")
  case "$path" in
    08_organization_intelligence_tables.sql)
      run_migration "$fullpath" 0
      ;;
    05_create_all_indexes.sql)
      run_migration "$fullpath" 0
      ;;
    *)
      run_migration "$fullpath" 1
      ;;
  esac
done < <(find "$DB_DIR" -maxdepth 1 -name '*.sql' ! -name 'rollback*' -type f -print | sort -V)

# 2. Run all database/migrations/*.sql in version-sorted order.
#    New migrations (032_..., etc.) are picked up automatically.
MIGRATIONS_DIR="$DB_DIR/migrations"
if [ -d "$MIGRATIONS_DIR" ]; then
  while IFS= read -r fullpath; do
    [ -n "$fullpath" ] || continue
    path=$(basename "$fullpath")
    echo "▶ migrations/$path"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$fullpath"
    echo "   ✅"
  done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' -type f -print | sort -V)
fi

echo ""
echo "✅ Test database ready."
