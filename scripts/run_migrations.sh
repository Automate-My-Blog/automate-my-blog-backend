#!/bin/bash

# Database Migration Script
# Run database migrations for the unified credit system

set -e  # Exit on error

echo "🔄 Starting database migration..."
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set"
  echo "Please set it with: export DATABASE_URL='your_postgres_url'"
  exit 1
fi

# Get database directory path
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DB_DIR="$SCRIPT_DIR/../database"

echo "📁 Database migrations directory: $DB_DIR"
echo "🔗 Database URL: ${DATABASE_URL:0:30}... (truncated)"
echo ""

# Check if migration files exist
if [ ! -f "$DB_DIR/04_credit_system.sql" ]; then
  echo "❌ ERROR: Migration file 04_credit_system.sql not found"
  exit 1
fi

if [ ! -f "$DB_DIR/05_migrate_to_credit_system.sql" ]; then
  echo "❌ ERROR: Migration file 05_migrate_to_credit_system.sql not found"
  exit 1
fi

# Run migration 04 - Create user_credits table
echo "🔧 Running migration 04_credit_system.sql..."
psql "$DATABASE_URL" -f "$DB_DIR/04_credit_system.sql"
echo "✅ Migration 04 completed"
echo ""

# Run migration 05 - Migrate existing data
echo "🔧 Running migration 05_migrate_to_credit_system.sql..."
psql "$DATABASE_URL" -f "$DB_DIR/05_migrate_to_credit_system.sql"
echo "✅ Migration 05 completed"
echo ""

# Verify the migrations
echo "🔍 Verifying migrations..."
psql "$DATABASE_URL" -c "
  SELECT
    'user_credits' as table_name,
    COUNT(*) as row_count
  FROM user_credits
  UNION ALL
  SELECT
    'source_breakdown' as table_name,
    COUNT(DISTINCT source_type)
  FROM user_credits;
"

echo ""
echo "✅ All migrations completed successfully!"
echo ""
echo "📊 Next steps:"
echo "1. Verify data integrity with: psql \$DATABASE_URL -c \"SELECT source_type, status, COUNT(*) FROM user_credits GROUP BY source_type, status;\""
echo "2. Deploy code changes to production"
echo "3. Test payment flows end-to-end"
