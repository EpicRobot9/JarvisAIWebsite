#!/usr/bin/env bash
set -euo pipefail

# Uninstall the entire stack from this server.
# - Stops and removes containers
# - Removes named volumes and images for this project
# - Optionally deletes bind-mounted data directory (DB_DATA_DIR)
# - Optionally deletes the entire install directory
#
# Usage examples:
#   ./scripts/uninstall.sh --force           # remove containers/volumes/images
#   ./scripts/uninstall.sh --force --purge   # also deletes DB_DATA_DIR content
#   ./scripts/uninstall.sh --nuke            # also deletes the whole install directory

PROJECT_NAME="${PROJECT_NAME:-techexplore}"
DIR_ROOT="${DIR_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PURGE_DATA=false
NUKE_DIR=false
FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--project) PROJECT_NAME="$2"; shift 2 ;;
    --purge) PURGE_DATA=true; shift ;;
    --nuke) NUKE_DIR=true; shift ;;
    -y|--yes|--force) FORCE=true; shift ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--project NAME] [--force] [--purge] [--nuke]

--force   Confirm removal of containers/volumes/images without prompting
--purge   Also delete DB_DATA_DIR contents (if configured) or named DB volume
--nuke    ALSO delete the entire install directory (${DIR_ROOT}) after teardown
EOF
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if ! command -v docker &>/dev/null; then echo "Docker is required" >&2; exit 1; fi
if ! docker compose version &>/dev/null; then echo "Docker Compose plugin is required (docker compose)" >&2; exit 1; fi

cd "$DIR_ROOT"
export COMPOSE_PROJECT_NAME="$PROJECT_NAME"

# Decide optional compose files
include_persist=false
if [[ -n "${DB_DATA_DIR:-}" ]]; then include_persist=true; fi
if [[ -f .env ]] && grep -qE '^DB_DATA_DIR=.{1,}$' .env; then include_persist=true; fi

compose_files=(-f docker-compose.yml -f docker-compose.prod.yml)
if [[ "$include_persist" == true ]]; then compose_files+=(-f docker-compose.persist.yml); fi
# Tunnel container will be removed regardless; including its file is optional
if [[ -f docker-compose.tunnel.yml ]]; then compose_files+=(-f docker-compose.tunnel.yml); fi

echo "[uninstall] Using compose files: ${compose_files[*]}"

if [[ "$FORCE" != true ]]; then
  echo "WARNING: This will STOP and REMOVE all containers for project '$PROJECT_NAME'."
  echo -n "Type REMOVE to continue: "
  read -r reply
  if [[ "$reply" != "REMOVE" ]]; then echo "Aborted."; exit 1; fi
fi

set -x
docker compose "${compose_files[@]}" down -v --remove-orphans || true
set +x

# Remove images belonging to this project (best-effort)
echo "[uninstall] Removing images with repository names like ${PROJECT_NAME}-* (best effort)"
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -E "^${PROJECT_NAME}-" | awk '{print $2}' | xargs -r docker rmi -f || true

# Purge data directory if requested
if [[ "$PURGE_DATA" == true ]]; then
  DB_DIR="${DB_DATA_DIR:-}"
  if [[ -z "$DB_DIR" && -f .env ]]; then
    DB_DIR=$(grep -E '^DB_DATA_DIR=' .env | head -n1 | sed -E 's/^DB_DATA_DIR=//')
  fi
  if [[ -n "$DB_DIR" ]]; then
    echo "[uninstall] Purging DB_DATA_DIR: $DB_DIR"
    rm -rf "$DB_DIR"/* "$DB_DIR"/.[!.]* "$DB_DIR"/..?* 2>/dev/null || true
  else
    # Remove named DB volume if any
    DB_VOL="${DB_VOLUME_NAME:-}"
    if [[ -z "$DB_VOL" && -f .env ]]; then
      DB_VOL=$(grep -E '^DB_VOLUME_NAME=' .env | head -n1 | sed -E 's/^DB_VOLUME_NAME=//')
    fi
    DB_VOL="${DB_VOL:-jarvis_db_data}"
    echo "[uninstall] Removing DB volume: $DB_VOL"
    docker volume rm "$DB_VOL" || true
  fi
fi

# Optional nuke of the whole install directory
if [[ "$NUKE_DIR" == true ]]; then
  if [[ "$FORCE" != true ]]; then
    echo "DANGER: This will DELETE the entire directory: $DIR_ROOT"
    echo -n "Type NUKE to confirm: "
    read -r reply
    if [[ "$reply" != "NUKE" ]]; then echo "Aborted."; exit 1; fi
  fi
  echo "[uninstall] Removing directory: $DIR_ROOT"
  cd / && rm -rf "$DIR_ROOT"
fi

echo "[uninstall] Done. Stack removed."
