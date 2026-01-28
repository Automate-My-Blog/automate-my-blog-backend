#!/usr/bin/env bash
# Start Postgres via Docker, run migrations, then run integration tests.
# Run this in your system terminal (not a restricted sandbox); the test runner binds to a port.

set -e
CONTAINER="${AMB_TEST_DB_CONTAINER:-amb-test-db}"
PORT="${AMB_TEST_DB_PORT:-5433}"
DATABASE_URL="postgresql://postgres:postgres@localhost:${PORT}/postgres"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "▶ Using Postgres container: $CONTAINER, port: $PORT"
echo ""

# 1. Start Postgres (recreate so we always migrate a fresh DB)
echo "▶ Starting Postgres container (fresh)..."
docker rm -f "$CONTAINER" 2>/dev/null || true
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \
  -p "${PORT}:5432" postgres:16
echo "   Waiting for Postgres to be ready..."
sleep 3
until docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
echo "   ✅ Postgres ready"

# 2. Run migrations via docker exec (no psql on host required)
echo ""
echo "▶ Running migrations..."
docker exec "$CONTAINER" mkdir -p /tmp/migrations
docker cp "$REPO_ROOT/database/." "$CONTAINER:/tmp/migrations/"
for f in 01_core_tables 02_billing_tables 03_referral_analytics_tables 04_admin_security_tables 04_credit_system \
         06_lead_generation_tables 07_add_website_to_organizations 08_organization_intelligence_tables \
         13_organization_intelligence_session_adoption 24_billing_accounts_and_referrals; do
  echo "   ▶ $f.sql"
  docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f "/tmp/migrations/${f}.sql" >/dev/null 2>&1 || true
done
echo "   ▶ 05_create_all_indexes.sql (partial failures ok)"
docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=0 -f /tmp/migrations/05_create_all_indexes.sql >/dev/null 2>&1 || true
echo "   ✅ Migrations done"
echo ""

# 3. Run integration tests
export DATABASE_URL
export NODE_ENV=test
export USE_DATABASE=true
export JWT_SECRET=test-jwt-secret-do-not-use-in-production
export JWT_REFRESH_SECRET=test-refresh-secret
export STRIPE_WEBHOOK_SECRET=whsec_test_secret
export STRIPE_SECRET_KEY=sk_test_dummy
export EMAIL_SCHEDULER_ENABLED=false
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-dummy-for-tests}"

echo "▶ Running integration tests..."
cd "$REPO_ROOT"
npm run test:integration
