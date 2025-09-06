#!/usr/bin/env bash
set -euo pipefail

# Deploy the stack without interrupting other containers.
# - Keeps your existing .env values intact; only updates FRONTEND_ORIGIN when --domain is provided.
# - If a Cloudflare Tunnel token is provided (env or flag), also runs the tunnel sidecar.
#
# Usage examples:
#   ./scripts/deploy.sh --domain techexplore.us --token $CLOUDFLARE_TUNNEL_TOKEN
#   DOMAIN=techexplore.us CLOUDFLARE_TUNNEL_TOKEN=... ./scripts/deploy.sh

DOMAIN="${DOMAIN:-}"
TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-}"
PROJECT_NAME="${PROJECT_NAME:-techexplore}"
DIR_ROOT="${DIR_ROOT:-$(pwd)}"
NO_BUILD=false
OPENAI_API_KEY_IN="${OPENAI_API_KEY:-}"
ELEVENLABS_API_KEY_IN="${ELEVENLABS_API_KEY:-}"
ELEVENLABS_VOICE_ID_IN="${ELEVENLABS_VOICE_ID:-}"
# Admin bootstrap controls
ADMIN_USER_IN="${ADMIN_USER:-}"
ADMIN_PASSWORD_IN="${ADMIN_PASSWORD:-}"
# admin reset mode: no|once|always
ADMIN_RESET_MODE="${ADMIN_RESET_MODE:-no}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--domain) DOMAIN="$2"; shift 2 ;;
    -t|--token) TOKEN="$2"; shift 2 ;;
    -p|--project) PROJECT_NAME="$2"; shift 2 ;;
    --openai-key) OPENAI_API_KEY_IN="$2"; shift 2 ;;
    --elevenlabs-key) ELEVENLABS_API_KEY_IN="$2"; shift 2 ;;
    --elevenlabs-voice) ELEVENLABS_VOICE_ID_IN="$2"; shift 2 ;;
    --no-build) NO_BUILD=true; shift ;;
    --admin-user) ADMIN_USER_IN="$2"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD_IN="$2"; shift 2 ;;
    --admin-reset)
      case "$2" in
        no|once|always) ADMIN_RESET_MODE="$2" ;;
        *) echo "--admin-reset must be one of: no|once|always" >&2; exit 1 ;;
      esac
      shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--domain techexplore.us] [--token <cloudflare_tunnel_token>] [--openai-key <sk_...>] [--elevenlabs-key <...>] [--elevenlabs-voice <voiceId>] [--project techexplore] [--no-build]";
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

# Helper to upsert KEY=VALUE lines in .env
set_env() {
  local key="$1"; shift
  local val="$1"; shift || true
  if grep -q "^${key}=" "$DIR_ROOT/.env" 2>/dev/null; then
    sed -i "s|^${key}=.*$|${key}=${val}|" "$DIR_ROOT/.env"
  else
    printf '%s=%s\n' "$key" "$val" >> "$DIR_ROOT/.env"
  fi
}

# If .env exists, keep it; only change FRONTEND_ORIGIN if DOMAIN provided.
if [[ ! -f "$DIR_ROOT/.env" ]]; then
  echo "No .env found; creating a minimal production one (you can edit later)." >&2
  # Generate a random SESSION_SECRET
  SECRET=$(openssl rand -hex 32 2>/dev/null || uuidgen | tr -d '-')
  cat > "$DIR_ROOT/.env" <<'EOF'
DATABASE_URL=postgresql://postgres:postgres@db:5432/jarvis
SESSION_SECRET=
BACKEND_PORT=8080
FRONTEND_ORIGIN=http://localhost:5173
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=7dxS4V4NqL8xqL4PSiMp
REQUIRE_ADMIN_APPROVAL=false
LOCK_NEW_ACCOUNTS=false
ADMIN_EMAILS=admin@example.com
# Default admin bootstrap settings for production
ADMIN_DEFAULT_PASSWORD=changeme
ADMIN_SEED_MODE=ensure
SEED_DB=true
VITE_WEBHOOK_URL=
VITE_WEBHOOK_TEST_URL=
VITE_CALLBACK_URL=/api/jarvis/callback
VITE_SOURCE_NAME=jarvis-portal
INTEGRATION_PUSH_TOKEN=
EOF
  # inject generated secret
  sed -i "s|^SESSION_SECRET=.*$|SESSION_SECRET=${SECRET}|" "$DIR_ROOT/.env"
fi

if [[ -n "${DOMAIN}" ]]; then
  # Update or append FRONTEND_ORIGIN to https://DOMAIN
  set_env FRONTEND_ORIGIN "https://${DOMAIN}"
fi

# If token provided, write it into env (non-destructive append if missing)
if [[ -n "$TOKEN" ]]; then
  set_env CLOUDFLARE_TUNNEL_TOKEN "$TOKEN"
fi

# If keys provided, write them into .env (create or update)
if [[ -n "$OPENAI_API_KEY_IN" ]]; then
  set_env OPENAI_API_KEY "$OPENAI_API_KEY_IN"
fi

if [[ -n "$ELEVENLABS_API_KEY_IN" ]]; then
  set_env ELEVENLABS_API_KEY "$ELEVENLABS_API_KEY_IN"
fi

if [[ -n "$ELEVENLABS_VOICE_ID_IN" ]]; then
  set_env ELEVENLABS_VOICE_ID "$ELEVENLABS_VOICE_ID_IN"
fi

# --- Admin bootstrap/ensure ---
# If admin username provided, set it; otherwise, if missing in .env, default to 'admin'.
if [[ -n "$ADMIN_USER_IN" ]]; then
  set_env ADMIN_USERNAMES "$ADMIN_USER_IN"
else
  if ! grep -q '^ADMIN_USERNAMES=' "$DIR_ROOT/.env" 2>/dev/null; then
    set_env ADMIN_USERNAMES "admin"
  fi
fi

# If reset is requested, prepare seeding variables
if [[ "$ADMIN_RESET_MODE" != "no" ]]; then
  PASS_TO_USE="$ADMIN_PASSWORD_IN"
  if [[ -z "$PASS_TO_USE" ]]; then
    # Generate a reasonably strong password if none provided
    PASS_TO_USE=$(openssl rand -base64 18 2>/dev/null | tr -d '\n' | tr '/+' 'AB' | cut -c1-18)
  fi
  set_env ADMIN_DEFAULT_PASSWORD "$PASS_TO_USE"
  set_env ADMIN_SEED_MODE "reset"
  set_env SEED_DB "true"
  echo "\n[deploy] Admin reset requested (${ADMIN_RESET_MODE}). Username=$(grep '^ADMIN_USERNAMES=' "$DIR_ROOT/.env" | cut -d= -f2), Password=${PASS_TO_USE}"
fi

set -x
export COMPOSE_PROJECT_NAME="$PROJECT_NAME"
if [[ -n "$TOKEN" ]]; then
  if [[ "$NO_BUILD" == true ]]; then
    docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml up -d
  else
    docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml up -d --build
  fi
else
  if [[ "$NO_BUILD" == true ]]; then
    docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
  else
    docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
  fi
fi
set +x

# If reset was only for this run, switch back to ensure to avoid future auto-resets
if [[ "$ADMIN_RESET_MODE" == "once" ]]; then
  set_env ADMIN_SEED_MODE "ensure"
  # Optional: keep SEED_DB as-is; leaving true is harmless (ensure mode keeps password)
  echo "[deploy] Admin reset completed; reverting ADMIN_SEED_MODE=ensure for future runs."
fi

echo "\nDeployed. If using Cloudflare Tunnel, ensure a Public Hostname techexplore.us -> http://frontend:80 is configured."

# Print admin summary for convenience
echo "\n--- Admin summary ---"
ADMIN_NAMES=$(grep -E '^ADMIN_USERNAMES=' "$DIR_ROOT/.env" 2>/dev/null | cut -d= -f2-)
if [[ -z "$ADMIN_NAMES" ]]; then
  ADMIN_NAMES=$(grep -E '^ADMIN_EMAILS=' "$DIR_ROOT/.env" 2>/dev/null | cut -d= -f2-)
fi
if [[ -z "$ADMIN_NAMES" ]]; then ADMIN_NAMES="admin"; fi
SEED_MODE=$(grep -E '^ADMIN_SEED_MODE=' "$DIR_ROOT/.env" 2>/dev/null | cut -d= -f2-)
ADMIN_PASS=$(grep -E '^ADMIN_DEFAULT_PASSWORD=' "$DIR_ROOT/.env" 2>/dev/null | cut -d= -f2-)
echo "Admin user(s): ${ADMIN_NAMES}"
if [[ "$SEED_MODE" == "reset" && -n "$ADMIN_PASS" ]]; then
  echo "Admin password: ${ADMIN_PASS} (from ADMIN_DEFAULT_PASSWORD; SEED reset)"
else
  echo "Admin password: unchanged (seed mode: ${SEED_MODE:-ensure}). Use --admin-reset once|always to set."
fi
echo "----------------------\n"
