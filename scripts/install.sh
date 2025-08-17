#!/usr/bin/env bash
set -euo pipefail

# One-liner style installer similar to popular projects. Example:
#   bash <(curl -fsSL https://raw.githubusercontent.com/EpicRobot9/JarvisAIWebsite/main/scripts/install.sh) --domain techexplore.us --token <CF_TOKEN>
# Or after cloning:
#   ./scripts/install.sh --domain techexplore.us --token <CF_TOKEN>

REPO_URL="${REPO_URL:-https://github.com/EpicRobot9/JarvisAIWebsite.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/jarvis}"
DOMAIN="${DOMAIN:-}"
TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-}"
PROJECT_NAME="${PROJECT_NAME:-techexplore}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
ELEVENLABS_API_KEY="${ELEVENLABS_API_KEY:-}"
ELEVENLABS_VOICE_ID="${ELEVENLABS_VOICE_ID:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--domain) DOMAIN="$2"; shift 2 ;;
    -t|--token) TOKEN="$2"; shift 2 ;;
    -p|--project) PROJECT_NAME="$2"; shift 2 ;;
    --openai-key) OPENAI_API_KEY="$2"; shift 2 ;;
    --elevenlabs-key) ELEVENLABS_API_KEY="$2"; shift 2 ;;
    --elevenlabs-voice) ELEVENLABS_VOICE_ID="$2"; shift 2 ;;
    -i|--install-dir) INSTALL_DIR="$2"; shift 2 ;;
    -r|--repo) REPO_URL="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--domain techexplore.us] [--token <CF_TOKEN>] [--openai-key <sk_...>] [--elevenlabs-key <...>] [--elevenlabs-voice <voiceId>] [--project techexplore] [--install-dir /opt/jarvis] [--repo <url>]";
      exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

if [[ ! -d "$INSTALL_DIR" ]]; then
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown "$USER":"$USER" "$INSTALL_DIR"
fi

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  git clone "$REPO_URL" "$INSTALL_DIR"
else
  echo "Repo already present at $INSTALL_DIR; pulling latest..."
  git -C "$INSTALL_DIR" pull --ff-only
fi

cd "$INSTALL_DIR"
DOMAIN="$DOMAIN" CLOUDFLARE_TUNNEL_TOKEN="$TOKEN" PROJECT_NAME="$PROJECT_NAME" \
  OPENAI_API_KEY="$OPENAI_API_KEY" ELEVENLABS_API_KEY="$ELEVENLABS_API_KEY" ELEVENLABS_VOICE_ID="$ELEVENLABS_VOICE_ID" \
  bash ./scripts/deploy.sh --domain "${DOMAIN:-}" ${TOKEN:+--token "$TOKEN"}

echo "\nInstall complete. Visit https://${DOMAIN:-your-domain} once DNS/Tunnel is configured."
