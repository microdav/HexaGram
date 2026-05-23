#!/bin/bash
# HexaGram - sync du backend Node/Express sur la VM Freebox Ultra.
# Le tarball contient déjà dist/ + node_modules/ (prod) — pas de npm sur la VM.

set -euo pipefail

TARBALL=/tmp/hexagram-server.tar.gz
SERVER_DIR=/opt/hexagram/server
SERVICE=hexagram-api
OWNER=freebox
NODE_BIN=/opt/node-v22.11.0-linux-arm64/bin/node

if [ ! -f "$TARBALL" ]; then
  echo "ERREUR : $TARBALL absent."
  exit 1
fi

echo "=== 1. Prepare $SERVER_DIR ==="
mkdir -p "$SERVER_DIR/data"
chown "$OWNER:$OWNER" "$SERVER_DIR/data"
rm -rf "$SERVER_DIR/dist" "$SERVER_DIR/node_modules" "$SERVER_DIR/package.json"

echo "=== 2. Extract ==="
tar -xzf "$TARBALL" -C "$SERVER_DIR" --no-same-owner
chown -R "$OWNER:$OWNER" "$SERVER_DIR"

echo "=== 3. JWT secret si absent ==="
ENV_FILE="$SERVER_DIR/.env"
if [ ! -f "$ENV_FILE" ] || ! grep -q "HEXAGRAM_JWT_SECRET" "$ENV_FILE"; then
  SECRET=$("$NODE_BIN" -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  echo "HEXAGRAM_JWT_SECRET=$SECRET" > "$ENV_FILE"
  echo "JWT secret genere."
fi
chown "$OWNER:$OWNER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "=== 4. Service ==="
cp /tmp/hexagram-api.service /etc/systemd/system/hexagram-api.service
systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"
sleep 2
systemctl is-active "$SERVICE"

echo "Sync hexagram-server OK."
