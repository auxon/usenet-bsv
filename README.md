# UsenetBSV — newsgroups with x402 Bitcoin SV payments

Live at **https://entangleit.com/usenetbsv** — hybrid **HTTP+x402 API** + **NNTP gateway** + a
React SPA with a browser burner wallet. Off-chain bodies, on-chain hash anchors.
No accounts — the paying BSV address is the identity (wallet-address pseudonymous).

x402 core reused from `bsv-wallets`: `exact`/`bsv:mainnet`, `402 + PAYMENT-REQUIRED`
-> retry with `PAYMENT-SIGNATURE` -> `200 + PAYMENT-RESPONSE`, GorillaPool ARC settle.

## Layout

```
src/worker.ts      Hono API (groups, post, feed, article, reports, relay, nick, anchor, proof)
                   + SPA asset serving (/usenetbsv/<path> -> frontend/dist)
src/usenet.ts      domain: validation, digests, Merkle root, D1 helpers
src/payments.ts    x402 gate (verifyAndSettle, settlement header)
src/bsv-x402.ts    strict v2 envelopes (copied from bsv-wallets)
src/facilitator.ts structural verify + ARC broadcast (copied from bsv-wallets)
src/meter.ts       KV rate-limit + metering (copied from bsv-wallets)
frontend/          Vite + React SPA (groups, threads, article reader, wallet, pay dialog, docs)
gateway/nntp-gateway.mjs  TCP NNTP gateway (AUTHINFO PAY ticket, X-PAYREQ)
schema.sql         D1 tables (ug_groups, ug_articles, ug_payments, ug_reports, ug_anchors, ug_identities)
scripts/seed-demo.mjs  generates seed-demo.sql (launch content; INSERT OR IGNORE, safe to re-run)
test/usenet.test.mjs   unit + gateway integration (node:test, in-memory D1, stubbed ARC)
```

## Local dev

```sh
cd /Users/rah/usenet-bsv
npm install
npm test && npm run typecheck
npm run db:migrate:local        # ug_ tables into the local D1 (shared `entangleit` DB)
npm run dev                     # worker + SPA on :8787
# SPA hot reload (proxies API to :8787):
npm run dev:ui                  # vite on :5180/usenetbsv/
```

## Deploy

```sh
npm run deploy                  # builds frontend/ then `wrangler deploy`
# attach routes (wrangler.jsonc): entangleit.com/usenetbsv[/ *] + legacy /usenet -> 308
```

## Payments (v1)

| Flow | Price | Goes to |
|---|---|---|
| Group create | 500 sats | protocol `PAY_TO` |
| Post | per-group (default 20) | group `pay_to` |
| Read | per-article (default 0/free) | article `pay_to` |
| Relay push/pull | 10 sats/batch | protocol `PAY_TO` |
| Report | 5 sats | protocol `PAY_TO` (3 distinct reporters hides) |
| Nick | 10 sats | protocol `PAY_TO` |

The web UI signs payments with a **browser burner wallet** (key in localStorage, funded by
sending sats to its address) — `frontend/src/lib/wallet.js` builds + signs a P2PKH tx and
retries with the x402 header. The server verifies and broadcasts; nothing is custodied.

## NNTP gateway

Public gateway: **`2.29.11.72:119`** (fallback `8119`) — Hetzner VPS `streammaster-bridge`,
Docker Compose, auto-restart, ufw rules. Details via `GET /api/nntp`.

```
telnet 2.29.11.72 119
CAPABILITIES
LIST
GROUP bsv.builders
XOVER 1-
ARTICLE 1
POST            (340 -> send headers + body, end with .)
# if 480: pay the quoted price with any x402 buyer, then:
AUTHINFO PAY <PAYMENT-SIGNATURE-base64>
X-PAYREQ        (full PAYMENT-REQUIRED challenge, multi-line)
CHECK <msgid> / TAKETHIS <msgid>  (paid relay, same ticket)
QUIT
```

Verification + settlement always happen in the Worker; the gateway only forwards the ticket in
the `PAYMENT-SIGNATURE` header and passes each reader's IP (`X-NNT-Client-IP`) for rate limiting.

Deploy / update the gateway:

```sh
sh deploy/deploy.sh                 # syncs to streammaster-bridge:/opt/nntp-gateway + compose up
```

Run it yourself instead:

```sh
USENET_BASE_URL=https://entangleit.com/usenetbsv npm run gateway
```

Live paid-post e2e (real sats, reads WIF from bsv-wallets/.dev.vars or $WIF):

```sh
NNTP_HOST=2.29.11.72 NNTP_PORT=119 npm run e2e:nntp
```

## Anchoring

Bodies live in D1 (v1, 200KB cap). `POST /api/anchor/run` batches unanchored digests into a
Merkle root (`ug_anchors`); `GET /api/article/:id/proof` returns `{digest, root, anchorId}`.
Each post's payment tx is already on-chain — a dedicated OP_RETURN anchor tx is the P2 step
(proof shape is forward-compatible).

## Free helpers (UI + agents)

`GET /api/stats`, `GET /api/latest?limit=`, `GET /api/manifest`, `GET /pricing`,
`POST /api/payreq`, `GET /facilitator/supported`.
