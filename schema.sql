-- Usenet-BSV v1 schema (D1 / SQLite)
-- Off-chain bodies (TEXT capped by app at 200KB) + SHA-256 digests anchored in batches.

CREATE TABLE IF NOT EXISTS ug_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  owner_addr TEXT NOT NULL DEFAULT '',
  post_price_sats INTEGER NOT NULL DEFAULT 20,
  read_price_default INTEGER NOT NULL DEFAULT 0,
  pay_to TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  article_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ug_articles (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  group_id TEXT NOT NULL REFERENCES ug_groups(id),
  parent_id TEXT,
  author_addr TEXT NOT NULL DEFAULT '',
  author_nick TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  digest TEXT NOT NULL DEFAULT '',
  pay_to TEXT NOT NULL DEFAULT '',
  read_price_sats INTEGER NOT NULL DEFAULT 0,
  created_tx TEXT NOT NULL DEFAULT '',
  anchor_id TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_group_time ON ug_articles(group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_articles_digest ON ug_articles(digest);

CREATE TABLE IF NOT EXISTS ug_payments (
  txid TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT '',
  sats INTEGER NOT NULL DEFAULT 0,
  payer TEXT NOT NULL DEFAULT '',
  resource_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ug_reports (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES ug_articles(id),
  reporter TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(article_id, reporter)
);

CREATE TABLE IF NOT EXISTS ug_anchors (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  txid_ref TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ug_identities (
  addr TEXT PRIMARY KEY,
  nick TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ug_peers (
  id TEXT PRIMARY KEY,
  base_url TEXT NOT NULL UNIQUE,
  allowlisted INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
