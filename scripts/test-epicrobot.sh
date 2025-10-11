#!/usr/bin/env bash
set -euo pipefail

DOMAIN=${1:-epicrobot.zapto.org}
UPSTREAM="http://127.0.0.1/"
HU="http://127.0.0.1:8082/"

echo "[0/4] Direct upstream check (Holy-Unblocker at 127.0.0.1:8082)"
set -x
curl -sS -I ${HU} | sed -n '1,10p' || true
set +x

echo "[1/4] HTTP check to local :80 with Host header (expects 200/301/302)"
set -x
curl -sS -I -H "Host: ${DOMAIN}" ${UPSTREAM} | sed -n '1,10p'
set +x

if command -v curl >/dev/null 2>&1; then
  echo "[2/4] HTTPS check to https://${DOMAIN} (requires valid cert)"
  set -x
  curl -sS -I https://${DOMAIN} | sed -n '1,10p' || true
  set +x

  echo "[3/4] HTTPS check allowing self-signed (for debugging only)"
  set -x
  curl -sS -I -k https://${DOMAIN} | sed -n '1,10p' || true
  set +x
fi

echo "Done. If HTTP fails on step [1], verify your host proxy owns :80 and the vhost is enabled."
