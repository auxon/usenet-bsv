#!/usr/bin/env node
// Live NNTP e2e: post a real paid article through the gateway.
//   NNTP_HOST=2.29.11.72 NNTP_PORT=119 GROUP=bsv.builders WIF=<burner WIF> node scripts/nntp-e2e.mjs
// Reads the WIF from $WIF, or $WIF_FILE (first matching line), or bsv-wallets/.dev.vars.
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { BurnerWallet } from '../frontend/src/lib/wallet.js';

const HOST = process.env.NNTP_HOST ?? process.env.HOST ?? '127.0.0.1';
const PORT = Number.parseInt(process.env.NNTP_PORT ?? '1119', 10);
const GROUP = process.env.GROUP ?? 'bsv.builders';
const SUBJECT = process.env.SUBJECT ?? `NNTP e2e ${new Date().toISOString()}`;

function readWif() {
  if (process.env.WIF) return process.env.WIF.trim();
  const file = process.env.WIF_FILE ?? '/Users/rah/bsv-wallets/.dev.vars';
  const text = readFileSync(file, 'utf8');
  const m = text.match(/BUYER_WIF="?([^"\n]+)"?/);
  if (!m) throw new Error(`no WIF in ${file}`);
  return m[1].trim();
}

class Nntp {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.buf = '';
    this.lines = [];
    this.waiters = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.createConnection({ host: this.host, port: this.port }, resolve);
      this.sock.setEncoding('utf8');
      this.sock.on('data', (c) => {
        this.buf += c;
        let i;
        while ((i = this.buf.indexOf('\r\n')) >= 0) {
          const line = this.buf.slice(0, i);
          this.buf = this.buf.slice(i + 2);
          const w = this.waiters.shift();
          if (w) w(line);
          else this.lines.push(line);
        }
      });
      this.sock.on('error', reject);
    });
  }
  line(timeout = 30000) {
    if (this.lines.length) return Promise.resolve(this.lines.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for NNTP line')), timeout);
      this.waiters.push((l) => {
        clearTimeout(t);
        resolve(l);
      });
    });
  }
  send(s) {
    this.sock.write(s + '\r\n');
  }
  async cmd(s) {
    this.send(s);
    return this.line();
  }
  async readMultiline() {
    const out = [];
    for (;;) {
      const l = await this.line();
      if (l === '.') break;
      out.push(l.startsWith('..') ? l.slice(1) : l);
    }
    return out;
  }
  end() {
    this.sock.end();
  }
}

const wif = readWif();
const wallet = new BurnerWallet(wif);
console.log(`gateway ${HOST}:${PORT} · wallet ${wallet.address}`);

const c = new Nntp(HOST, PORT);
await c.connect();
console.log('greeting:', await c.line());
console.log('GROUP:', await c.cmd(`GROUP ${GROUP}`));

const article = [
  `Newsgroups: ${GROUP}`,
  `Subject: ${SUBJECT}`,
  'From: e2e@usenet-bsv',
  '',
  'Live end-to-end test: classic NNTP command flow, x402 payment ticket, ARC settlement.',
];

// First POST should hit the paywall.
console.log('POST #1:', await c.cmd('POST'));
c.sock.write(article.join('\r\n') + '\r\n.\r\n');
const challenge = await c.line();
console.log('challenge:', challenge);
if (!challenge.startsWith('480')) throw new Error(`expected 480, got: ${challenge}`);

// Fetch the full x402 challenge, pay it, present the ticket.
console.log('X-PAYREQ:', await c.cmd('X-PAYREQ'));
const challengeB64 = (await c.readMultiline())[0];
const requirements = JSON.parse(Buffer.from(challengeB64, 'base64').toString('utf8'));
console.log('price:', requirements.amount, 'sats →', requirements.payTo);

const txHex = await wallet.buildPayment(requirements.payTo, Number(requirements.amount), (s) => console.log('  stage:', s));
const payload = Buffer.from(
  JSON.stringify({ x402Version: 2, scheme: 'exact', network: 'bsv:mainnet', txHex, encoding: 'raw-hex' }),
).toString('base64');
console.log('AUTHINFO PAY:', await c.cmd(`AUTHINFO PAY ${payload}`));

// Retry POST with the ticket attached.
console.log('POST #2:', await c.cmd('POST'));
c.sock.write(article.join('\r\n') + '\r\n.\r\n');
const posted = await c.line();
console.log('posted:', posted);
if (!posted.startsWith('240')) throw new Error(`expected 240, got: ${posted}`);

// Read it back over NNTP.
const msgid = posted.split(/\s+/)[2];
console.log('ARTICLE:', await c.cmd(`ARTICLE ${msgid}`));
const body = await c.readMultiline();
const ok = body.some((l) => l.includes('x402 payment ticket'));
console.log('read back:', ok ? 'body ok' : `BODY MISMATCH (${body.length} lines: ${JSON.stringify(body.slice(0, 3))})`);
c.end();

const txid = /tx=([0-9a-f]{64})/.exec(posted)?.[1];
if (txid) {
  await new Promise((r) => setTimeout(r, 4000));
  const check = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}`).catch(() => null);
  console.log(`txid ${txid} · WOC ${check?.ok ? 'found (mempool or mined)' : 'pending'}`);
}
console.log('NNTP E2E: PASS');
