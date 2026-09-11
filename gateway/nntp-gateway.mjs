#!/usr/bin/env node
/**
 * Usenet-BSV NNTP gateway (v1, in scope per plan).
 *
 * Classic NNTP framing on TCP, payments via x402 ticket:
 *   - Free reads proxy straight to the Worker HTTP API.
 *   - Paid ARTICLE/POST/TAKETHIS reply `480 Payment required ...`.
 *   - Client pays out-of-band (any BSV x402 buyer), then sends:
 *       AUTHINFO PAY <PAYMENT-SIGNATURE-base64>
 *     and retries. The gateway forwards the signature as the
 *     `PAYMENT-SIGNATURE` HTTP header — verification + settlement stay
 *     server-side in the Worker, never in the gateway.
 *   - `X-PAYREQ` returns the last PAYMENT-REQUIRED header (multi-line) so
 *     pure-NNTP clients can retrieve the full challenge.
 *
 * No keys held. Stateless except per-connection feed cache + paySig.
 */
import net from "node:net";

export const DEFAULT_PORT = Number.parseInt(process.env.GATEWAY_PORT ?? "1119", 10) || 1119;
export const DEFAULT_HOST = process.env.GATEWAY_HOST ?? "127.0.0.1";
export const DEFAULT_BASE = (process.env.USENET_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

export function parseRange(spec, max) {
  // "1-", "1-5", "3", "" (current) -> [lo, hi] clamped, 1-based. Empty -> [].
  if (!spec) return [];
  const s = spec.trim();
  const m = /^(\d+)(?:-(\d*))?$/.exec(s);
  if (!m) return [];
  const lo = Math.max(1, Number.parseInt(m[1], 10));
  // NOTE: `(\d*)` may come back undefined OR "" for an open range depending on
  // engine backtracking — key off the dash itself for "1-" -> max.
  let hi;
  if (!s.includes("-")) hi = lo;
  else if (m[2] === undefined || m[2] === "") hi = max;
  else hi = Number.parseInt(m[2], 10);
  const h = Math.min(max, Number.isFinite(hi) ? hi : max);
  if (h < lo) return [];
  const out = [];
  for (let n = lo; n <= h; n++) out.push(n);
  return out;
}

export function dotStuff(line) {
  return line.startsWith(".") ? "." + line : line;
}

export function formatXoverLine(n, a) {
  const date = new Date(a.createdAt ?? Date.now()).toUTCString();
  const refs = a.parentId ? `<${a.parentId}@usenet-bsv>` : "";
  const bytes = String((a.subject ?? "").length + (a.preview ?? "").length + 128);
  const lines = String(Math.max(1, Math.ceil(((a.preview ?? "").length + 40) / 80)));
  const from = (a.from ?? "anon").replace(/[\r\n\t]/g, " ");
  const subj = (a.subject ?? "").replace(/[\r\n\t]/g, " ");
  return `${n}\t${subj}\t${from}\t${date}\t${a.messageId}\t${refs}\t${bytes}\t${lines}`;
}

export function parsePosting(text) {
  // Split RFC5322-ish headers from body on first blank line.
  const lines = text.split("\n");
  const headers = {};
  let i = 0;
  let lastKey = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.trim() === "") {
      i++;
      break;
    }
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (m) {
      lastKey = m[1].toLowerCase();
      headers[lastKey] = m[2];
    } else if (lastKey && /^\s/.test(line)) {
      headers[lastKey] += " " + line.trim();
    }
  }
  const body = lines.slice(i).join("\n").trim();
  const group = (headers["newsgroups"] ?? "").split(/[,\s]+/).filter(Boolean)[0] ?? "";
  const parentRaw = headers["references"] ?? headers["in-reply-to"] ?? "";
  const parentMatch = /<([^@>]+)@usenet-bsv>/.exec(parentRaw);
  return {
    group,
    subject: (headers["subject"] ?? "(no subject)").slice(0, 200),
    nick: (headers["from"] ?? headers["x-nick"] ?? "").slice(0, 32),
    parentId: parentMatch ? parentMatch[1].replace(/^ua_/, "ua_") : undefined,
    body,
  };
}

async function httpJson(fetchFn, url, opts = {}) {
  const res = await fetchFn(url, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) } });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json };
}

function paySigHeaders(state) {
  return state.paySig ? { "PAYMENT-SIGNATURE": state.paySig } : {};
}

export function createGateway({ baseUrl = DEFAULT_BASE, fetchFn = fetch, port = DEFAULT_PORT, host = DEFAULT_HOST } = {}) {
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("200 usenet-bsv NNTP gateway ready (AUTHINFO PAY for paid actions)\r\n");
    const state = { group: null, feed: [], paySig: null, lastPayReq: null, posting: false, postBuf: [], takeMsgId: null, takeBuf: [], taking: false };
    // Forward the client's IP so the API rate-limits per reader, not per gateway.
    const clientIp = (socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    const api = (path, opts = {}) =>
      httpJson(fetchFn, `${baseUrl}${path}`, {
        ...opts,
        headers: { "X-NNT-Client-IP": clientIp, ...(opts.headers ?? {}) },
      });
    let buf = "";
    let chain = Promise.resolve();

    const send = (s) => new Promise((resolve, reject) => socket.write(s, (e) => (e ? reject(e) : resolve())));
    const sendLines = async (lines) => {
      for (const l of lines) await send(dotStuff(l) + "\r\n");
      await send(".\r\n");
    };

    async function refreshFeed(groupName) {
      const g = await api(`/api/groups/${encodeURIComponent(groupName)}/feed?limit=200`);
      if (g.status !== 200) return null;
      return g.json.articles ?? [];
    }

    async function fetchArticleByNum(n) {
      const item = state.feed[n - 1];
      if (!item) return { status: 423, json: null };
      return api(`/api/article/${item.id}`, { headers: paySigHeaders(state) });
    }

    async function handleArticleCmd(verb, arg) {
      let n = null;
      let id = null;
      if (!arg) {
        n = state.current ?? 1;
      } else if (/^<\S+>$/.test(arg)) {
        const r = await api(`/api/article/by-msgid/${encodeURIComponent(arg)}`);
        if (r.status !== 200) {
          await send("430 No such article\r\n");
          return;
        }
        id = r.json.id;
      } else if (/^\d+$/.test(arg)) {
        n = Number.parseInt(arg, 10);
      }
      let r;
      if (id) {
        r = await api(`/api/article/${id}`, { headers: paySigHeaders(state) });
      } else {
        if (!state.group) {
          await send("412 No newsgroup selected\r\n");
          return;
        }
        if (!n || n < 1 || n > state.feed.length) {
          await send("423 No such article number\r\n");
          return;
        }
        state.current = n;
        r = await fetchArticleByNum(n);
      }
      if (r.status === 402) {
        state.lastPayReq = r.headers?.get?.("PAYMENT-REQUIRED") ?? r.json?.header ?? null;
        const price = r.json?.priceSats ?? "?";
        const payTo = r.json?.payTo ?? "";
        await send(`480 Payment required price=${price} payTo=${payTo}; send AUTHINFO PAY <PAYMENT-SIGNATURE> then retry (X-PAYREQ for full challenge)\r\n`);
        return;
      }
      if (r.status !== 200 || !r.json) {
        await send("430 No such article\r\n");
        return;
      }
      const a = r.json;
      const num = n ?? state.current ?? 0;
      const head = [`Subject: ${a.subject}`, `From: ${a.from ?? a.author}`, `Message-ID: ${a.messageId}`, `Date: ${new Date(a.createdAt).toUTCString()}`, `X-Digest: ${a.digest}`, `X-Price: ${a.priceSats ?? 0}`];
      const bodyLines = String(a.body ?? "").split("\n");
      if (verb === "HEAD") {
        await send(`221 ${num} ${a.messageId} headers\r\n`);
        await sendLines(head);
      } else if (verb === "BODY") {
        await send(`222 ${num} ${a.messageId} body\r\n`);
        await sendLines(bodyLines);
      } else {
        await send(`220 ${num} ${a.messageId} article\r\n`);
        await sendLines([...head, "", ...bodyLines]);
      }
    }

    async function exec(line) {
      const [rawCmd, ...rest] = line.trim().split(/\s+/);
      const cmd = (rawCmd ?? "").toUpperCase();
      const arg = rest.join(" ");

      switch (cmd) {
        case "CAPABILITIES":
          await send("101 Capability list:\r\n");
          await send("VERSION 2\r\nREADER\r\nPOST\r\nOVER\r\nHDR\r\nLIST ACTIVE NEWSGROUPS\r\nAUTHINFO PAY\r\nX-PAYREQ\r\n.\r\n");
          return;
        case "MODE":
          await send("200 Reader mode\r\n");
          return;
        case "QUIT":
          await send("205 Bye\r\n");
          socket.end();
          return;
        case "DATE": {
          const d = new Date();
          const p = (x) => String(x).padStart(2, "0");
          await send(`111 ${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}\r\n`);
          return;
        }
        case "HELP":
          await send("100 Commands: CAPABILITIES GROUP LIST XOVER ARTICLE HEAD BODY POST AUTHINFO PAY X-PAYREQ CHECK TAKETHIS QUIT\r\n");
          return;
        case "AUTHINFO": {
          const [kind, ...sigParts] = arg.split(/\s+/);
          if ((kind ?? "").toUpperCase() !== "PAY" || !sigParts.join(" ")) {
            await send("502 AUTHINFO USER/PASS not supported; use AUTHINFO PAY <PAYMENT-SIGNATURE>\r\n");
            return;
          }
          const sig = sigParts.join(" ").trim();
          try {
            const raw = Buffer.from(sig, "base64").toString("utf8");
            const p = JSON.parse(raw);
            if (!p.txHex) throw new Error("no txHex");
          } catch {
            await send("481 Invalid PAY signature (expected base64 PAYMENT-SIGNATURE)\r\n");
            return;
          }
          state.paySig = sig;
          await send("281 Payment signature accepted; retry the paid command\r\n");
          return;
        }
        case "X-PAYREQ":
          if (!state.lastPayReq) {
            await send("282 No pending payment challenge\r\n");
            return;
          }
          await send("282 Pending PAYMENT-REQUIRED follows\r\n");
          await sendLines([state.lastPayReq]);
          return;
        case "LIST": {
          const sub = (arg.split(/\s+/)[0] ?? "").toUpperCase();
          if (sub === "" || sub === "ACTIVE") {
            const r = await api(`/api/groups`);
            if (r.status !== 200) {
              await send("503 Backend unavailable\r\n");
              return;
            }
            await send(`215 ${r.json.groups.length} groups\r\n`);
            await sendLines(r.json.groups.map((g) => `${g.name} ${Math.max(g.articleCount, 0)} ${g.articleCount > 0 ? 1 : 0} y`));
            return;
          }
          if (sub === "NEWSGROUPS") {
            const r = await api(`/api/groups`);
            if (r.status !== 200) {
              await send("503 Backend unavailable\r\n");
              return;
            }
            await send(`215 ${r.json.groups.length} groups\r\n`);
            await sendLines(r.json.groups.map((g) => `${g.name}\t${(g.description ?? "").replace(/[\r\n\t]/g, " ")}`));
            return;
          }
          await send("501 LIST [ACTIVE|NEWSGROUPS]\r\n");
          return;
        }
        case "GROUP": {
          if (!arg) {
            await send("501 GROUP <newsgroup>\r\n");
            return;
          }
          const g = await api(`/api/groups/${encodeURIComponent(arg)}`);
          if (g.status !== 200) {
            await send("411 No such newsgroup\r\n");
            return;
          }
          const feed = (await refreshFeed(g.json.name)) ?? [];
          state.group = g.json;
          state.feed = feed;
          state.current = feed.length > 0 ? 1 : 0;
          const n = feed.length;
          await send(`211 ${n} ${n > 0 ? 1 : 0} ${n} ${g.json.name}\r\n`);
          return;
        }
        case "XOVER":
        case "OVER": {
          if (!state.group) {
            await send("412 No newsgroup selected\r\n");
            return;
          }
          const range = parseRange(arg || `1-`, state.feed.length);
          await send(`224 Overview for ${state.group.name}\r\n`);
          await sendLines(range.map((n) => formatXoverLine(n, state.feed[n - 1])));
          return;
        }
        case "HDR":
        case "XHDR": {
          if (!state.group) {
            await send("412 No newsgroup selected\r\n");
            return;
          }
          const [fieldRaw, rangeRaw] = arg.split(/\s+/);
          const field = (fieldRaw ?? "").toLowerCase();
          const range = parseRange(rangeRaw ?? "", state.feed.length);
          const pick = (a, i) => {
            const d = new Date(a.createdAt ?? Date.now()).toUTCString();
            switch (field) {
              case "subject": return a.subject;
              case "from": return a.from;
              case "message-id": case "message_id": return a.messageId;
              case "date": return d;
              case ":bytes": return String((a.preview ?? "").length + 128);
              case ":lines": return String(Math.max(1, Math.ceil(((a.preview ?? "").length + 40) / 80)));
              default: return null;
            }
          };
          if (!field) {
            await send("501 HDR <field> <range>\r\n");
            return;
          }
          await send(`225 Headers for ${field}\r\n`);
          const lines = [];
          range.forEach((n, i) => {
            const v = pick(state.feed[n - 1], i);
            if (v !== null) lines.push(`${n} ${v}`);
          });
          await sendLines(lines);
          return;
        }
        case "ARTICLE":
        case "HEAD":
        case "BODY":
          await handleArticleCmd(cmd, arg);
          return;
        case "POST":
          await send("340 Send article; end with <CR-LF>.<CR-LF>\r\n");
          state.posting = true;
          state.postBuf = [];
          return;
        case "CHECK": {
          if (!arg) {
            await send("501 CHECK <message-id>\r\n");
            return;
          }
          const r = await api(`/api/article/by-msgid/${encodeURIComponent(arg)}`);
          await send(r.status === 200 ? "431 Already have it\r\n" : "238 Send it\r\n");
          return;
        }
        case "TAKETHIS":
          if (!arg) {
            await send("501 TAKETHIS <message-id>\r\n");
            return;
          }
          state.taking = true;
          state.takeMsgId = arg;
          state.takeBuf = [];
          return;
        case "IHAVE":
          await send("435 Not accepted here; use CHECK/TAKETHIS\r\n");
          return;
        default:
          await send("500 Unknown command\r\n");
      }
    }

    async function finishPost() {
      const text = state.postBuf.join("\n");
      const p = parsePosting(text);
      if (!p.group) {
        await send("441 Posting failed: missing Newsgroups header\r\n");
        return;
      }
      if (!p.body) {
        await send("441 Posting failed: empty body\r\n");
        return;
      }
      const r = await api(`/api/groups/${encodeURIComponent(p.group)}/post`, {
        method: "POST",
        headers: paySigHeaders(state),
        body: JSON.stringify({ subject: p.subject, body: p.body, parentId: p.parentId, nick: p.nick || undefined }),
      });
      if (r.status === 402) {
        state.lastPayReq = r.headers?.get?.("PAYMENT-REQUIRED") ?? null;
        await send(`480 Payment required price=${r.json?.priceSats ?? "?"} payTo=${r.json?.payTo ?? ""}; send AUTHINFO PAY <PAYMENT-SIGNATURE> then retry POST (X-PAYREQ for full challenge)\r\n`);
        return;
      }
      if (r.status === 201 && r.json) {
        state.current = state.feed.length + 1;
        state.feed.push({ id: r.json.id, messageId: r.json.messageId, subject: p.subject, from: "you", preview: p.body.slice(0, 280), parentId: p.parentId, createdAt: Date.now(), readPriceSats: 0 });
        const txid = r.json?.createdTx ?? r.json?.settlement?.transaction ?? "";
        await send(`240 Posted ${r.json.messageId}${txid ? ` tx=${txid}` : ""}\r\n`);
        return;
      }
      await send(`441 Posting failed: ${r.json?.error ?? r.status}\r\n`);
    }

    async function finishTake() {
      const text = state.takeBuf.join("\n");
      const p = parsePosting(text);
      const r = await api(`/api/relay/push`, {
        method: "POST",
        headers: paySigHeaders(state),
        body: JSON.stringify({ articles: [{ group: p.group || "misc.relay", subject: p.subject, body: p.body || text.slice(0, 1000), messageId: state.takeMsgId, authorAddr: "" }] }),
      });
      if (r.status === 402) {
        state.lastPayReq = r.headers?.get?.("PAYMENT-REQUIRED") ?? null;
        await send(`481 Relay payment required price=${r.json?.priceSats ?? "?"}; AUTHINFO PAY then retry TAKETHIS\r\n`);
        return;
      }
      if (r.status === 200) {
        await send(`239 ${state.takeMsgId} received\r\n`);
        return;
      }
      await send(`439 ${state.takeMsgId} failed: ${r.json?.error ?? r.status}\r\n`);
    }

    socket.on("data", (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\r\n")) >= 0) {
        const rawLine = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = rawLine;
        chain = chain.then(async () => {
          if (state.posting) {
            if (line === ".") {
              state.posting = false;
              await finishPost();
            } else {
              state.postBuf.push(line.startsWith("..") ? line.slice(1) : line);
            }
            return;
          }
          if (state.taking) {
            if (line === ".") {
              state.taking = false;
              await finishTake();
            } else {
              state.takeBuf.push(line.startsWith("..") ? line.slice(1) : line);
            }
            return;
          }
          if (line.trim() === "") return;
          await exec(line);
        }).catch(() => send("503 Internal error\r\n").catch(() => {}));
      }
      if (buf.length > 2_000_000) {
        socket.destroy();
      }
    });

    socket.on("error", () => {});
  });

  return {
    server,
    listen: () => new Promise((resolve) => server.listen(port, host, resolve)),
    close: () => new Promise((resolve) => server.close(resolve)),
    address: () => server.address(),
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const gw = createGateway({});
  gw.listen().then(() => {
    console.log(`usenet-bsv NNTP gateway on ${DEFAULT_HOST}:${DEFAULT_PORT} -> ${DEFAULT_BASE}`);
  });
}
