#!/usr/bin/env bash
set -euo pipefail

# Update an existing deployment without interrupting other stacks.
# - Keeps your existing .env intact; only updates FRONTEND_ORIGIN when --domain is provided.
# - Automatically includes the Cloudflare Tunnel compose file if a token is present (auto),
#   or force include/exclude with --use-tunnel yes|no.
#
# Usage examples:
#   ./scripts/update.sh --pull
#   ./scripts/update.sh --domain techexplore.us --use-tunnel auto
#   PROJECT_NAME=techexplore ./scripts/update.sh --no-build

PROJECT_NAME="${PROJECT_NAME:-techexplore}"
DIR_ROOT="${DIR_ROOT:-$(pwd)}"
DOMAIN="${DOMAIN:-}"
USE_TUNNEL="auto"   # auto|yes|no
PULL=false
NO_BUILD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--domain) DOMAIN="$2"; shift 2 ;;
    --use-tunnel) USE_TUNNEL="$2"; shift 2 ;;
    --pull) PULL=true; shift ;;
    --no-build) NO_BUILD=true; shift ;;
    -p|--project) PROJECT_NAME="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--pull] [--domain techexplore.us] [--use-tunnel auto|yes|no] [--no-build] [--project techexplore]";
      exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

if ! command -v docker &>/dev/null; then
  echo "Docker is required" >&2; exit 1
fi
if ! docker compose version &>/dev/null; then
  echo "Docker Compose plugin is required (docker compose)" >&2; exit 1
fi

cd "$DIR_ROOT"

# Optional git pull for code updates
if [[ "$PULL" == true ]]; then
  if [ -d .git ]; then
    git pull --ff-only || { echo "Git pull failed" >&2; exit 1; }
  else
    echo "No git repo at $DIR_ROOT; skipping pull" >&2
  fi
fi

# Safe .env tweak only if domain provided
if [[ -n "$DOMAIN" ]]; then
  if grep -q '^FRONTEND_ORIGIN=' .env 2>/dev/null; then
    sed -i "s|^FRONTEND_ORIGIN=.*$|FRONTEND_ORIGIN=https://${DOMAIN}|" .env
  else
    printf '\nFRONTEND_ORIGIN=https://%s\n' "$DOMAIN" >> .env
  fi
fi

# Decide whether to include the tunnel compose file
include_tunnel=false
case "$USE_TUNNEL" in
  yes) include_tunnel=true ;;
  no) include_tunnel=false ;;
  auto)
    # include if CLOUDFLARE_TUNNEL_TOKEN is set in env or present (non-empty) in .env
    if [[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
      include_tunnel=true
    elif [[ -f .env ]] && grep -q '^CLOUDFLARE_TUNNEL_TOKEN=' .env && \
         grep -E '^CLOUDFLARE_TUNNEL_TOKEN=.{10,}$' .env >/dev/null; then
      include_tunnel=true
    else
      include_tunnel=false
    fi
    ;;
  *) echo "--use-tunnel must be one of: auto|yes|no"; exit 1 ;;
 esac

set -x
export COMPOSE_PROJECT_NAME="$PROJECT_NAME"

compose_files=(-f docker-compose.yml -f docker-compose.prod.yml)
if [[ "$include_tunnel" == true ]]; then
  compose_files+=(-f docker-compose.tunnel.yml)
fi

# Optionally refresh base images, then rebuild (or not)
 docker compose "${compose_files[@]}" pull || true
if [[ "$NO_BUILD" == true ]]; then
  docker compose "${compose_files[@]}" up -d
else
  docker compose "${compose_files[@]}" up -d --build
fi
set +x

echo "\nUpdate complete. Visit https://${DOMAIN:-your-domain} (if domain configured)."
