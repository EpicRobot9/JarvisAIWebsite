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
OPENAI_API_KEY_IN="${OPENAI_API_KEY:-}"
ELEVENLABS_API_KEY_IN="${ELEVENLABS_API_KEY:-}"
ELEVENLABS_VOICE_ID_IN="${ELEVENLABS_VOICE_ID:-}"
# Admin control
ADMIN_USER_IN="${ADMIN_USER:-}"
ADMIN_PASSWORD_IN="${ADMIN_PASSWORD:-}"
ADMIN_RESET_MODE="${ADMIN_RESET_MODE:-no}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--domain) DOMAIN="$2"; shift 2 ;;
    --use-tunnel) USE_TUNNEL="$2"; shift 2 ;;
    --openai-key) OPENAI_API_KEY_IN="$2"; shift 2 ;;
    --elevenlabs-key) ELEVENLABS_API_KEY_IN="$2"; shift 2 ;;
    --elevenlabs-voice) ELEVENLABS_VOICE_ID_IN="$2"; shift 2 ;;
    --pull) PULL=true; shift ;;
    --no-build) NO_BUILD=true; shift ;;
    -p|--project) PROJECT_NAME="$2"; shift 2 ;;
    --admin-user) ADMIN_USER_IN="$2"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD_IN="$2"; shift 2 ;;
    --admin-reset)
      case "$2" in
        no|once|always) ADMIN_RESET_MODE="$2" ;;
        *) echo "--admin-reset must be one of: no|once|always"; exit 1 ;;
      esac
      shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--pull] [--domain techexplore.us] [--use-tunnel auto|yes|no] [--openai-key <sk_...>] [--elevenlabs-key <...>] [--elevenlabs-voice <voiceId>] [--no-build] [--project techexplore]";
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

# Helper for .env upsert
set_env() {
  local key="$1"; shift
  local val="$1"; shift || true
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*$|${key}=${val}|" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}

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
  set_env FRONTEND_ORIGIN "https://${DOMAIN}"
fi

# Optionally inject keys
if [[ -n "$OPENAI_API_KEY_IN" ]]; then set_env OPENAI_API_KEY "$OPENAI_API_KEY_IN"; fi
if [[ -n "$ELEVENLABS_API_KEY_IN" ]]; then set_env ELEVENLABS_API_KEY "$ELEVENLABS_API_KEY_IN"; fi
if [[ -n "$ELEVENLABS_VOICE_ID_IN" ]]; then set_env ELEVENLABS_VOICE_ID "$ELEVENLABS_VOICE_ID_IN"; fi

# Admin ensure/reset per request
if [[ -n "$ADMIN_USER_IN" ]]; then
  set_env ADMIN_USERNAMES "$ADMIN_USER_IN"
fi

if [[ "$ADMIN_RESET_MODE" != "no" ]]; then
  PASS_TO_USE="$ADMIN_PASSWORD_IN"
  if [[ -z "$PASS_TO_USE" ]]; then
    PASS_TO_USE=$(openssl rand -base64 18 2>/dev/null | tr -d '\n' | tr '/+' 'AB' | cut -c1-18)
  fi
  set_env ADMIN_DEFAULT_PASSWORD "$PASS_TO_USE"
  set_env ADMIN_SEED_MODE "reset"
  # Trigger seeding: persist for 'always', export for one-off otherwise
  if [[ "$ADMIN_RESET_MODE" == "always" ]]; then
    set_env SEED_ON_START "true"
  else
    export SEED_ON_START=true
  fi
  echo "[update] Admin reset requested (${ADMIN_RESET_MODE}). Username=$(grep '^ADMIN_USERNAMES=' .env | cut -d= -f2), Password=${PASS_TO_USE}"
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

# Include persistence compose when DB_DATA_DIR is configured
include_persist=false
if [[ -n "${DB_DATA_DIR:-}" ]]; then
  include_persist=true
elif [[ -f .env ]] && grep -qE '^DB_DATA_DIR=.{1,}$' .env; then
  include_persist=true
fi

compose_files=(-f docker-compose.yml -f docker-compose.prod.yml)
if [[ "$include_persist" == true ]]; then
  compose_files+=(-f docker-compose.persist.yml)
fi
if [[ "$include_tunnel" == true ]]; then
  compose_files+=(-f docker-compose.tunnel.yml)
fi

echo "[update] Using compose files: ${compose_files[*]}"

# Optionally refresh base images, then rebuild (or not)
docker compose "${compose_files[@]}" pull || true
if [[ "$NO_BUILD" == true ]]; then
  docker compose "${compose_files[@]}" up -d
else
  docker compose "${compose_files[@]}" up -d --build
fi
set +x

# Post-update: ensure migrations applied (backend entrypoint also does this)
echo "[update] Ensuring database migrations are applied..."
for i in $(seq 1 20); do
  if docker compose "${compose_files[@]}" exec -T backend sh -lc 'npx prisma migrate deploy' >/dev/null 2>&1; then
    echo "[update] Prisma migrations applied."
    applied=true
    break
  fi
  echo "[update] migrate deploy not ready yet, retrying ($i/20) ..."
  sleep 3
done
if [[ "${applied:-false}" != true ]]; then
  echo "[update] Warning: could not confirm migrations (backend may still be starting). Continuing."
fi

# Revert to ensure if requested once
if [[ "$ADMIN_RESET_MODE" == "once" ]]; then
  set_env ADMIN_SEED_MODE "ensure"
  echo "[update] Admin reset completed; reverting ADMIN_SEED_MODE=ensure."
fi

echo "\nUpdate complete. Visit https://${DOMAIN:-your-domain} (if domain configured)."

# Print admin summary for convenience
echo "\n--- Admin summary ---"
ADMIN_NAMES=$(grep -E '^ADMIN_USERNAMES=' .env 2>/dev/null | cut -d= -f2-)
if [[ -z "$ADMIN_NAMES" ]]; then
  ADMIN_NAMES=$(grep -E '^ADMIN_EMAILS=' .env 2>/dev/null | cut -d= -f2-)
fi
if [[ -z "$ADMIN_NAMES" ]]; then ADMIN_NAMES="admin"; fi
SEED_MODE=$(grep -E '^ADMIN_SEED_MODE=' .env 2>/dev/null | cut -d= -f2-)
ADMIN_PASS=$(grep -E '^ADMIN_DEFAULT_PASSWORD=' .env 2>/dev/null | cut -d= -f2-)
echo "Admin user(s): ${ADMIN_NAMES}"
if [[ -n "$ADMIN_PASS" ]]; then
  if [[ "$SEED_MODE" == "reset" ]]; then
    echo "Admin password: ${ADMIN_PASS} (from ADMIN_DEFAULT_PASSWORD; SEED reset)"
  else
    echo "Admin password: ${ADMIN_PASS} (from ADMIN_DEFAULT_PASSWORD; seed mode: ${SEED_MODE:-ensure})"
  fi
else
  echo "Admin password: unknown (seed mode: ${SEED_MODE:-ensure}). Use --admin-reset once|always to set."
fi
echo "----------------------\n"
