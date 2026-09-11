# NNTP gateway deployment

The gateway runs on the Hetzner VPS `streammaster-bridge` (2.29.11.72) as a Docker
container, managed by Compose. It listens on `119` (standard) and `8119` (fallback)
and proxies to `https://entangleit.com/usenetbsv`.

## Files

- `Dockerfile` — node:22-alpine, non-root, copies `nntp-gateway.mjs`
- `docker-compose.yml` — ports, env, restart policy, healthcheck, log rotation
- `deploy.sh` — syncs the three files to `/opt/nntp-gateway` and runs `docker compose up -d --build`

## Deploy / update

```sh
sh deploy/deploy.sh                     # default host: streammaster-bridge
sh deploy/deploy.sh root@2.29.11.72     # explicit host
```

The script is idempotent: it re-syncs files, rebuilds the image, restarts the
container, keeps the ufw rules for 119/8119, and probes the port.

## Ops

```sh
ssh streammaster-bridge
cd /opt/nntp-gateway
docker compose ps
docker compose logs -f --tail=100
docker compose restart nntp-gateway
```

## Firewall

ufw allows 119/tcp and 8119/tcp (added by `deploy.sh`). If Hetzner's cloud
firewall is enabled for this server, add the same ports there too.

## Notes

- The gateway holds **no keys** — all x402 verification and ARC broadcast happen
  in the Cloudflare Worker.
- Each reader's IP is forwarded as `X-NNT-Client-IP` so the API rate limit is
  per-reader, not per-gateway.
- TLS/NNTPS (port 563) is not enabled in v1; Caddy on this host does not proxy
  raw TCP without the layer4 plugin.
