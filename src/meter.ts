import type { Env } from "./env.ts";

/** Minimal KV surface we need (structural — no workers-types dependency). */
export interface MeterKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  list(opts?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

const kv = (env: Env): MeterKV | null => (env.METER as unknown as MeterKV) ?? null;

export const dayStamp = (d = new Date()): string =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;

const minuteStamp = (d = new Date()): string =>
  dayStamp(d) + String(d.getUTCHours()).padStart(2, "0") + String(d.getUTCMinutes()).padStart(2, "0");

export type MeterRow = { calls: number; sats: number };

/** Fire-and-forget usage counter per endpoint per day. Never throws. */
export async function meter(env: Env, endpoint: string, sats = 0): Promise<void> {
  try {
    const store = kv(env);
    if (!store) return;
    const key = `m:${endpoint}:${dayStamp()}`;
    let row: MeterRow = { calls: 0, sats: 0 };
    try {
      const raw = await store.get(key);
      if (raw) row = JSON.parse(raw) as MeterRow;
    } catch {
      row = { calls: 0, sats: 0 };
    }
    row.calls += 1;
    row.sats += sats;
    await store.put(key, JSON.stringify(row), { expirationTtl: 90 * 24 * 3600 });
  } catch {
    /* metering must never break serving */
  }
}

export type RateInfo = { allowed: boolean; remaining: number; reset: number };

/** Fixed-window per-IP rate limit. Open when unconfigured. Never throws-closed. */
export async function checkRate(env: Env, ip: string, route: string, limit: number): Promise<RateInfo> {
  const reset = Math.ceil(Date.now() / 1000) + 60;
  try {
    const store = kv(env);
    if (!store || !(limit > 0)) return { allowed: true, remaining: limit, reset };
    const key = `rl:${ip}:${route}:${minuteStamp()}`;
    const n = Number.parseInt((await store.get(key)) ?? "0", 10) || 0;
    if (n >= limit) return { allowed: false, remaining: 0, reset };
    await store.put(key, String(n + 1), { expirationTtl: 120 });
    return { allowed: true, remaining: Math.max(0, limit - n - 1), reset };
  } catch {
    return { allowed: true, remaining: limit, reset };
  }
}

export function rateHeaders(info: RateInfo, limit: number): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(info.remaining),
    "X-RateLimit-Reset": String(info.reset),
  };
}

/** Collapse a pathname to a route key: /api/tx/<64hex> -> /api/tx/:txid. */
export function routeKey(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) => {
      if (/^[0-9a-f]{64}$/i.test(seg)) return ":txid";
      if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(seg)) return ":addr";
      if (/^\d+$/.test(seg) && seg.length > 0) return ":n";
      return seg;
    })
    .join("/");
}

/** Aggregate metered usage over the trailing `days` (default 7, max 30). */
export async function leaderboard(
  env: Env,
  days = 7,
): Promise<{ window: string[]; endpoints: { endpoint: string; calls: number; sats: number }[] }> {
  const store = kv(env);
  const want: string[] = [];
  const now = new Date();
  for (let i = 0; i < Math.min(30, Math.max(1, days)); i++) {
    const d = new Date(now.getTime() - i * 86400000);
    want.push(dayStamp(d));
  }
  const agg = new Map<string, MeterRow>();
  if (store) {
    let cursor: string | undefined;
    for (;;) {
      const page = await store.list({ prefix: "m:", limit: 1000, ...(cursor ? { cursor } : {}) }).catch(() => null);
      if (!page) break;
      for (const k of page.keys) {
        const m = /^m:(.+):(\d{8})$/.exec(k.name);
        if (!m || m[1] === undefined || m[2] === undefined || !want.includes(m[2])) continue;
        const endpoint = m[1];
        try {
          const raw = await store.get(k.name);
          if (!raw) continue;
          const row = JSON.parse(raw) as MeterRow;
          const cur = agg.get(endpoint) ?? { calls: 0, sats: 0 };
          cur.calls += row.calls || 0;
          cur.sats += row.sats || 0;
          agg.set(endpoint, cur);
        } catch {
          continue;
        }
      }
      if (page.list_complete || !page.cursor) break;
      cursor = page.cursor;
    }
  }
  const endpoints = [...agg.entries()]
    .map(([endpoint, r]) => ({ endpoint, calls: r.calls, sats: r.sats }))
    .sort((a, b) => b.sats - a.sats || b.calls - a.calls);
  return { window: want, endpoints };
}
