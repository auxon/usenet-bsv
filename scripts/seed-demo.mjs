#!/usr/bin/env node
// Generates scripts/seed-demo.sql — launch content for the network.
// Apply: wrangler d1 execute entangleit --remote --file=scripts/seed-demo.sql
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OPERATOR = '1DHBH964yuvJnneuUe7EKFpVyJK1Vkz8Y4';
const now = Date.now();
const H = 3600 * 1000;

const groups = [
  ['ug_demo_meta', 'usenet.meta', 'Announcements and meta discussion about UsenetBSV: protocol, pricing, federation.', 20, 0],
  ['ug_demo_builders', 'bsv.builders', 'Apps, tools, and protocols being built on Bitcoin SV.', 25, 0],
  ['ug_demo_x402', 'x402.economy', 'Agent payments, paid APIs, and the machine economy.', 20, 0],
  ['ug_demo_nntp', 'nntp.users', 'Classic newsreaders, peering, and gateway tips.', 20, 0],
];

// [id, group, parent, subject, nick, body, readPrice, hoursAgo]
const articles = [
  [
    'ua_demo_welcome', 'usenet.meta', null,
    'Welcome to UsenetBSV',
    'operator',
    `This is a newsgroup network where every action carries a price.

Posting costs sats. Reading can be free. Relaying is paid per batch. No accounts, no ads, no shadowbans — the paying address is the identity, and the payment is the spam filter.

How it works:
  1. Browse and read previews for free.
  2. Paid actions answer HTTP 402 with a price in sats and a BSV address.
  3. Your client signs a transaction, retries with the proof, and the server settles it on-chain before answering.

Classic newsreaders can join through the NNTP gateway (see #nntp.users). Everything else speaks plain HTTP + x402.

The chain is the receipt: every post is bound to the transaction that paid for it, and article digests are batched into Merkle anchors you can verify at any time.`,
    0, 26,
  ],
  [
    'ua_demo_nntp_tip', 'nntp.users', null,
    'Connect a newsreader in 60 seconds',
    'operator',
    `Run the gateway next to your reader:

  USENET_BASE_URL=https://entangleit.com/usenetbsv GATEWAY_PORT=1119 node gateway/nntp-gateway.mjs

Then point your NNTP client at localhost:1119. GROUP, XOVER, ARTICLE and friends work like it is 1994 — until you hit a paid action, where the server answers 480 with price and payTo.

Pay out-of-band with any x402 client, send AUTHINFO PAY <PAYMENT-SIGNATURE>, and retry the command. X-PAYREQ returns the full challenge for readers that cannot open a browser mid-session.`,
    0, 20,
  ],
  [
    'ua_demo_exact', 'bsv.builders', null,
    'x402 on BSV: the exact scheme in one page',
    'operator',
    `The x402 handshake is deliberately boring, which is why it works:

  PAYMENT-REQUIRED: base64({
    x402Version: 2, scheme: "exact", network: "bsv:mainnet",
    amount: "20", payTo: "1...", asset: "native:BSV"
  })

The payload you send back is a fully signed raw transaction with at least one P2PKH output to payTo worth >= amount, plus that same envelope. The server checks the script matches the advertised address, sums the outputs, and broadcasts through ARC.

No custodial step. No API keys. The transaction is the authorization — which is why the same header works for a human in a browser and an agent in a cron job.`,
    0, 15,
  ],
  [
    'ua_demo_burner', 'bsv.builders', null,
    'Micropayment UX: the case for browser burners',
    'operator',
    `Every wallet flow starts with a funding screen, but the interesting question is what happens after.

A burner wallet generated in the browser — key in localStorage, address funded with a few hundred sats — turns "sign up and add a card" into "scan, send, post". The failure mode is obvious: it is a hot wallet. The honest framing is to keep balances small, show them constantly, and let power users export the key to a real wallet when the balance grows.

This post is priced at 25 sats, so clicking through it should feel like buying a stamp, not opening a bank account.`,
    25, 9,
  ],
  [
    'ua_demo_receipts', 'x402.economy', null,
    'Agents need receipts, not invoices',
    'operator',
    `An invoice is a promise to settle later. A receipt is proof that value moved.

When an agent pays per call, the interesting artifact is not the 200 response — it is the txid bound to the resource it bought. x402 closes the loop by returning PAYMENT-RESPONSE with the settlement details, and this network binds it further: article digests, anchor batches, and the paying transaction all reference each other.

If the agent cannot prove what it paid for, its operator cannot audit it. Receipts are the difference between an expense and an explanation.`,
    0, 7,
  ],
  [
    'ua_demo_quote', 'x402.economy', null,
    'What should a 402 quote include?',
    'operator',
    `Bare minimum: price, asset, network, recipient. But quotes get better when they carry context.

This network includes a resource description, the dust floor, the ARC endpoint, and — when a USD price was configured — the USD cents and the BSV/USD rate used at quote time. The buyer can verify the math instead of trusting it.

What else belongs in a quote? Expiry bounds, a max-amount for metered calls, and a resource digest for large downloads. Reply with your list.`,
    0, 4,
  ],
];

function digest(group, author, subject, body) {
  return createHash('sha256').update(`${group}\n${author}\n${subject}\n${body}`).digest('hex');
}

function esc(s) {
  return String(s).replace(/'/g, "''");
}

let sql = '-- Launch content for UsenetBSV. Generated by scripts/seed-demo.mjs\n';
sql += '-- Safe to re-run: INSERT OR IGNORE on stable ids.\n\n';

const counts = new Map();
for (const a of articles) counts.set(a[1], (counts.get(a[1]) ?? 0) + 1);

for (const [id, name, desc, postPrice, readPrice] of groups) {
  sql += `INSERT OR IGNORE INTO ug_groups (id, name, description, owner_addr, post_price_sats, read_price_default, pay_to, created_at, article_count) VALUES ('${id}', '${esc(name)}', '${esc(desc)}', '${OPERATOR}', ${postPrice}, ${readPrice}, '${OPERATOR}', ${now - 30 * H}, ${counts.get(name) ?? 0});\n`;
}
sql += '\n';

for (const [id, group, parent, subject, nick, body, readPrice, hoursAgo] of articles) {
  const groupRow = groups.find((g) => g[1] === group);
  const created = now - hoursAgo * H;
  const d = digest(group, OPERATOR, subject, body);
  sql += `INSERT OR IGNORE INTO ug_articles (id, message_id, group_id, parent_id, author_addr, author_nick, subject, body, digest, pay_to, read_price_sats, created_tx, anchor_id, hidden, created_at) VALUES ('${id}', '<${id}@usenet-bsv>', '${groupRow[0]}', ${parent ? `'${parent}'` : 'NULL'}, '${OPERATOR}', '${nick}', '${esc(subject)}', '${esc(body)}', '${d}', '${OPERATOR}', ${readPrice}, '', NULL, 0, ${created});\n`;
}

const out = join(dirname(fileURLToPath(import.meta.url)), 'seed-demo.sql');
writeFileSync(out, sql);
console.log(`wrote ${out} (${groups.length} groups, ${articles.length} articles)`);
