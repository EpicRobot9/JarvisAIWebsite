#!/bin/sh
set -e

# Fail fast if DATABASE_URL is not set
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

# Install production deps are already present; ensure prisma binaries are ready
npx prisma generate >/dev/null 2>&1 || true

# Try to wait for DB (simple loop)
ATTEMPTS=0
until npx prisma db push >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS+1))
  if [ "$ATTEMPTS" -ge 15 ]; then
    echo "ERROR: Could not connect/apply schema to database after $ATTEMPTS attempts" >&2
    npx prisma db push # show last error
    exit 1
  fi
  echo "Database not ready yet. Retrying in 2s... ($ATTEMPTS)"
  sleep 2
done

# Seed if defined
if [ -n "$SEED_DB" ]; then
  echo "Seeding database..."
  npm run db:seed || true
fi

# Start the server
exec node dist/server.js
