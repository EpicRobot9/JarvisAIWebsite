#!/usr/bin/env bash
set -euo pipefail

# Fully remove Jarvis: containers, images (best-effort), data, and the install directory itself.
# This is a thin wrapper around uninstall.sh with --purge and --nuke.
#
# Usage examples:
#   bash ./scripts/full-wipe.sh                 # interactive confirmations
#   bash ./scripts/full-wipe.sh -y              # no prompts
#   bash ./scripts/full-wipe.sh -p myproject -y # custom compose project name
#
# Env overrides:
#   PROJECT_NAME   Compose project name (default: techexplore)
#   DIR_ROOT       Install dir to nuke (default: repo root)

PROJECT_NAME="${PROJECT_NAME:-techexplore}"
DIR_ROOT="${DIR_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--project) PROJECT_NAME="$2"; shift 2 ;;
    -y|--yes|--force) FORCE=true; shift ;;
    -h|--help)
      cat <<EOF
Fully remove Jarvis, its data, and the install directory.

Usage: $0 [-p|--project NAME] [-y|--yes]

Options:
  -p, --project NAME   Compose project name (default: $PROJECT_NAME)
  -y, --yes            Skip confirmations (force)

Environment:
  PROJECT_NAME         Compose project name
  DIR_ROOT             Install directory to delete (default: $DIR_ROOT)
EOF
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Safety checks
if [[ ! -f "$DIR_ROOT/scripts/uninstall.sh" ]]; then
  echo "Could not find uninstall.sh at $DIR_ROOT/scripts/uninstall.sh" >&2
  exit 1
fi

if [[ "$DIR_ROOT" == "/" || "$DIR_ROOT" == "" ]]; then
  echo "Refusing to run: DIR_ROOT resolves to '$DIR_ROOT'" >&2
  exit 1
fi

echo "[full-wipe] Project: $PROJECT_NAME"
echo "[full-wipe] Install dir to delete: $DIR_ROOT"
echo "[full-wipe] This will STOP containers, REMOVE volumes/data, and DELETE the entire directory."

if [[ "$FORCE" != true ]]; then
  echo -n "Type NUKE to confirm: "
  read -r reply
  if [[ "$reply" != "NUKE" ]]; then echo "Aborted."; exit 1; fi
fi

export PROJECT_NAME
export DIR_ROOT

args=(--purge --nuke)
if [[ "$FORCE" == true ]]; then args+=(--force); fi

"$DIR_ROOT/scripts/uninstall.sh" "${args[@]}"

echo "[full-wipe] Complete. The directory $DIR_ROOT should now be removed."
