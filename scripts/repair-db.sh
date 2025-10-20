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

# Offer to run a quick backup before making changes (skip in CI/non-interactive)
if [[ -t 1 && -z "${SKIP_BACKUP:-}" ]]; then
  echo -n "[repair-db] Create a quick backup before repair? [Y/n]: "
  read -r ans || true
  if [[ -z "$ans" || "$ans" =~ ^[Yy]$ ]]; then
    echo "[repair-db] Running scripts/backup-db.sh ..."
    "$DIR_ROOT/scripts/backup-db.sh" || echo "[repair-db] Backup failed or not available; continuing"
  fi
fi

# Check DATABASE_URL in .env and warn if using localhost (should be 'db' for Docker)
DB_URL_RAW="$(grep -E '^DATABASE_URL=' .env | head -n1 | cut -d'=' -f2-)"
if [[ "$DB_URL_RAW" == *"localhost"* ]]; then
  echo "[repair-db] WARNING: DATABASE_URL uses 'localhost'. For Docker, use 'db' as host (e.g. postgresql://jarvis:jarvis@db:5432/jarvis?schema=public)" >&2
fi

# Test DB connectivity before migration
echo "[repair-db] Testing DB connectivity..."
if ! docker compose "${compose_files[@]}" exec -T db pg_isready -U jarvis -d jarvis; then
  echo "[repair-db] ERROR: Database is not reachable. Check container health, ports, and DATABASE_URL." >&2
  exit 2
fi


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

# Prisma P1001/P1000/permission auto-fix
echo "[repair-db] Checking Prisma migration errors..."
PRISMA_STATUS=$(docker compose "${compose_files[@]}" exec -T backend sh -lc 'npx prisma migrate status' 2>&1 || true)
if echo "$PRISMA_STATUS" | grep -q 'P1001'; then
  echo "[repair-db] Prisma error P1001: Can't reach database. Check DATABASE_URL and DB health." >&2
elif echo "$PRISMA_STATUS" | grep -q 'P1000'; then
  echo "[repair-db] Prisma error P1000: Authentication failed. Attempting to fix user/role..." >&2
  # Try to create jarvis role if missing
  docker compose "${compose_files[@]}" exec -T db sh -lc "psql -U postgres -d postgres -c \"CREATE ROLE jarvis WITH LOGIN PASSWORD 'jarvis';\" || true"
  docker compose "${compose_files[@]}" exec -T db sh -lc "psql -U postgres -d jarvis -c \"ALTER DATABASE jarvis OWNER TO jarvis;\""
  docker compose "${compose_files[@]}" exec -T db sh -lc "psql -U postgres -d jarvis -c \"GRANT ALL PRIVILEGES ON SCHEMA public TO jarvis;\""
  docker compose "${compose_files[@]}" exec -T db sh -lc "psql -U postgres -d jarvis -c \"ALTER TABLE IF EXISTS public._prisma_migrations OWNER TO jarvis;\" -c \"GRANT ALL PRIVILEGES ON TABLE public._prisma_migrations TO jarvis;\""
fi


## Reconcile previous failed migration(s)
# 1) If an earlier migration failed (add_studyprogress_fks), mark it as applied so idempotent later migration can proceed.
echo "[repair-db] Ensuring prior failed FK migration is cleared (if present)"
# Check if constraints already exist before marking migration as applied
HAS_SP_UID_FK=$(docker compose "${compose_files[@]}" exec -T db sh -lc "psql -U jarvis -d jarvis -tAc \"SELECT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='StudyProgress_userId_fkey');\"")
HAS_SP_UID_FK=${HAS_SP_UID_FK//[$'\r\n\t ']}
HAS_SP_SID_FK=$(docker compose "${compose_files[@]}" exec -T db sh -lc "psql -U jarvis -d jarvis -tAc \"SELECT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='StudyProgress_studySetId_fkey');\"")
HAS_SP_SID_FK=${HAS_SP_SID_FK//[$'\r\n\t ']}
if [[ "$HAS_SP_UID_FK" == "t" || "$HAS_SP_SID_FK" == "t" ]]; then
  docker compose "${compose_files[@]}" exec -T backend sh -lc 'npx prisma migrate resolve --applied 20251009050000_add_studyprogress_fks' || true
fi

# 2) Do NOT roll back source_guide unless it was actually applied; previous behavior caused P3011.
echo "[repair-db] Checking StudySet.sourceGuideId presence..."
HAS_SOURCE_GUIDE=$(docker compose "${compose_files[@]}" exec -T db sh -lc "psql -U jarvis -d jarvis -tAc \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='StudySet' AND column_name='sourceGuideId');\"")
HAS_SOURCE_GUIDE=${HAS_SOURCE_GUIDE//[$'\r\n\t ']}
echo "[repair-db] sourceGuideId exists? => ${HAS_SOURCE_GUIDE:-unknown}"

# Auto-resolve failed migrations (P3009)
echo "[repair-db] Checking for failed migrations (P3009)..."
FAILED_MIGRATION="20251009052000_add_bookmarks_to_progress"
FAILED_MIGRATION_PRESENT=$(docker compose "${compose_files[@]}" exec -T db sh -lc "psql -U jarvis -d jarvis -tAc \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='StudyProgress' AND column_name='bookmarks');\"")
FAILED_MIGRATION_PRESENT=${FAILED_MIGRATION_PRESENT//[$'\r\n\t ']}
if [[ "$FAILED_MIGRATION_PRESENT" == "t" ]]; then
  echo "[repair-db] Detected failed migration $FAILED_MIGRATION but DB changes exist. Marking as applied..."
  docker compose "${compose_files[@]}" exec -T backend sh -lc "npx prisma migrate resolve --applied $FAILED_MIGRATION"
fi

# Baseline early init if database was created manually without Prisma history table
echo "[repair-db] Checking Prisma migrations table exists..."
HAS_MIG_TBL=$(docker compose "${compose_files[@]}" exec -T db sh -lc "psql -U jarvis -d jarvis -tAc \"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations');\"")
HAS_MIG_TBL=${HAS_MIG_TBL//[$'\r\n\t ']}
if [[ "$HAS_MIG_TBL" != "t" ]]; then
  echo "[repair-db] _prisma_migrations missing; creating table to allow baseline..."
  docker compose "${compose_files[@]}" exec -T db sh -lc "psql -U jarvis -d jarvis -v ON_ERROR_STOP=1 -c 'CREATE TABLE IF NOT EXISTS public._prisma_migrations (id TEXT PRIMARY KEY, checksum TEXT, finished_at TIMESTAMP, migration_name TEXT, logs TEXT, rolled_back_at TIMESTAMP, started_at TIMESTAMP, applied_steps_count INTEGER);'"
fi

# If schema already has the objects from a migration, mark it applied to align history without dropping data
echo "[repair-db] Baseline: aligning migration history with existing schema (idempotent)"
baseline_if_present() {
  local mig_name="$1"; shift
  local sql_check="$1"; shift
  local present
  present=$(docker compose "${compose_files[@]}" exec -T db sh -lc "psql -U jarvis -d jarvis -tAc \"${sql_check}\"")
  present=${present//[$'\r\n\t ']}
  if [[ "$present" == "t" ]]; then
    docker compose "${compose_files[@]}" exec -T backend sh -lc "npx prisma migrate resolve --applied ${mig_name}" || true
  fi
}

# Examples for this repo
baseline_if_present 20250918164512_add_studyset "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='StudySet' AND table_schema='public');"
baseline_if_present 20251011000000_create_studyprogress_if_missing "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='StudyProgress' AND table_schema='public');"
baseline_if_present 20251013090000_create_boards_schema "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='Board' AND table_schema='public');"

echo "[repair-db] Applying Prisma migrations..."
if docker compose "${compose_files[@]}" exec -T backend sh -lc 'npx prisma migrate deploy'; then
  echo "[repair-db] Migrations applied successfully."
else
  echo "[repair-db] migrate deploy returned error. Showing status and last attempt output:"
  docker compose "${compose_files[@]}" exec -T backend sh -lc 'npx prisma migrate status || true'
  echo "[repair-db] If errors persist, check .env DATABASE_URL, DB health, and permissions."
  exit 1
fi

echo "[repair-db] Done."
