#!/bin/bash
# HexaGram - sync de la build Vite (statique) sur la VM Freebox Ultra.
# Idempotent. Lance via : sudo bash /tmp/hexagram-sync-app.sh
#
# Pre-requis : /tmp/hexagram-dist.tar.gz transfere prealablement par scp,
# et /etc/caddy/Caddyfile contient deja le bloc hexagram.davidlardy.com
# (voir Caddyfile.hexagram).

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
# Header Host pour que Caddy route vers le bloc hexagram.davidlardy.com,
# -k pour ignorer la verif du cert vu qu'on tape localhost en HTTPS interne.
curl -fsSk -H "Host: hexagram.davidlardy.com" \
  -o /dev/null -w "GET https://localhost/ (Host: hexagram.davidlardy.com) -> %{http_code}\n" \
  https://localhost/

echo
echo "Sync hexagram OK."
