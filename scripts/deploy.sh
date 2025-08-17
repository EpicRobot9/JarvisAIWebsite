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

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--domain) DOMAIN="$2"; shift 2 ;;
    -t|--token) TOKEN="$2"; shift 2 ;;
    -p|--project) PROJECT_NAME="$2"; shift 2 ;;
    --no-build) NO_BUILD=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--domain techexplore.us] [--token <cloudflare_tunnel_token>] [--project techexplore] [--no-build]";
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
  if grep -q '^FRONTEND_ORIGIN=' "$DIR_ROOT/.env"; then
    sed -i "s|^FRONTEND_ORIGIN=.*$|FRONTEND_ORIGIN=https://${DOMAIN}|" "$DIR_ROOT/.env"
  else
    printf '\nFRONTEND_ORIGIN=https://%s\n' "$DOMAIN" >> "$DIR_ROOT/.env"
  fi
fi

# If token provided, write it into env (non-destructive append if missing)
if [[ -n "$TOKEN" ]]; then
  if grep -q '^CLOUDFLARE_TUNNEL_TOKEN=' "$DIR_ROOT/.env"; then
    sed -i "s|^CLOUDFLARE_TUNNEL_TOKEN=.*$|CLOUDFLARE_TUNNEL_TOKEN=${TOKEN}|" "$DIR_ROOT/.env"
  else
    printf 'CLOUDFLARE_TUNNEL_TOKEN=%s\n' "$TOKEN" >> "$DIR_ROOT/.env"
  fi
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

echo "\nDeployed. If using Cloudflare Tunnel, ensure a Public Hostname techexplore.us -> http://frontend:80 is configured."
