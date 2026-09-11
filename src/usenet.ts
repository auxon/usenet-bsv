import { z } from "zod";
import { isValidAddress } from "./payments.ts";
import type { Env } from "./env.ts";

/** Minimal D1 surface (real binding + in-memory test mock both satisfy this). */
export interface D1Stmt {
  bind(...params: unknown[]): { first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
}
export interface D1Db {
  prepare(query: string): D1Stmt;
}

export function db(env: Env): D1Db | null {
  return (env.USENET_DB as unknown as D1Db) ?? null;
}

export const GROUP_NAME_RE = /^[a-z0-9][a-z0-9._-]{2,60}$/;

export const GroupInput = z.object({
  name: z.string().regex(GROUP_NAME_RE, "lowercase dots/dashes, 3-61 chars (e.g. bsv.devs)").max(61),
  description: z.string().max(280).default(""),
  postPriceSats: z.number().int().min(0).max(10_000).default(20),
  readPriceDefault: z.number().int().min(0).max(100_000).default(0),
  payTo: z.string().refine(isValidAddress, { message: "invalid payTo address" }),
});
export type GroupInput = z.infer<typeof GroupInput>;

export const PostInput = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(200_000),
  parentId: z.string().max(64).optional(),
  readPriceSats: z.number().int().min(0).max(100_000).optional(),
  nick: z.string().max(32).optional(),
});
export type PostInput = z.infer<typeof PostInput>;

export const RelayArticleInput = z.object({
  group: z.string().regex(GROUP_NAME_RE),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(200_000),
  messageId: z.string().min(3).max(128),
  authorAddr: z.string().max(64).default(""),
  parentId: z.string().max(64).optional(),
});
export type RelayArticleInput = z.infer<typeof RelayArticleInput>;

export interface GroupRow {
  id: string;
  name: string;
  description: string;
  owner_addr: string;
  post_price_sats: number;
  read_price_default: number;
  pay_to: string;
  created_at: number;
  article_count: number;
}

export interface ArticleRow {
  id: string;
  message_id: string;
  group_id: string;
  parent_id: string | null;
  author_addr: string;
  author_nick: string;
  subject: string;
  body: string;
  digest: string;
  pay_to: string;
  read_price_sats: number;
  created_tx: string;
  anchor_id: string | null;
  hidden: number;
  created_at: number;
}

export function newId(prefix: string): string {
  const r = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${prefix}_${r}`;
}

export function messageIdFor(id: string): string {
  return `<${id}@usenet-bsv>`;
}

export async function sha256Hex(text: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function articleDigest(group: string, author: string, subject: string, body: string): Promise<string> {
  return sha256Hex(`${group}\n${author}\n${subject}\n${body}`);
}

export function previewOf(body: string, n = 280): string {
  return body.length <= n ? body : body.slice(0, n) + "…";
}

export function shortAddr(payer: string): string {
  // payer is best-effort like bsv:input:<prefix>; surface as-is, truncated.
  return payer.length > 24 ? payer.slice(0, 24) + "…" : payer;
}

/** Binary Merkle root over hex digests (duplicate last leaf when odd). Empty -> "" */
export async function merkleRoot(digests: string[]): Promise<string> {
  if (digests.length === 0) return "";
  let level = [...digests];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!;
      const b = level[i + 1] ?? a;
      next.push(await sha256Hex(a + b));
    }
    level = next;
  }
  return level[0]!;
}

// --- D1 helpers (all parameterised, no string interpolation of values) ---

export async function getGroupByName(d: D1Db, name: string): Promise<GroupRow | null> {
  return d.prepare("SELECT * FROM ug_groups WHERE name = ?").bind(name).first<GroupRow>();
}

export async function getGroupById(d: D1Db, id: string): Promise<GroupRow | null> {
  return d.prepare("SELECT * FROM ug_groups WHERE id = ?").bind(id).first<GroupRow>();
}

export async function listGroups(d: D1Db, limit = 100): Promise<GroupRow[]> {
  const r = await d.prepare("SELECT * FROM ug_groups ORDER BY article_count DESC, created_at DESC LIMIT ?").bind(limit).all<GroupRow>();
  return r.results;
}

export async function getArticle(d: D1Db, id: string): Promise<ArticleRow | null> {
  return d.prepare("SELECT * FROM ug_articles WHERE id = ?").bind(id).first<ArticleRow>();
}

export async function getArticleByMessageId(d: D1Db, messageId: string): Promise<ArticleRow | null> {
  return d.prepare("SELECT * FROM ug_articles WHERE message_id = ?").bind(messageId).first<ArticleRow>();
}

export async function feedForGroup(d: D1Db, groupId: string, since = 0, limit = 50): Promise<ArticleRow[]> {
  const r = await d
    .prepare("SELECT * FROM ug_articles WHERE group_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?")
    .bind(groupId, since, Math.min(100, Math.max(1, limit)))
    .all<ArticleRow>();
  return r.results;
}

export async function countReports(d: D1Db, articleId: string): Promise<number> {
  const r = await d.prepare("SELECT COUNT(*) as n FROM ug_reports WHERE article_id = ?").bind(articleId).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function unanchoredDigests(d: D1Db, limit = 200): Promise<{ id: string; digest: string }[]> {
  const r = await d.prepare("SELECT id, digest FROM ug_articles WHERE anchor_id IS NULL ORDER BY created_at ASC LIMIT ?").bind(limit).all<{ id: string; digest: string }>();
  return r.results;
}
