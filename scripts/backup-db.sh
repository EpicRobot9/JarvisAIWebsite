#!/usr/bin/env bash
set -euo pipefail

# Create a timestamped SQL dump of the Postgres database used by this stack.
# Works with base + prod, and optionally includes persist/tunnel overrides.
# Output files are written under ./backups by default (create if missing).
#
# Usage examples:
#   ./scripts/backup-db.sh
#   PROJECT_NAME=techexplore ./scripts/backup-db.sh
#   DB_DATA_DIR=/opt/jarvis/db ./scripts/backup-db.sh   # auto-includes persist compose
#

PROJECT_NAME="${PROJECT_NAME:-techexplore}"
DIR_ROOT="${DIR_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
USE_TUNNEL="auto"   # auto|yes|no
BACKUP_DIR="${BACKUP_DIR:-$DIR_ROOT/backups}"

mkdir -p "$BACKUP_DIR"

cd "$DIR_ROOT"

if ! command -v docker &>/dev/null; then echo "Docker is required" >&2; exit 1; fi
if ! docker compose version &>/dev/null; then echo "Docker Compose plugin is required (docker compose)" >&2; exit 1; fi

export COMPOSE_PROJECT_NAME="$PROJECT_NAME"

# Determine optional compose overrides
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

echo "[backup-db] Using compose files: ${compose_files[*]}"

# Ensure DB is up
docker compose "${compose_files[@]}" up -d db || true

# Wait briefly for readiness
for i in $(seq 1 20); do
  if docker compose "${compose_files[@]}" exec -T db pg_isready -U jarvis -d jarvis >/dev/null 2>&1; then break; fi
  sleep 1
done

ts=$(date +%F_%H%M%S)
outfile="$BACKUP_DIR/${ts}-jarvis.sql"
echo "[backup-db] Writing $outfile ..."
docker compose "${compose_files[@]}" exec -T db pg_dump -U jarvis -d jarvis > "$outfile"

echo "[backup-db] Done. File: $outfile"
