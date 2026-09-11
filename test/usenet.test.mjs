import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { P2PKH, Script, Transaction } from "@bsv/sdk";
import { b64decodeJson, b64encodeJson, buildRequirements } from "../src/bsv-x402.ts";
import { parseRange, parsePosting, formatXoverLine, createGateway } from "../gateway/nntp-gateway.mjs";
import app from "../src/worker.ts";

const PAY_TO = "1DHBH964yuvJnneuUe7EKFpVyJK1Vkz8Y4";
const GROUP_PAY_TO = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"; // valid genesis address for group revenue

// ---------- in-memory D1 mock ----------

function makeDb() {
  const groups = new Map(); // id -> row
  const groupsByName = new Map();
  const articles = new Map(); // id -> row
  const articlesByMsg = new Map();
  const payments = new Map();
  const reports = new Map(); // `${articleId}|${reporter}` -> row
  const anchors = new Map();
  const identities = new Map();

  function stmt(query) {
    const q = query.replace(/\s+/g, " ").trim();
    return {
      bind(...params) {
        return {
          async first() {
            if (q.startsWith("SELECT * FROM ug_groups WHERE name = ?")) {
              return groupsByName.get(params[0]) ?? null;
            }
            if (q.startsWith("SELECT * FROM ug_groups WHERE id = ?")) {
              return groups.get(params[0]) ?? null;
            }
            if (q.startsWith("SELECT * FROM ug_articles WHERE id = ?")) {
              return articles.get(params[0]) ?? null;
            }
            if (q.startsWith("SELECT * FROM ug_articles WHERE message_id = ?")) {
              return articlesByMsg.get(params[0]) ?? null;
            }
            if (q.startsWith("SELECT COUNT(*) as n FROM ug_reports WHERE article_id = ?")) {
              let n = 0;
              for (const k of reports.keys()) if (k.startsWith(`${params[0]}|`)) n++;
              return { n };
            }
            if (q.startsWith("SELECT * FROM ug_anchors WHERE id = ?")) {
              return anchors.get(params[0]) ?? null;
            }
            return null;
          },
          async all() {
            if (q.startsWith("SELECT * FROM ug_groups ORDER BY")) {
              const rows = [...groups.values()].sort((a, b) => b.article_count - a.article_count || b.created_at - a.created_at);
              return { results: rows.slice(0, params[0] ?? 100) };
            }
            if (q.startsWith("SELECT * FROM ug_articles WHERE group_id = ?")) {
              const [gid, since, limit] = params;
              const rows = [...articles.values()].filter((a) => a.group_id === gid && a.created_at > since).sort((a, b) => a.created_at - b.created_at);
              return { results: rows.slice(0, limit) };
            }
            if (q.startsWith("SELECT * FROM ug_articles WHERE created_at > ?")) {
              const [since, limit] = params;
              const rows = [...articles.values()].filter((a) => a.created_at > since).sort((a, b) => a.created_at - b.created_at);
              return { results: rows.slice(0, limit) };
            }
            if (q.startsWith("SELECT id, digest FROM ug_articles WHERE anchor_id IS NULL")) {
              const rows = [...articles.values()].filter((a) => !a.anchor_id).sort((a, b) => a.created_at - b.created_at).slice(0, params[0]);
              return { results: rows.map((a) => ({ id: a.id, digest: a.digest })) };
            }
            return { results: [] };
          },
          async run() {
            if (q.startsWith("INSERT INTO ug_groups")) {
              const [id, name, description, owner_addr, post_price_sats, read_price_default, pay_to, created_at] = params;
              const row = { id, name, description, owner_addr, post_price_sats, read_price_default, pay_to, created_at, article_count: 0 };
              groups.set(id, row);
              groupsByName.set(name, row);
              return {};
            }
            if (q.startsWith("UPDATE ug_groups SET article_count")) {
              const g = groups.get(params[0]);
              if (g) g.article_count++;
              return {};
            }
            if (q.startsWith("INSERT INTO ug_articles")) {
              // Post route binds 13 params (author_nick + read_price included);
              // relay push binds 11 (those two are SQL literals ''). Map by arity.
              let row;
              if (params.length === 13) {
                const [id, message_id, group_id, parent_id, author_addr, author_nick, subject, body, digest, pay_to, read_price_sats, created_tx, created_at] = params;
                row = { id, message_id, group_id, parent_id, author_addr, author_nick, subject, body, digest, pay_to, read_price_sats, created_tx, anchor_id: null, hidden: 0, created_at };
              } else {
                const [id, message_id, group_id, parent_id, author_addr, subject, body, digest, pay_to, created_tx, created_at] = params;
                row = { id, message_id, group_id, parent_id, author_addr, author_nick: "", subject, body, digest, pay_to, read_price_sats: 0, created_tx, anchor_id: null, hidden: 0, created_at };
              }
              articles.set(row.id, row);
              articlesByMsg.set(row.message_id, row);
              return {};
            }
            if (q.startsWith("UPDATE ug_articles SET hidden = 1")) {
              const a = articles.get(params[0]);
              if (a) a.hidden = 1;
              return {};
            }
            if (q.startsWith("UPDATE ug_articles SET anchor_id = ?")) {
              const a = articles.get(params[1]);
              if (a) a.anchor_id = params[0];
              return {};
            }
            if (q.startsWith("INSERT INTO ug_payments") || q.startsWith("INSERT OR IGNORE INTO ug_payments")) {
              const [txid, type, sats, payer, resource_id, created_at] = params;
              if (q.startsWith("INSERT OR IGNORE") && payments.has(txid)) return {};
              payments.set(txid, { txid, type, sats, payer, resource_id, created_at });
              return {};
            }
            if (q.startsWith("INSERT OR IGNORE INTO ug_reports") || q.startsWith("INSERT INTO ug_reports")) {
              const [id, article_id, reporter, reason, created_at] = params;
              const k = `${article_id}|${reporter}`;
              if (!reports.has(k)) reports.set(k, { id, article_id, reporter, reason, created_at });
              return {};
            }
            if (q.startsWith("INSERT INTO ug_anchors")) {
              const [id, root, count, txid_ref, created_at] = params;
              anchors.set(id, { id, root, count, txid_ref, created_at });
              return {};
            }
            if (q.startsWith("INSERT INTO ug_identities")) {
              const [addr, nick, updated_at] = params;
              identities.set(addr, { addr, nick, updated_at });
              return {};
            }
            return {};
          },
        };
      },
    };
  }
  return { prepare: stmt, _maps: { groups, articles, payments, reports, anchors } };
}

// ---------- payment + ARC stubs ----------

let arcCounter = 0xe0;
function fakeTxid() {
  arcCounter += 1;
  return arcCounter.toString(16).padStart(64, "a").slice(0, 64);
}

function installArcStub() {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("gorillapool") || (u.endsWith("/tx") && init?.method === "POST")) {
      const txid = fakeTxid();
      return { ok: true, status: 200, text: async () => JSON.stringify({ txid }), json: async () => ({ txid }) };
    }
    return real(url, init);
  };
  return () => {
    globalThis.fetch = real;
  };
}

function buildTxHex(payTo, sats, tag) {
  const tx = new Transaction();
  if (tag) {
    // sourceTXID must be 64-hex; payer is derived from its first 16 chars, so
    // the tag goes FIRST to keep distinct tags -> distinct payers.
    const src = Buffer.from(`${tag}:usenet-test-payer`).toString("hex").padEnd(64, "0").slice(0, 64);
    tx.addInput({ sourceTXID: src, sourceOutputIndex: 0, sequence: 0xffffffff, unlockingScript: new Script() });
  }
  tx.addOutput({ lockingScript: new P2PKH().lock(payTo), satoshis: sats });
  tx.addOutput({ lockingScript: new P2PKH().lock(payTo), satoshis: 100 });
  return tx.toHex();
}

function sigFor(payTo, sats, tag) {
  return b64encodeJson({ x402Version: 2, scheme: "exact", network: "bsv:mainnet", txHex: buildTxHex(payTo, sats, tag), encoding: "raw-hex" });
}

function testEnv(db) {
  return {
    PAY_TO,
    ARC_URL: "https://arc.gorillapool.io/v1",
    USENET_DB: db,
    PRICE_GROUP_CREATE_SATS: "500",
    PRICE_RELAY_SATS: "10",
    PRICE_REPORT_SATS: "5",
    PRICE_NICK_SATS: "10",
    RATE_LIMIT_PER_MIN: "0",
  };
}

async function createGroup(env, name = "bsv.devs", tag = "group1") {
  const res = await app.request("https://x/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": sigFor(PAY_TO, 500, tag) },
    body: JSON.stringify({ name, description: "test", postPriceSats: 20, readPriceDefault: 0, payTo: GROUP_PAY_TO }),
  }, env);
  assert.equal(res.status, 201);
  return res.json();
}

// ---------- tests ----------

describe("codec", () => {
  it("round-trips requirements", () => {
    const req = buildRequirements({ url: "https://x/api/groups", description: "t", mimeType: "application/json", satoshis: 500, payTo: PAY_TO, arcUrl: "https://arc.gorillapool.io/v1", dustFloor: 1 });
    assert.equal(b64decodeJson(b64encodeJson(req)).amount, "500");
  });
});

describe("groups", () => {
  let restore;
  beforeEach(() => {
    restore = installArcStub();
  });
  afterEach(() => restore());

  it("rejects bad names without charging", async () => {
    const env = testEnv(makeDb());
    const res = await app.request("https://x/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "BAD NAME!", description: "", payTo: GROUP_PAY_TO }) }, env);
    assert.equal(res.status, 400);
  });

  it("402s group creation at 500 sats, then creates with payment", async () => {
    const env = testEnv(makeDb());
    const noPay = await app.request("https://x/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "bsv.devs", description: "d", payTo: GROUP_PAY_TO }) }, env);
    assert.equal(noPay.status, 402);
    assert.ok(noPay.headers.get("PAYMENT-REQUIRED"));
    assert.equal((await noPay.json()).priceSats, 500);
    const g = await createGroup(env);
    assert.equal(g.name, "bsv.devs");
    assert.ok(g.settlement.transaction);
  });

  it("409s duplicate group names", async () => {
    const env = testEnv(makeDb());
    await createGroup(env, "bsv.devs", "t1");
    const dup = await app.request("https://x/api/groups", { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": sigFor(PAY_TO, 500, "t2") }, body: JSON.stringify({ name: "bsv.devs", description: "d", payTo: GROUP_PAY_TO }) }, env);
    assert.equal(dup.status, 409);
  });
});

describe("post + read", () => {
  let restore;
  beforeEach(() => {
    restore = installArcStub();
  });
  afterEach(() => restore());

  it("pay-to-post 402 then 201; free feed preview; free read when price 0", async () => {
    const dbm = makeDb();
    const env = testEnv(dbm);
    await createGroup(env);
    const noPay = await app.request("https://x/bsv.devs/post".replace("https://x/", "https://x/api/groups/"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: "hi", body: "hello world" }) }, env);
    assert.equal(noPay.status, 402);
    assert.equal((await noPay.json()).priceSats, 20);

    const posted = await app.request("https://x/api/groups/bsv.devs/post", { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": sigFor(GROUP_PAY_TO, 20, "post1") }, body: JSON.stringify({ subject: "hi", body: "hello world" }) }, env);
    assert.equal(posted.status, 201);
    const p = await posted.json();
    assert.ok(p.digest);
    assert.ok(p.messageId.startsWith("<"));

    const feed = await (await app.request("https://x/api/groups/bsv.devs/feed?limit=10", {}, env)).json();
    assert.equal(feed.articles.length, 1);
    assert.equal(feed.articles[0].preview, "hello world");

    const read = await app.request(`https://x/api/article/${p.id}`, {}, env);
    assert.equal(read.status, 200);
    assert.equal((await read.json()).body, "hello world");
  });

  it("pay-to-read: 402 with group payTo, then 200 after payment", async () => {
    const dbm = makeDb();
    const env = testEnv(dbm);
    await createGroup(env);
    const posted = await app.request("https://x/api/groups/bsv.devs/post", { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": sigFor(GROUP_PAY_TO, 20, "pp1") }, body: JSON.stringify({ subject: "paid", body: "secret sauce", readPriceSats: 25 }) }, env);
    const p = await posted.json();
    const noPay = await app.request(`https://x/api/article/${p.id}`, {}, env);
    assert.equal(noPay.status, 402);
    assert.equal((await noPay.json()).priceSats, 25);
    const preview = await app.request(`https://x/api/article/${p.id}?preview=1`, {}, env);
    assert.equal(preview.status, 200);
    const paid = await app.request(`https://x/api/article/${p.id}`, { headers: { "PAYMENT-SIGNATURE": sigFor(GROUP_PAY_TO, 25, "read1") } }, env);
    assert.equal(paid.status, 200);
    assert.equal((await paid.json()).body, "secret sauce");
    assert.ok(paid.headers.get("PAYMENT-RESPONSE"));
  });
});

describe("reports + relay + anchor", () => {
  let restore;
  beforeEach(() => {
    restore = installArcStub();
  });
  afterEach(() => restore());

  it("hides article after 3 distinct paid reports", async () => {
    const env = testEnv(makeDb());
    await createGroup(env);
    const posted = await app.request("https://x/api/groups/bsv.devs/post", { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": sigFor(GROUP_PAY_TO, 20, "spam-post") }, body: JSON.stringify({ subject: "spam", body: "buy now" }) }, env);
    const p = await posted.json();
    for (const [i, tag] of ["r1", "r2", "r3"].entries()) {
      const r = await app.request(`https://x/api/article/${p.id}/report`, { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": sigFor(PAY_TO, 5, tag) }, body: JSON.stringify({ reason: "spam" }) }, env);
      assert.equal(r.status, 201);
      const j = await r.json();
      assert.equal(j.reports, i + 1);
      if (i === 2) assert.equal(j.hidden, true);
    }
    const read = await (await app.request(`https://x/api/article/${p.id}`, {}, env)).json();
    assert.equal(read.body, "[hidden by reports]");
  });

  it("relay pull/push are paid and round-trip", async () => {
    const env = testEnv(makeDb());
    await createGroup(env);
    const pushNoPay = await app.request("https://x/api/relay/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ articles: [] }) }, env);
    assert.equal(pushNoPay.status, 402);
    const push = await app.request("https://x/api/relay/push", { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": sigFor(PAY_TO, 10, "push1") }, body: JSON.stringify({ articles: [{ group: "bsv.devs", subject: "federated", body: "from peer", messageId: "<peer1@x>", authorAddr: "peer" }] }) }, env);
    assert.equal((await push.json()).imported, 1);
    const pull = await app.request("https://x/api/relay/pull", { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": sigFor(PAY_TO, 10, "pull1") }, body: JSON.stringify({ since: 0, limit: 10 }) }, env);
    assert.equal(pull.status, 200);
    assert.equal((await pull.json()).articles.length, 1);
  });

  it("anchor batches digests and proof verifies", async () => {
    const env = testEnv(makeDb());
    await createGroup(env);
    const posted = await app.request("https://x/api/groups/bsv.devs/post", { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": sigFor(GROUP_PAY_TO, 20, "a1") }, body: JSON.stringify({ subject: "s", body: "b" }) }, env);
    const p = await posted.json();
    const unanchored = await (await app.request(`https://x/api/article/${p.id}/proof`, {}, env)).json();
    assert.equal(unanchored.anchored, false);
    const run = await app.request("https://x/api/anchor/run", { method: "POST" }, env);
    assert.equal(run.status, 201);
    const proof = await (await app.request(`https://x/api/article/${p.id}/proof`, {}, env)).json();
    assert.equal(proof.anchored, true);
    assert.ok(proof.root);
  });
});

describe("gateway helpers", () => {
  it("parseRange clamps 1-based ranges", () => {
    assert.deepEqual(parseRange("1-", 3), [1, 2, 3]);
    assert.deepEqual(parseRange("2-3", 5), [2, 3]);
    assert.deepEqual(parseRange("4", 5), [4]);
    assert.deepEqual(parseRange("9-20", 5), []);
    assert.deepEqual(parseRange("", 5), []);
  });

  it("parsePosting splits headers/body and parent ref", () => {
    const p = parsePosting("Newsgroups: bsv.devs\nSubject: hi\nReferences: <ua_abc@usenet-bsv>\n\nhello");
    assert.equal(p.group, "bsv.devs");
    assert.equal(p.subject, "hi");
    assert.equal(p.body, "hello");
    assert.equal(p.parentId, "ua_abc");
  });

  it("formatXoverLine emits 8 fields", () => {
    const line = formatXoverLine(1, { subject: "s", from: "f", messageId: "<a@x>", preview: "b", createdAt: Date.now() });
    assert.equal(line.split("\t").length, 8);
  });
});

describe("gateway integration (NNTP framing + AUTHINFO PAY)", () => {
  let restore;
  beforeEach(() => {
    restore = installArcStub();
  });
  afterEach(() => restore());

  it("LIST/GROUP/XOVER/POST-480/AUTHINFO/POST-240/ARTICLE", async () => {
    const dbm = makeDb();
    const env = testEnv(dbm);
    await createGroup(env, "bsv.devs", "gw-group");

    // fetch adapter: route usenet base URLs into the Hono app, ARC to stub.
    const base = "http://gw.test";
    const fetchFn = async (url, init = {}) => {
      const u = String(url);
      if (u.includes("arc.gorillapool")) {
        const txid = fakeTxid();
        return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ txid }), json: async () => ({ txid }) };
      }
      const path = u.startsWith(base) ? u.slice(base.length) : new URL(u).pathname + new URL(u).search;
      return app.request(path, { method: init.method ?? "GET", headers: init.headers, body: init.body }, env);
    };

    const gw = createGateway({ baseUrl: base, fetchFn, port: 0, host: "127.0.0.1" });
    await gw.listen();
    const port = gw.server.address().port;
    const sock = net.createConnection({ port, host: "127.0.0.1" });
    sock.setEncoding("utf8");
    let buf = "";
    const lines = [];
    sock.on("data", (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        lines.push(buf.slice(0, i));
        buf = buf.slice(i + 2);
      }
    });
    const waitFor = async (n, timeout = 3000) => {
      const t0 = Date.now();
      while (lines.length < n) {
        if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${n} lines, have ${lines.length}: ${lines.join("|")}`);
        await new Promise((r) => setTimeout(r, 10));
      }
      return lines.splice(0, n);
    };
    const cmd = async (s, expectLines = 1) => {
      const before = lines.length;
      sock.write(s + "\r\n");
      return waitFor(before + expectLines).then((all) => all.slice(before));
    };
    const nextLine = async (timeout = 3000) => {
      const t0 = Date.now();
      while (lines.length < 1) {
        if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for line: ${lines.join("|")}`);
        await new Promise((r) => setTimeout(r, 10));
      }
      return lines.shift();
    };
    const readMultiline = async () => {
      const out = [];
      for (;;) {
        const l = await nextLine();
        if (l === ".") break;
        out.push(l.startsWith("..") ? l.slice(1) : l);
      }
      return out;
    };

    try {
      assert.ok((await waitFor(1))[0].startsWith("200"));
      assert.ok((await cmd("CAPABILITIES", 10))[0].startsWith("101"));
      const listHead = await cmd("LIST", 1);
      assert.ok(listHead[0].startsWith("215"));
      const listBody = await readMultiline();
      assert.ok(listBody.some((l) => l.startsWith("bsv.devs ")));
      const grp = await cmd("GROUP bsv.devs", 1);
      assert.ok(grp[0].startsWith("211 0"));
      // POST without ticket -> 480 challenge
      assert.ok((await cmd("POST", 1))[0].startsWith("340"));
      sock.write("Newsgroups: bsv.devs\r\nSubject: gw hello\r\n\r\nvia nntp\r\n.\r\n");
      const challenge = await nextLine();
      assert.ok(challenge.startsWith("480"));
      // pay out-of-band for the 20-sat post price, present ticket, re-POST
      const ticket = sigFor(GROUP_PAY_TO, 20, "gw-post");
      assert.ok((await cmd(`AUTHINFO PAY ${ticket}`, 1))[0].startsWith("281"));
      assert.ok((await cmd("POST", 1))[0].startsWith("340"));
      sock.write("Newsgroups: bsv.devs\r\nSubject: gw hello\r\n\r\nvia nntp\r\n.\r\n");
      const posted = await nextLine();
      assert.ok(posted.startsWith("240"));
      const xoverHead = await cmd("XOVER 1-", 1);
      assert.ok(xoverHead[0].startsWith("224"));
      const xoverBody = await readMultiline();
      assert.equal(xoverBody.length, 1);
      assert.ok(xoverBody[0].includes("gw hello"));
      const artHead = await cmd("ARTICLE 1", 1);
      assert.ok(artHead[0].startsWith("220"));
      const artBody = await readMultiline();
      assert.ok(artBody.join("\n").includes("via nntp"));
    } finally {
      sock.destroy();
      await gw.close();
    }
  });
});
