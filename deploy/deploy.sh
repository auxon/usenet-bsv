#!/bin/sh
# Deploy the NNTP gateway to the Hetzner VPS (docker compose).
# Usage: sh deploy/deploy.sh [ssh-host]   (default: streammaster-bridge)
set -eu

HOST="${1:-streammaster-bridge}"
DEST=/opt/nntp-gateway
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> syncing files to $HOST:$DEST"
ssh "$HOST" "mkdir -p $DEST"
scp -q "$ROOT/gateway/nntp-gateway.mjs" "$ROOT/deploy/Dockerfile" "$ROOT/deploy/docker-compose.yml" "$HOST:$DEST/"

echo "==> building + starting container"
ssh "$HOST" "cd $DEST && docker compose up -d --build --quiet-pull 2>&1 | tail -3 && docker compose ps --format '{{.Name}} {{.Status}}'"

echo "==> firewall (idempotent)"
ssh "$HOST" "ufw allow 119/tcp comment 'nntp' >/dev/null && ufw allow 8119/tcp comment 'nntp-fallback' >/dev/null && ufw status | grep -E '119|8119'"

echo "==> external probe"
sleep 2
if nc -z -w 5 "$HOST" 119 2>/dev/null; then
  echo "port 119 reachable on $HOST"
else
  echo "WARNING: port 119 not reachable from here yet (check ufw / Hetzner cloud firewall)"
fi
