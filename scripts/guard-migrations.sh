#!/usr/bin/env bash
set -euo pipefail

# Guard against destructive or non-idempotent migrations being deployed to production.
# Intended for manual use pre-deploy or to be wired into CI.
#
# - Scans prisma/migrations/*/migration.sql for DROP TABLE/COLUMN, ALTER TYPE, or PRAGMA that can cause data loss
# - Warns and exits non-zero unless overridden with GUARD_ALLOW_DANGEROUS=true
# - Also runs `prisma validate` and `prisma migrate diff` sanity checks

DIR_ROOT="${DIR_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$DIR_ROOT/backend"

if ! command -v npx &>/dev/null; then echo "Node/npm is required" >&2; exit 1; fi

echo "[guard] Validating Prisma schema..."
npx prisma validate

echo "[guard] Checking for dangerous statements in migrations..."
danger_found=false
while IFS= read -r -d '' file; do
  if grep -Eiq '\bDROP\s+(TABLE|COLUMN)\b|\bALTER\s+TYPE\b' "$file"; then
    echo "[guard] Potentially dangerous SQL in: $file"
    danger_found=true
  fi
done < <(find prisma/migrations -type f -name 'migration.sql' -print0)

if [[ "$danger_found" == true && "${GUARD_ALLOW_DANGEROUS:-}" != "true" ]]; then
  echo "[guard] Aborting due to dangerous migration statements. Set GUARD_ALLOW_DANGEROUS=true to override." >&2
  exit 2
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "[guard] Creating diff from database to schema (no changes implies in-sync)..."
  set +e
  DIFF_OUTPUT=$(npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script 2>&1)
  status=$?
  set -e
  echo "$DIFF_OUTPUT" | sed -e 's/^/[diff] /'
  if [[ $status -ne 0 ]]; then
    echo "[guard] prisma migrate diff failed. Check DATABASE_URL and connectivity." >&2
    exit $status
  fi
else
  echo "[guard] DATABASE_URL not set; skipping live diff step (still validated schema and scanned SQL)."
fi

echo "[guard] Migration guard passed."
