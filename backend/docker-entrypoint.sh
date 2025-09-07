#!/bin/sh
set -e

# Fail fast if DATABASE_URL is not set
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

# Ensure prisma client/binaries are ready
npx prisma generate >/dev/null 2>&1 || true

# Always use db push to avoid migration provider mismatch across environments
apply_schema() {
  npx prisma db push >/dev/null 2>&1
  return $?
}

# Try to wait for DB and apply schema (simple loop)
ATTEMPTS=0
until apply_schema; do
  ATTEMPTS=$((ATTEMPTS+1))
  if [ "$ATTEMPTS" -ge 15 ]; then
  echo "ERROR: Could not connect/apply schema to database after $ATTEMPTS attempts" >&2
  echo "--- db push output (last attempt) ---" >&2
  npx prisma db push || true
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

# Lightweight diagnostic: log if DB appears empty (no users and no settings)
# Helps detect unintended resets; harmless in production logs
node --input-type=module - <<'EOF' || true
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const [uc, sc] = await Promise.all([
    prisma.user.count().catch(()=>0),
    prisma.setting.count().catch(()=>0),
  ]);
  if ((uc === 0) && (sc === 0)) {
    console.warn('[entrypoint] Warning: database appears empty (0 users, 0 settings). If this was not expected, check volume persistence and SEED_DB/ADMIN_SEED_MODE.');
  } else {
    console.log(`[entrypoint] DB ready. users=${uc}, settings=${sc}`);
  }
} catch (e) {
  console.log('[entrypoint] DB diagnostics skipped:', e?.message || String(e));
} finally {
  await prisma.$disconnect().catch(()=>{});
}
EOF

# Start the server
exec node dist/server.js
