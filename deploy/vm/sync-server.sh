#!/bin/bash
# HexaGram - sync du backend Node/Express sur le VPS OVH (Debian 13, x86_64).
# Le tarball contient dist/ + package.json + package-lock.json, SANS node_modules :
# les dependances sont installees ici, en linux-x64, par `npm ci --omit=dev`
# (ne jamais copier de node_modules depuis le PC Windows ou l'ancienne VM ARM).
# Le .env et la base SQLite (data/) restent sur le VPS et ne sont jamais ecrases.
# Lance via : sudo bash /tmp/hexagram-sync-server.sh

set -euo pipefail

TARBALL=/tmp/hexagram-server.tar.gz
SERVER_DIR=/opt/hexagram/server
SERVICE=hexagram-api
PORT=3001
PUBLIC_URL=https://hexagram.davidlardy.com
OWNER=freebox
NODE_DIR=/opt/node
NODE_BIN=$NODE_DIR/bin/node

if [ ! -f "$TARBALL" ]; then
  echo "ERREUR : $TARBALL absent."
  exit 1
fi

echo "=== 1. Prepare $SERVER_DIR ==="
mkdir -p "$SERVER_DIR/data"
chown "$OWNER:$OWNER" "$SERVER_DIR/data"
# data/ et .env ne sont pas touches.
rm -rf "$SERVER_DIR/dist" "$SERVER_DIR/node_modules" \
       "$SERVER_DIR/package.json" "$SERVER_DIR/package-lock.json"

echo "=== 2. Extract ==="
tar -xzf "$TARBALL" -C "$SERVER_DIR" --no-same-owner
chown -R "$OWNER:$OWNER" "$SERVER_DIR"

echo "=== 3. npm ci --omit=dev (linux-x64, utilisateur $OWNER) ==="
sudo -u "$OWNER" -H bash -c "cd '$SERVER_DIR' && PATH=$NODE_DIR/bin:\$PATH npm ci --omit=dev"

echo "=== 4. JWT secret si absent ==="
ENV_FILE="$SERVER_DIR/.env"
if [ ! -f "$ENV_FILE" ] || ! grep -q "HEXAGRAM_JWT_SECRET" "$ENV_FILE"; then
  SECRET=$("$NODE_BIN" -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  # Ajout (>>) : ne jamais ecraser un .env existant.
  echo "HEXAGRAM_JWT_SECRET=$SECRET" >> "$ENV_FILE"
  echo "JWT secret genere."
fi
chown "$OWNER:$OWNER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "=== 5. Service ==="
cp /tmp/hexagram-api.service /etc/systemd/system/hexagram-api.service
systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"
sleep 2

echo "=== 6. Controles ==="
systemctl is-active "$SERVICE"
journalctl -u "$SERVICE" -n 30 --no-pager
# Pas de route /health : toute reponse HTTP (401 attendu sans jeton) prouve
# que l'API ecoute ; 000 = connexion refusee.
LOCAL=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/projects" || true)
echo "GET http://127.0.0.1:$PORT/api/projects -> $LOCAL"
PUBLIC=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_URL/api/projects" || true)
echo "GET $PUBLIC_URL/api/projects -> $PUBLIC"
if [ "$LOCAL" = "000" ] || [ "$PUBLIC" = "000" ]; then
  echo "ERREUR : l'API ne repond pas."
  exit 1
fi

echo "Sync hexagram-server OK."
