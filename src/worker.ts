import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { BSV_NETWORK } from "./bsv-x402.ts";
import { mountFacilitator } from "./facilitator.ts";
import { checkRate, leaderboard, meter, rateHeaders, routeKey } from "./meter.ts";
import { num, str, type Env } from "./env.ts";
import { isValidAddress, settlementHeader, verifyAndSettle } from "./payments.ts";
import {
  GroupInput,
  PostInput,
  RelayArticleInput,
  articleDigest,
  countReports,
  db,
  feedForGroup,
  getArticle,
  getArticleByMessageId,
  getGroupById,
  getGroupByName,
  listGroups,
  merkleRoot,
  messageIdFor,
  newId,
  previewOf,
  shortAddr,
  unanchoredDigests,
  type ArticleRow,
} from "./usenet.ts";

const api = new Hono<{ Bindings: Env }>();

const asJson = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

// Rate-limit free GETs; paid POSTs pass through (402 is the throttle).
api.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET") {
    await next();
    return;
  }
  const limit = num(c.env, "RATE_LIMIT_PER_MIN", 60);
  const fwd = c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();
  // The NNTP gateway forwards each reader's IP in X-NNT-Client-IP so one
  // gateway doesn't lump every reader into a single rate-limit bucket.
  // Best-effort only: this header guards free reads, not paid actions.
  const ip = c.req.header("X-NNT-Client-IP") ?? c.req.header("CF-Connecting-IP") ?? fwd ?? "anon";
  const pathname = new URL(c.req.url).pathname;
  const info = await checkRate(c.env, ip, routeKey(pathname), limit);
  if (!info.allowed) {
    return asJson({ error: "rate_limited", retryAfterSec: 60 }, 429, {
      ...rateHeaders(info, limit),
      "Retry-After": "60",
    });
  }
  await next();
  for (const [k, v] of Object.entries(rateHeaders(info, limit))) c.header(k, v);
});

api.get("/health", (c) =>
  asJson({ ok: true, service: "usenet-bsv", network: "bsv:mainnet", storage: "off-chain+d1+hash-anchor", nntp: "gateway/AUTHINFO-PAY" }),
);

api.get("/pricing", (c) =>
  asJson({
    network: BSV_NETWORK,
    payTo: str(c.env, "PAY_TO", ""),
    prices: {
      groupCreate: num(c.env, "PRICE_GROUP_CREATE_SATS", 500),
      postDefault: num(c.env, "PRICE_POST_DEFAULT_SATS", 20),
      readDefault: num(c.env, "PRICE_READ_DEFAULT_SATS", 0),
      relay: num(c.env, "PRICE_RELAY_SATS", 10),
      report: num(c.env, "PRICE_REPORT_SATS", 5),
      nick: num(c.env, "PRICE_NICK_SATS", 10),
    },
    note: "post/read prices are per-group overrides; group creation + reports + nick always pay protocol PAY_TO",
  }),
);

api.get("/supported", (c) => {
  const base = new URL(c.req.url).pathname.startsWith("/usenet") ? "/usenet" : "";
  return c.redirect(`${base}/facilitator/supported`, 307);
});

mountFacilitator(api);
const facil = new Hono<{ Bindings: Env }>();
mountFacilitator(facil);
api.route("/facilitator", facil);

// ---------- Groups ----------

api.get("/api/groups", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const groups = await listGroups(d, 100);
  void meter(c.env, "groups-list", 0);
  return asJson({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      postPriceSats: g.post_price_sats,
      readPriceDefault: g.read_price_default,
      payTo: g.pay_to,
      articleCount: g.article_count,
      createdAt: g.created_at,
    })),
  });
});

api.get("/api/groups/:ref", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const ref = c.req.param("ref");
  const g = ref.startsWith("ug_") ? await getGroupById(d, ref) : await getGroupByName(d, ref);
  if (!g) return asJson({ error: "group_not_found" }, 404);
  void meter(c.env, "groups-get", 0);
  return asJson({
    id: g.id,
    name: g.name,
    description: g.description,
    postPriceSats: g.post_price_sats,
    readPriceDefault: g.read_price_default,
    payTo: g.pay_to,
    owner: g.owner_addr,
    articleCount: g.article_count,
    createdAt: g.created_at,
  });
});

/** Group creation: fixed protocol fee (anti-squat). Owner payTo = where future post fees go. */
api.post("/api/groups", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const raw = await c.req.json().catch(() => ({}));
  const parsed = GroupInput.safeParse(raw);
  if (!parsed.success) return asJson({ error: "bad_input", detail: parsed.error.flatten() }, 400);
  if (await getGroupByName(d, parsed.data.name)) return asJson({ error: "group_exists" }, 409);

  const price = num(c.env, "PRICE_GROUP_CREATE_SATS", 500);
  const protoPayTo = str(c.env, "PAY_TO", "");
  const s = await verifyAndSettle(c.env, new URL(c.req.url).toString(), `usenet: create group ${parsed.data.name}`, price, protoPayTo, c.req.header("PAYMENT-SIGNATURE") ?? null);
  if (!s.ok) return s.response;

  const now = Date.now();
  const id = newId("ug");
  await d
    .prepare("INSERT INTO ug_groups (id, name, description, owner_addr, post_price_sats, read_price_default, pay_to, created_at, article_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)")
    .bind(id, parsed.data.name, parsed.data.description, s.settled.payer, parsed.data.postPriceSats, parsed.data.readPriceDefault, parsed.data.payTo, now)
    .run();
  await d.prepare("INSERT INTO ug_payments (txid, type, sats, payer, resource_id, created_at) VALUES (?, 'group-create', ?, ?, ?, ?)").bind(s.settled.settledTxid, price, s.settled.payer, id, now).run();
  const settlement = { success: true, payer: s.settled.payer, transaction: s.settled.settledTxid, network: BSV_NETWORK };
  return asJson(
    { id, name: parsed.data.name, postPriceSats: parsed.data.postPriceSats, readPriceDefault: parsed.data.readPriceDefault, payTo: parsed.data.payTo, priceSats: price, settlement },
    201,
    { "PAYMENT-RESPONSE": settlementHeader(s.settled) },
  );
});

// ---------- Posting (pay-to-post) ----------

api.post("/api/groups/:ref/post", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const ref = c.req.param("ref");
  const g = ref.startsWith("ug_") ? await getGroupById(d, ref) : await getGroupByName(d, ref);
  if (!g) return asJson({ error: "group_not_found" }, 404);
  const raw = await c.req.json().catch(() => ({}));
  const parsed = PostInput.safeParse(raw);
  if (!parsed.success) return asJson({ error: "bad_input", detail: parsed.error.flatten() }, 400);

  if (parsed.data.parentId) {
    const parent = await getArticle(d, parsed.data.parentId);
    if (!parent || parent.group_id !== g.id) return asJson({ error: "parent_not_found" }, 400);
  }

  const price = g.post_price_sats;
  const s = await verifyAndSettle(
    c.env,
    new URL(c.req.url).toString(),
    `usenet: post to ${g.name}`,
    price,
    g.pay_to,
    c.req.header("PAYMENT-SIGNATURE") ?? null,
  );
  if (!s.ok) return s.response;

  const now = Date.now();
  const id = newId("ua");
  const messageId = messageIdFor(id);
  const nick = parsed.data.nick?.slice(0, 32) ?? "";
  const digest = await articleDigest(g.name, s.settled.payer, parsed.data.subject, parsed.data.body);
  const readPrice = parsed.data.readPriceSats ?? g.read_price_default;
  await d
    .prepare("INSERT INTO ug_articles (id, message_id, group_id, parent_id, author_addr, author_nick, subject, body, digest, pay_to, read_price_sats, created_tx, anchor_id, hidden, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)")
    .bind(id, messageId, g.id, parsed.data.parentId ?? null, s.settled.payer, nick, parsed.data.subject, parsed.data.body, digest, g.pay_to, readPrice, s.settled.settledTxid, now)
    .run();
  await d.prepare("UPDATE ug_groups SET article_count = article_count + 1 WHERE id = ?").bind(g.id).run();
  await d.prepare("INSERT INTO ug_payments (txid, type, sats, payer, resource_id, created_at) VALUES (?, 'post', ?, ?, ?, ?)").bind(s.settled.settledTxid, price, s.settled.payer, id, now).run();
  const settlement = { success: true, payer: s.settled.payer, transaction: s.settled.settledTxid, network: BSV_NETWORK };
  return asJson(
    { id, messageId, group: g.name, digest, readPriceSats: readPrice, priceSats: price, createdTx: s.settled.settledTxid, settlement },
    201,
    { "PAYMENT-RESPONSE": settlementHeader(s.settled) },
  );
});

// ---------- Reading (free feed / paid bodies) ----------

api.get("/api/groups/:ref/feed", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const ref = c.req.param("ref");
  const g = ref.startsWith("ug_") ? await getGroupById(d, ref) : await getGroupByName(d, ref);
  if (!g) return asJson({ error: "group_not_found" }, 404);
  const url = new URL(c.req.url);
  const since = Number.parseInt(url.searchParams.get("since") ?? "0", 10) || 0;
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const rows = await feedForGroup(d, g.id, since, limit);
  void meter(c.env, "feed", 0);
  return asJson({
    group: g.name,
    groupId: g.id,
    articles: rows.map((a, i) => ({
      n: i + 1,
      id: a.id,
      messageId: a.message_id,
      parentId: a.parent_id,
      subject: a.subject,
      from: a.author_nick || shortAddr(a.author_addr),
      author: a.author_addr,
      preview: previewOf(a.body),
      readPriceSats: a.read_price_sats,
      hidden: a.hidden === 1,
      digest: a.digest,
      createdTx: a.created_tx,
      createdAt: a.created_at,
    })),
  });
});

api.get("/api/article/:id", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const id = c.req.param("id");
  const a: ArticleRow | null = id.startsWith("<") ? await getArticleByMessageId(d, id) : await getArticle(d, id);
  if (!a) return asJson({ error: "article_not_found" }, 404);
  const url = new URL(c.req.url);
  if (url.searchParams.get("preview") === "1") {
    return asJson({ id: a.id, messageId: a.message_id, subject: a.subject, preview: previewOf(a.body), readPriceSats: a.read_price_sats, digest: a.digest, createdAt: a.created_at });
  }
  if ((a.read_price_sats ?? 0) <= 0) {
    void meter(c.env, "article-read-free", 0);
    return asJson({ id: a.id, messageId: a.message_id, groupId: a.group_id, parentId: a.parent_id, subject: a.subject, body: a.hidden === 1 ? "[hidden by reports]" : a.body, from: a.author_nick || shortAddr(a.author_addr), author: a.author_addr, digest: a.digest, priceSats: 0, createdTx: a.created_tx, anchorId: a.anchor_id, createdAt: a.created_at });
  }
  const s = await verifyAndSettle(c.env, new URL(c.req.url).toString(), `usenet: read ${a.message_id}`, a.read_price_sats, a.pay_to, c.req.header("PAYMENT-SIGNATURE") ?? null);
  if (!s.ok) return s.response;
  const now = Date.now();
  await d.prepare("INSERT OR IGNORE INTO ug_payments (txid, type, sats, payer, resource_id, created_at) VALUES (?, 'read', ?, ?, ?, ?)").bind(s.settled.settledTxid, a.read_price_sats, s.settled.payer, a.id, now).run();
  const settlement = { success: true, payer: s.settled.payer, transaction: s.settled.settledTxid, network: BSV_NETWORK };
  return asJson(
    { id: a.id, messageId: a.message_id, groupId: a.group_id, parentId: a.parent_id, subject: a.subject, body: a.hidden === 1 ? "[hidden by reports]" : a.body, from: a.author_nick || shortAddr(a.author_addr), author: a.author_addr, digest: a.digest, priceSats: a.read_price_sats, createdTx: a.created_tx, anchorId: a.anchor_id, createdAt: a.created_at, settlement },
    200,
    { "PAYMENT-RESPONSE": settlementHeader(s.settled) },
  );
});

api.get("/api/article/by-msgid/:msgid", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const a = await getArticleByMessageId(d, decodeURIComponent(c.req.param("msgid")));
  if (!a) return asJson({ error: "article_not_found" }, 404);
  return asJson({ id: a.id, messageId: a.message_id, subject: a.subject, preview: previewOf(a.body), readPriceSats: a.read_price_sats, createdAt: a.created_at });
});

// ---------- Reports (paid anti-abuse) ----------

const ReportInput = z.object({ reason: z.string().max(280).default("") });

api.post("/api/article/:id/report", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const a = await getArticle(d, c.req.param("id"));
  if (!a) return asJson({ error: "article_not_found" }, 404);
  const raw = await c.req.json().catch(() => ({}));
  const parsed = ReportInput.safeParse(raw);
  if (!parsed.success) return asJson({ error: "bad_input", detail: parsed.error.flatten() }, 400);
  const price = num(c.env, "PRICE_REPORT_SATS", 5);
  const s = await verifyAndSettle(c.env, new URL(c.req.url).toString(), `usenet: report ${a.message_id}`, price, str(c.env, "PAY_TO", ""), c.req.header("PAYMENT-SIGNATURE") ?? null);
  if (!s.ok) return s.response;
  const now = Date.now();
  await d.prepare("INSERT OR IGNORE INTO ug_reports (id, article_id, reporter, reason, created_at) VALUES (?, ?, ?, ?, ?)").bind(newId("ur"), a.id, s.settled.payer, parsed.data.reason, now).run();
  await d.prepare("INSERT OR IGNORE INTO ug_payments (txid, type, sats, payer, resource_id, created_at) VALUES (?, 'report', ?, ?, ?, ?)").bind(s.settled.settledTxid, price, s.settled.payer, a.id, now).run();
  const n = await countReports(d, a.id);
  if (n >= 3 && a.hidden !== 1) await d.prepare("UPDATE ug_articles SET hidden = 1 WHERE id = ?").bind(a.id).run();
  const settlement = { success: true, payer: s.settled.payer, transaction: s.settled.settledTxid, network: BSV_NETWORK };
  return asJson({ reports: n, hidden: n >= 3, priceSats: price, settlement }, 201, { "PAYMENT-RESPONSE": settlementHeader(s.settled) });
});

// ---------- Relay / federation (pay-to-relay) ----------

api.post("/api/relay/pull", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const raw = await c.req.json().catch(() => ({}));
  const since = typeof raw.since === "number" ? raw.since : 0;
  const limit = Math.min(100, Math.max(1, typeof raw.limit === "number" ? raw.limit : 50));
  const group = typeof raw.group === "string" ? raw.group : undefined;
  const price = num(c.env, "PRICE_RELAY_SATS", 10);
  const s = await verifyAndSettle(c.env, new URL(c.req.url).toString(), "usenet: relay pull batch", price, str(c.env, "PAY_TO", ""), c.req.header("PAYMENT-SIGNATURE") ?? null);
  if (!s.ok) return s.response;
  let rows: ArticleRow[];
  if (group) {
    const g = await getGroupByName(d, group);
    rows = g ? await feedForGroup(d, g.id, since, limit) : [];
  } else {
    const r = await d.prepare("SELECT * FROM ug_articles WHERE created_at > ? ORDER BY created_at ASC LIMIT ?").bind(since, limit).all<ArticleRow>();
    rows = r.results;
  }
  const settlement = { success: true, payer: s.settled.payer, transaction: s.settled.settledTxid, network: BSV_NETWORK };
  return asJson(
    { articles: rows.map((a) => ({ id: a.id, messageId: a.message_id, groupId: a.group_id, parentId: a.parent_id, subject: a.subject, body: a.body, author: a.author_addr, digest: a.digest, createdTx: a.created_tx, createdAt: a.created_at })), priceSats: price, settlement },
    200,
    { "PAYMENT-RESPONSE": settlementHeader(s.settled) },
  );
});

api.post("/api/relay/push", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const raw = await c.req.json().catch(() => ({}));
  const list = Array.isArray(raw.articles) ? raw.articles : null;
  if (!list) return asJson({ error: "bad_input", detail: "articles[] required" }, 400);
  if (list.length > 50) return asJson({ error: "batch_too_large", max: 50 }, 413);
  const price = num(c.env, "PRICE_RELAY_SATS", 10);
  const s = await verifyAndSettle(c.env, new URL(c.req.url).toString(), "usenet: relay push batch", price, str(c.env, "PAY_TO", ""), c.req.header("PAYMENT-SIGNATURE") ?? null);
  if (!s.ok) return s.response;
  let imported = 0;
  let skipped = 0;
  for (const item of list.slice(0, 50)) {
    const parsed = RelayArticleInput.safeParse(item);
    if (!parsed.success) {
      skipped++;
      continue;
    }
    if (await getArticleByMessageId(d, parsed.data.messageId)) {
      skipped++;
      continue;
    }
    let g = await getGroupByName(d, parsed.data.group);
    if (!g) {
      const now = Date.now();
      const gid = newId("ug");
      await d.prepare("INSERT INTO ug_groups (id, name, description, owner_addr, post_price_sats, read_price_default, pay_to, created_at, article_count) VALUES (?, ?, 'auto-created by relay', ?, 20, 0, ?, ?, 0)")
        .bind(gid, parsed.data.group, s.settled.payer, str(c.env, "PAY_TO", ""), now).run();
      g = (await getGroupById(d, gid))!;
    }
    const now = Date.now();
    const id = newId("ua");
    const digest = await articleDigest(parsed.data.group, parsed.data.authorAddr || s.settled.payer, parsed.data.subject, parsed.data.body);
    await d.prepare("INSERT INTO ug_articles (id, message_id, group_id, parent_id, author_addr, author_nick, subject, body, digest, pay_to, read_price_sats, created_tx, anchor_id, hidden, created_at) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, 0, ?, NULL, 0, ?)")
      .bind(id, parsed.data.messageId, g.id, parsed.data.parentId ?? null, parsed.data.authorAddr || s.settled.payer, parsed.data.subject, parsed.data.body, digest, g.pay_to, s.settled.settledTxid, now).run();
    await d.prepare("UPDATE ug_groups SET article_count = article_count + 1 WHERE id = ?").bind(g.id).run();
    imported++;
  }
  const settlement = { success: true, payer: s.settled.payer, transaction: s.settled.settledTxid, network: BSV_NETWORK };
  return asJson({ imported, skipped, priceSats: price, settlement }, 200, { "PAYMENT-RESPONSE": settlementHeader(s.settled) });
});

// ---------- Identities (pseudonymous nick, paid) ----------

const NickInput = z.object({ nick: z.string().min(1).max(32) });

api.post("/api/identities/nick", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const parsed = NickInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return asJson({ error: "bad_input", detail: parsed.error.flatten() }, 400);
  const price = num(c.env, "PRICE_NICK_SATS", 10);
  const s = await verifyAndSettle(c.env, new URL(c.req.url).toString(), `usenet: claim nick ${parsed.data.nick}`, price, str(c.env, "PAY_TO", ""), c.req.header("PAYMENT-SIGNATURE") ?? null);
  if (!s.ok) return s.response;
  await d.prepare("INSERT INTO ug_identities (addr, nick, updated_at) VALUES (?, ?, ?) ON CONFLICT(addr) DO UPDATE SET nick = excluded.nick, updated_at = excluded.updated_at").bind(s.settled.payer, parsed.data.nick, Date.now()).run();
  const settlement = { success: true, payer: s.settled.payer, transaction: s.settled.settledTxid, network: BSV_NETWORK };
  return asJson({ nick: parsed.data.nick, payer: s.settled.payer, priceSats: price, settlement }, 200, { "PAYMENT-RESPONSE": settlementHeader(s.settled) });
});

// ---------- Anchoring (off-chain bodies, on-chain-batch roots) ----------

api.post("/api/anchor/run", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const pending = await unanchoredDigests(d, 200);
  if (pending.length === 0) return asJson({ anchored: 0, root: null });
  const root = await merkleRoot(pending.map((p) => p.digest));
  const now = Date.now();
  const id = newId("uc");
  // v1 binds the batch to wall-clock + digest set; the payment txids inside the
  // batch are already on-chain (each post paid). A dedicated OP_RETURN anchor
  // tx is the P2 step — proof shape is forward-compatible.
  await d.prepare("INSERT INTO ug_anchors (id, root, count, txid_ref, created_at) VALUES (?, ?, ?, '', ?)").bind(id, root, pending.length, now).run();
  for (const p of pending) await d.prepare("UPDATE ug_articles SET anchor_id = ? WHERE id = ?").bind(id, p.id).run();
  void meter(c.env, "anchor", 0);
  return asJson({ anchored: pending.length, root, anchorId: id, note: "batch root over article digests; payment txids are the on-chain anchors in v1" }, 201);
});

api.get("/api/article/:id/proof", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const a = await getArticle(d, c.req.param("id"));
  if (!a) return asJson({ error: "article_not_found" }, 404);
  if (!a.anchor_id) return asJson({ digest: a.digest, anchored: false });
  const anchor = await d.prepare("SELECT * FROM ug_anchors WHERE id = ?").bind(a.anchor_id).first<{ id: string; root: string; count: number; created_at: number }>();
  return asJson({ digest: a.digest, anchored: true, anchorId: a.anchor_id, root: anchor?.root ?? null, count: anchor?.count ?? null, anchoredAt: anchor?.created_at ?? null, createdTx: a.created_tx });
});

// ---------- Free builder + ops ----------

api.post("/api/payreq", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const { b64encodeJson: b64, buildRequirements: br } = await import("./bsv-x402.ts");
  const payTo = typeof raw.payTo === "string" ? raw.payTo : "";
  const sats = typeof raw.sats === "number" ? raw.sats : 0;
  const resourceUrl = typeof raw.resourceUrl === "string" ? raw.resourceUrl : "";
  if (!isValidAddress(payTo) || !(sats >= 1 && sats <= 100_000_000)) return asJson({ error: "bad_input" }, 400);
  try {
    new URL(resourceUrl);
  } catch {
    return asJson({ error: "bad_input" }, 400);
  }
  const req = br({ url: resourceUrl, description: typeof raw.description === "string" ? raw.description : `pay ${sats} sats`, mimeType: "application/json", satoshis: sats, payTo, arcUrl: str(c.env, "ARC_URL", "https://arc.gorillapool.io/v1"), dustFloor: num(c.env, "DUST_FLOOR_SATS", 1) });
  void meter(c.env, "payreq", 0);
  return asJson({ requirements: req, header: b64(req), network: BSV_NETWORK });
});

api.get("/api/manifest", (c) => {
  const url = new URL(c.req.url);
  const base = url.pathname.startsWith("/usenetbsv") ? `${url.origin}/usenetbsv` : url.origin;
  const tools = [
    { name: "group-create", path: `${base}/api/groups`, method: "POST", priceSats: num(c.env, "PRICE_GROUP_CREATE_SATS", 500) },
    { name: "post", path: `${base}/api/groups/:ref/post`, method: "POST", priceSats: "per-group" },
    { name: "feed", path: `${base}/api/groups/:ref/feed`, method: "GET", priceSats: 0 },
    { name: "article", path: `${base}/api/article/:id`, method: "GET", priceSats: "per-article" },
    { name: "report", path: `${base}/api/article/:id/report`, method: "POST", priceSats: num(c.env, "PRICE_REPORT_SATS", 5) },
    { name: "relay-pull", path: `${base}/api/relay/pull`, method: "POST", priceSats: num(c.env, "PRICE_RELAY_SATS", 10) },
    { name: "relay-push", path: `${base}/api/relay/push`, method: "POST", priceSats: num(c.env, "PRICE_RELAY_SATS", 10) },
    { name: "nick", path: `${base}/api/identities/nick`, method: "POST", priceSats: num(c.env, "PRICE_NICK_SATS", 10) },
    { name: "anchor-run", path: `${base}/api/anchor/run`, method: "POST", priceSats: 0 },
    { name: "proof", path: `${base}/api/article/:id/proof`, method: "GET", priceSats: 0 },
    {
      name: "nntp-gateway",
      path: `nntp://${str(c.env, "NNT_GATEWAY_HOST", "2.29.11.72")}:${num(c.env, "NNT_GATEWAY_PORT", 119)} (GROUP, XOVER, ARTICLE, POST, AUTHINFO PAY)`,
      method: "NNTP",
      priceSats: "same-as-http",
    },
  ];
  return asJson({ service: "usenet-bsv", tools, x402: { scheme: "exact", network: BSV_NETWORK, asset: "native:BSV", payTo: str(c.env, "PAY_TO", "") } });
});

/** Free: public NNTP gateway connection details. */
api.get("/api/nntp", (c) =>
  asJson({
    protocol: "NNTP over plain TCP",
    host: str(c.env, "NNT_GATEWAY_HOST", "2.29.11.72"),
    port: num(c.env, "NNT_GATEWAY_PORT", 119),
    fallbackPort: num(c.env, "NNT_GATEWAY_FALLBACK_PORT", 8119),
    baseUrl: "https://entangleit.com/usenetbsv",
    auth: "AUTHINFO PAY <PAYMENT-SIGNATURE> (paid actions; X-PAYREQ returns the challenge)",
    commands: ["CAPABILITIES", "LIST", "GROUP", "XOVER", "OVER", "HDR", "ARTICLE", "HEAD", "BODY", "POST", "CHECK", "TAKETHIS", "AUTHINFO PAY", "X-PAYREQ", "QUIT"],
  }),
);

api.get("/api/agents/top", async (c) => {
  const days = Number.parseInt(new URL(c.req.url).searchParams.get("days") ?? "", 10) || 7;
  return asJson(await leaderboard(c.env, days));
});

/** Free: network totals for the UI landing page. */
api.get("/api/stats", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const [groups, articles, anchors, payments] = await Promise.all([
    d.prepare("SELECT COUNT(*) AS n FROM ug_groups").bind().first<{ n: number }>(),
    d.prepare("SELECT COUNT(*) AS n FROM ug_articles WHERE hidden = 0").bind().first<{ n: number }>(),
    d.prepare("SELECT COUNT(*) AS n FROM ug_anchors").bind().first<{ n: number }>(),
    d.prepare("SELECT COALESCE(SUM(sats), 0) AS sats, COUNT(*) AS calls FROM ug_payments").bind().first<{ sats: number; calls: number }>(),
  ]);
  return asJson({
    groups: groups?.n ?? 0,
    articles: articles?.n ?? 0,
    anchors: anchors?.n ?? 0,
    satsSettled: payments?.sats ?? 0,
    payments: payments?.calls ?? 0,
    network: BSV_NETWORK,
  });
});

/** Free: recent articles across all groups (previews only, never paid bodies). */
api.get("/api/latest", async (c) => {
  const d = db(c.env);
  if (!d) return asJson({ error: "db_unconfigured" }, 503);
  const limit = Math.min(50, Math.max(1, Number.parseInt(new URL(c.req.url).searchParams.get("limit") ?? "20", 10) || 20));
  const r = await d
    .prepare(
      `SELECT a.id, a.message_id, a.parent_id, a.author_addr, a.author_nick, a.subject, a.body,
              a.digest, a.read_price_sats, a.created_tx, a.created_at, g.name AS group_name,
              (SELECT COUNT(*) FROM ug_articles c WHERE c.parent_id = a.id) AS reply_count
       FROM ug_articles a JOIN ug_groups g ON g.id = a.group_id
       WHERE a.hidden = 0 ORDER BY a.created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{
      id: string;
      message_id: string;
      parent_id: string | null;
      author_addr: string;
      author_nick: string;
      subject: string;
      body: string;
      digest: string;
      read_price_sats: number;
      created_tx: string;
      created_at: number;
      group_name: string;
      reply_count: number;
    }>();
  void meter(c.env, "latest", 0);
  return asJson({
    articles: r.results.map((a) => ({
      id: a.id,
      messageId: a.message_id,
      parentId: a.parent_id,
      subject: a.subject,
      from: a.author_nick || shortAddr(a.author_addr),
      author: a.author_addr,
      preview: previewOf(a.body),
      digest: a.digest,
      readPriceSats: a.read_price_sats,
      replyCount: a.reply_count,
      groupName: a.group_name,
      createdTx: a.created_tx,
      createdAt: a.created_at,
    })),
  });
});

// Serve the SPA + static assets for everything that is not an API path.
// Implemented as middleware (not a wildcard route) because the same `api`
// sub-app is mounted at both "/" and "/usenetbsv" — a wildcard inside it would
// shadow the subpath's static routes.
const API_PATH_RE = /^\/(?:usenetbsv\/)?(?:api\/|facilitator\/|handle\/|health$|pricing$|supported$)/;

async function serveAsset(c: Context<{ Bindings: Env }>): Promise<Response> {
  const assets = c.env.ASSETS as { fetch(request: Request): Promise<Response> } | undefined;
  if (!assets) {
    return c.text("UsenetBSV UI bundle is not built. Run `npm run build:ui`.", 503);
  }
  const url = new URL(c.req.url);
  let path = url.pathname;
  if (path === "/usenetbsv") path = "/";
  else if (path.startsWith("/usenetbsv/")) path = path.slice("/usenetbsv".length);
  if (path === "" || path === "/") path = "/index.html";
  const assetUrl = new URL(c.req.url);
  assetUrl.pathname = path;
  return assets.fetch(
    new Request(assetUrl.toString(), {
      method: "GET",
      headers: { accept: c.req.header("accept") ?? "*/*" },
    }),
  );
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  // Legacy path: /usenet -> /usenetbsv (the worker moved with the new UI).
  if (url.pathname === "/usenet" || url.pathname.startsWith("/usenet/")) {
    const to = new URL(c.req.url);
    to.pathname = `/usenetbsv${url.pathname.slice("/usenet".length)}`;
    return c.redirect(to.toString(), 308);
  }
  if (API_PATH_RE.test(url.pathname)) {
    await next();
    return;
  }
  return serveAsset(c);
});

app.route("/", api);
app.route("/usenetbsv", api);

export default app;
