#!/usr/bin/env bash
# Run integration tests against local Postgres.
# Usage:
#   1. Start Postgres (e.g. Docker):
#      docker run -d --name amb-test-db -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:16
#   2. Run migrations (see setup-test-db; use port 5433 if mapping above):
#      DATABASE_URL='postgresql://postgres:postgres@localhost:5433/postgres' ./scripts/setup-test-db.sh
#   3. Run this script:
#      DATABASE_URL='postgresql://postgres:postgres@localhost:5433/postgres' ./scripts/run-integration-tests.sh

set -e
export NODE_ENV=test
export USE_DATABASE=true
export JWT_SECRET=test-jwt-secret-do-not-use-in-production
export JWT_REFRESH_SECRET=test-refresh-secret
export STRIPE_WEBHOOK_SECRET=whsec_test_secret
export STRIPE_SECRET_KEY=sk_test_dummy
export EMAIL_SCHEDULER_ENABLED=false
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-dummy-for-tests}"

if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL is not set."
  echo "   Example: DATABASE_URL='postgresql://postgres:postgres@localhost:5433/postgres' $0"
  exit 1
fi

echo "▶ Running integration tests (DATABASE_URL set, OPENAI_API_KEY=${OPENAI_API_KEY:0:12}...)"
npm run test:integration
