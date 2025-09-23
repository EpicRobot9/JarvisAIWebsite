#!/usr/bin/env bash
set -euo pipefail

# Reset the Postgres database for this stack.
# - Stops the stack
# - Wipes DB data (named volume or bind-mounted directory)
# - Brings the stack back up and reapplies Prisma migrations
# - Optionally reseeds admin credentials
#
# Usage examples:
#   ./scripts/reset-db.sh --force
#   PROJECT_NAME=techexplore ./scripts/reset-db.sh --admin-user admin \
#     --admin-password 'StrongPass123' --admin-reset once --force

PROJECT_NAME="${PROJECT_NAME:-techexplore}"
DIR_ROOT="${DIR_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
USE_TUNNEL="auto"   # auto|yes|no
FORCE=false
ADMIN_USER_IN="${ADMIN_USER:-}"
ADMIN_PASSWORD_IN="${ADMIN_PASSWORD:-}"
ADMIN_RESET_MODE="${ADMIN_RESET_MODE:-no}"  # no|once|always

while [[ $# -gt 0 ]]; do
  case "$1" in
    --use-tunnel) USE_TUNNEL="$2"; shift 2 ;;
    -p|--project) PROJECT_NAME="$2"; shift 2 ;;
    --admin-user) ADMIN_USER_IN="$2"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD_IN="$2"; shift 2 ;;
    --admin-reset)
      case "$2" in
        no|once|always) ADMIN_RESET_MODE="$2" ;;
        *) echo "--admin-reset must be one of: no|once|always" >&2; exit 1 ;;
      esac
      shift 2 ;;
    -y|--yes|--force) FORCE=true; shift ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--use-tunnel auto|yes|no] [--project NAME] [--force]
            [--admin-user USER] [--admin-password PASS] [--admin-reset no|once|always]

Resets the database by deleting ALL Postgres data, then bringing the stack back up
and applying Prisma migrations. Optionally reseeds admin credentials.
EOF
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if ! command -v docker &>/dev/null; then echo "Docker is required" >&2; exit 1; fi
if ! docker compose version &>/dev/null; then echo "Docker Compose plugin is required (docker compose)" >&2; exit 1; fi

cd "$DIR_ROOT"

# Helper to read key=value from .env
get_env() {
  local key="$1"
  local def_val="${2:-}"
  if [[ -f .env ]] && grep -q "^${key}=" .env; then
    grep -E "^${key}=" .env | head -n1 | sed -E "s/^${key}=//"
  else
    printf '%s' "$def_val"
  fi
}

export COMPOSE_PROJECT_NAME="$PROJECT_NAME"

# Decide whether to include tunnel file
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

# Include persistence compose when DB_DATA_DIR is configured
include_persist=false
DB_DATA_DIR_VALUE="${DB_DATA_DIR:-}"
if [[ -z "$DB_DATA_DIR_VALUE" ]]; then
  DB_DATA_DIR_VALUE="$(get_env DB_DATA_DIR)"
fi
if [[ -n "$DB_DATA_DIR_VALUE" ]]; then include_persist=true; fi

compose_files=(-f docker-compose.yml -f docker-compose.prod.yml)
if [[ "$include_persist" == true ]]; then compose_files+=(-f docker-compose.persist.yml); fi
if [[ "$include_tunnel" == true ]]; then compose_files+=(-f docker-compose.tunnel.yml); fi

echo "[reset-db] Using compose files: ${compose_files[*]}"

if [[ "$FORCE" != true ]]; then
  echo "WARNING: This will DELETE ALL database data for project '$PROJECT_NAME'."
  echo -n "Type RESET to continue: "
  read -r reply
  if [[ "$reply" != "RESET" ]]; then echo "Aborted."; exit 1; fi
fi

set -x
docker compose "${compose_files[@]}" down --remove-orphans || true
set +x

if [[ "$include_persist" == true ]]; then
  # Wipe bind-mounted directory safely
  mkdir -p "$DB_DATA_DIR_VALUE"
  if [[ -n "$DB_DATA_DIR_VALUE" && -d "$DB_DATA_DIR_VALUE" ]]; then
    echo "[reset-db] Wiping DB_DATA_DIR: $DB_DATA_DIR_VALUE"
    # Remove content including hidden files
    rm -rf "$DB_DATA_DIR_VALUE"/* "$DB_DATA_DIR_VALUE"/.[!.]* "$DB_DATA_DIR_VALUE"/..?* 2>/dev/null || true
  else
    echo "[reset-db] DB_DATA_DIR path not found: $DB_DATA_DIR_VALUE" >&2
  fi
else
  # Remove named docker volume
  DB_VOLUME_NAME_VALUE="${DB_VOLUME_NAME:-}"
  if [[ -z "$DB_VOLUME_NAME_VALUE" ]]; then
    DB_VOLUME_NAME_VALUE="$(get_env DB_VOLUME_NAME jarvis_db_data)"
  fi
  echo "[reset-db] Removing volume: $DB_VOLUME_NAME_VALUE"
  docker volume rm "$DB_VOLUME_NAME_VALUE" || true
fi

set -x
docker compose "${compose_files[@]}" up -d
set +x

# Post-up: ensure migrations are applied
echo "[reset-db] Applying Prisma migrations..."
for i in $(seq 1 20); do
  if docker compose "${compose_files[@]}" exec -T backend sh -lc 'npx prisma migrate deploy' >/dev/null 2>&1; then
    echo "[reset-db] Prisma migrations applied."
    applied=true
    break
  fi
  echo "[reset-db] migrate deploy not ready yet, retrying ($i/20) ..."
  sleep 3
done
if [[ "${applied:-false}" != true ]]; then
  echo "[reset-db] Warning: could not confirm migrations (backend may still be starting)."
fi

# Optional: reseed admin
if [[ -n "$ADMIN_USER_IN" || "$ADMIN_RESET_MODE" != "no" ]]; then
  if [[ -z "$ADMIN_PASSWORD_IN" && "$ADMIN_RESET_MODE" != "no" ]]; then
    # generate a password if performing reset without explicit password
    ADMIN_PASSWORD_IN=$(openssl rand -base64 18 2>/dev/null | tr -d '\n' | tr '/+' 'AB' | cut -c1-18)
  fi
  echo "[reset-db] Seeding admin (user=${ADMIN_USER_IN:-admin}, mode=${ADMIN_RESET_MODE})"
  docker compose "${compose_files[@]}" exec -T \
    -e ADMIN_USERNAMES="${ADMIN_USER_IN:-admin}" \
    -e ADMIN_DEFAULT_PASSWORD="${ADMIN_PASSWORD_IN:-changeme}" \
    -e ADMIN_SEED_MODE="${ADMIN_RESET_MODE}" \
    backend sh -lc 'npm run db:seed || true'
  if [[ "$ADMIN_RESET_MODE" != "no" ]]; then
    echo "[reset-db] Admin password: ${ADMIN_PASSWORD_IN:-changeme}"
  fi
fi

echo "[reset-db] Done. Stack is up and DB reset."
