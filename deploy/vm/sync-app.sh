#!/bin/bash
# HexaGram - sync de la build Vite (statique) sur la VM Freebox Ultra.
# Idempotent. Lance via : sudo bash /tmp/hexagram-sync-app.sh
#
# Pre-requis : /tmp/hexagram-dist.tar.gz transfere prealablement par scp,
# et /etc/caddy/Caddyfile contient deja le bloc :6503 (voir Caddyfile.hexagram).

set -euo pipefail

TARBALL=/tmp/hexagram-dist.tar.gz
APP_DIR=/opt/hexagram/app
OWNER=freebox

if [ ! -f "$TARBALL" ]; then
  echo "ERREUR : $TARBALL absent. Transfere-le d'abord via scp."
  exit 1
fi

echo "=== 1. Prepare $APP_DIR ==="
mkdir -p "$APP_DIR"
# clean ancien contenu pour eviter les fichiers orphelins (hashes Vite)
rm -rf "${APP_DIR:?}"/*

echo "=== 2. Extract $TARBALL -> $APP_DIR ==="
tar -xzf "$TARBALL" -C "$APP_DIR" --no-same-owner
chown -R "$OWNER:$OWNER" "$APP_DIR"

echo "=== 3. Reload Caddy ==="
systemctl reload caddy

echo "=== 4. Smoke test ==="
sleep 1
curl -fsS -o /dev/null -w "GET http://localhost:6503/ -> %{http_code}\n" http://localhost:6503/

echo
echo "Sync hexagram OK."
