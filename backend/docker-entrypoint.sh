#!/bin/sh
set -e

# Fail fast if DATABASE_URL is not set
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

# Ensure prisma client/binaries are ready
npx prisma generate >/dev/null 2>&1 || true

# Apply schema: use migrate deploy in production; db push in non-prod
SCHEMA_CMD="npx prisma db push"
if [ "${NODE_ENV:-production}" = "production" ]; then
  SCHEMA_CMD="npx prisma migrate deploy"
fi

# Try to wait for DB and apply schema (simple loop)
ATTEMPTS=0
until sh -c "$SCHEMA_CMD" >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS+1))
  if [ "$ATTEMPTS" -ge 15 ]; then
    echo "ERROR: Could not connect/apply schema to database after $ATTEMPTS attempts" >&2
    # show last error for diagnostics
    sh -c "$SCHEMA_CMD"
    exit 1
  fi
  echo "Database not ready yet or schema apply failed. Retrying in 2s... ($ATTEMPTS)"
  sleep 2
done

# Seed only when explicitly enabled
if [ "${SEED_DB:-false}" = "true" ]; then
  echo "Seeding database..."
  npm run db:seed || true
fi

# Start the server
exec node dist/server.js
