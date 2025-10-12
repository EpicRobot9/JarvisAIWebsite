#!/usr/bin/env bash
set -euo pipefail

# Repair database ownership/privileges and reconcile Prisma migrations
# Works for both local dev and production (compose.prod). Avoids manual psql quoting.
#
# Usage examples:
#   ./scripts/repair-db.sh
#   PROJECT_NAME=techexplore ./scripts/repair-db.sh
#   DB_DATA_DIR=/opt/jarvis/db ./scripts/repair-db.sh   # auto-includes persist compose
#   CLOUDFLARE_TUNNEL_TOKEN=... ./scripts/repair-db.sh   # auto-includes tunnel compose

PROJECT_NAME="${PROJECT_NAME:-jarvisaiwebsite}"  # default compose project here; override on server
DIR_ROOT="${DIR_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
USE_TUNNEL="auto"   # auto|yes|no

cd "$DIR_ROOT"

if ! command -v docker &>/dev/null; then echo "Docker is required" >&2; exit 1; fi
if ! docker compose version &>/dev/null; then echo "Docker Compose plugin is required (docker compose)" >&2; exit 1; fi

export COMPOSE_PROJECT_NAME="$PROJECT_NAME"

# Decide compose files (base + prod; optionally persist/tunnel)
include_tunnel=false
case "$USE_TUNNEL" in
  yes) include_tunnel=true ;;
  no) include_tunnel=false ;;
  auto)
    if [[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
      include_tunnel=true
    elif [[ -f .env ]] && grep -q '^CLOUDFLARE_TUNNEL_TOKEN=' .env && \
         grep -E '^CLOUDFLARE_TUNNEL_TOKEN=.{10,}$' .env >/dev/null; then
      include_tunnel=true
    fi ;;
  *) echo "--use-tunnel must be one of: auto|yes|no" >&2; exit 1 ;;
esac

include_persist=false
if [[ -n "${DB_DATA_DIR:-}" ]]; then
  include_persist=true
elif [[ -f .env ]] && grep -qE '^DB_DATA_DIR=.{1,}$' .env; then
  include_persist=true
fi

compose_files=(-f docker-compose.yml -f docker-compose.prod.yml)
if [[ "$include_persist" == true ]]; then compose_files+=(-f docker-compose.persist.yml); fi
if [[ "$include_tunnel" == true ]]; then compose_files+=(-f docker-compose.tunnel.yml); fi

echo "[repair-db] Using compose files: ${compose_files[*]}"

# Ensure services are up (db at least)
docker compose "${compose_files[@]}" up -d db backend || true

# Function to run SQL against the DB as the configured superuser (jarvis)
run_sql() {
  local sql="$1"
  docker compose "${compose_files[@]}" exec -T db psql -U jarvis -d jarvis -v ON_ERROR_STOP=1 -c "$sql"
}

echo "[repair-db] Fixing ownership and privileges for schema public..."

# Detect if 'jarvis' is superuser; if not, escalate by using the default 'postgres' role within the container
IS_SUPER=$(docker compose "${compose_files[@]}" exec -T db sh -lc "psql -U jarvis -d jarvis -tAc \"SELECT usesuper FROM pg_user WHERE usename='jarvis'\"")
IS_SUPER=${IS_SUPER//[$'\r\n\t ']}

if [[ "$IS_SUPER" != "t" ]]; then
  echo "[repair-db] 'jarvis' is not superuser. Attempting ownership fix via local 'postgres' role..."
  # Use the cluster default superuser 'postgres' inside the container
  docker compose "${compose_files[@]}" exec -T db sh -lc 'psql -U postgres -d jarvis -v ON_ERROR_STOP=1' <<'SQL'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN 
    SELECT format('ALTER TABLE %I.%I OWNER TO jarvis;', schemaname, tablename) AS sql
    FROM pg_tables WHERE schemaname='public'
  LOOP
    EXECUTE r.sql;
  END LOOP;
  FOR r IN 
    SELECT format('ALTER SEQUENCE %I.%I OWNER TO jarvis;', sequence_schema, sequence_name) AS sql
    FROM information_schema.sequences WHERE sequence_schema='public'
  LOOP
    EXECUTE r.sql;
  END LOOP;
END $$;
SQL
else
  # 'jarvis' can do it directly
  docker compose "${compose_files[@]}" exec -T db sh -lc 'psql -U jarvis -d jarvis -v ON_ERROR_STOP=1' <<'SQL'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN 
    SELECT format('ALTER TABLE %I.%I OWNER TO jarvis;', schemaname, tablename) AS sql
    FROM pg_tables WHERE schemaname='public'
  LOOP
    EXECUTE r.sql;
  END LOOP;
  FOR r IN 
    SELECT format('ALTER SEQUENCE %I.%I OWNER TO jarvis;', sequence_schema, sequence_name) AS sql
    FROM information_schema.sequences WHERE sequence_schema='public'
  LOOP
    EXECUTE r.sql;
  END LOOP;
END $$;
SQL
fi

# Ensure grants and default privileges are correct (can be done by jarvis)
run_sql "GRANT ALL PRIVILEGES ON SCHEMA public TO jarvis;"
run_sql "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO jarvis;"
run_sql "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO jarvis;"
run_sql "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO jarvis;"
run_sql "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO jarvis;"
run_sql "ALTER TABLE IF EXISTS public._prisma_migrations OWNER TO jarvis;"

## Reconcile previous failed migration(s)
# 1) If an earlier migration failed (add_studyprogress_fks), mark it as applied so idempotent later migration can proceed.
echo "[repair-db] Ensuring prior failed FK migration is cleared (if present)"
docker compose "${compose_files[@]}" exec -T backend sh -lc 'npx prisma migrate resolve --applied 20251009050000_add_studyprogress_fks' || true

# 2) Do NOT roll back source_guide unless it was actually applied; previous behavior caused P3011.
echo "[repair-db] Checking StudySet.sourceGuideId presence..."
HAS_SOURCE_GUIDE=$(docker compose "${compose_files[@]}" exec -T db sh -lc "psql -U jarvis -d jarvis -tAc \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='StudySet' AND column_name='sourceGuideId');\"")
HAS_SOURCE_GUIDE=${HAS_SOURCE_GUIDE//[$'\r\n\t ']}
echo "[repair-db] sourceGuideId exists? => ${HAS_SOURCE_GUIDE:-unknown}"

echo "[repair-db] Applying Prisma migrations..."
if docker compose "${compose_files[@]}" exec -T backend sh -lc 'npx prisma migrate deploy'; then
  echo "[repair-db] Migrations applied successfully."
else
  echo "[repair-db] migrate deploy returned error. Showing status and last attempt output:"
  docker compose "${compose_files[@]}" exec -T backend sh -lc 'npx prisma migrate status || true'
  exit 1
fi

echo "[repair-db] Done."
