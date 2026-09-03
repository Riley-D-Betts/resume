-- Migration number: 0005
-- Share links — one link per named recipient (`/?k=<token>`) and the document
-- requests that carry it.
--
-- The owner mints a link in /ops against a label ("Jane at Acme"); every
-- document request carrying `?k=` writes one share_hits row from
-- server/middleware/share-capture.ts. There is no chaining and no per-visitor
-- token, so the token never grows and the address bar is never rewritten:
-- when several distinct people open one link the console reports it as
-- FORWARDED with an unknown recipient, which is the true state of knowledge.
--
-- share_hits deliberately stores NO ip and NO raw user agent — both already
-- carry a retention and scrub policy on `sessions`, and duplicating them here
-- would widen the PII surface for no analytical gain. The agent column holds
-- a PLATFORM NAME (Slack, LinkedIn, …) from the named preview-bot table in
-- server/utils/previewAgents.ts, never the header.
--
-- STATEMENT ORDER: the two idempotent CREATEs come first and the single
-- ALTER (not re-runnable — SQLite has no ADD COLUMN IF NOT EXISTS) is LAST,
-- so a part-way failure leaves only that one statement to apply by hand
-- (docs/ANALYTICS.md §7) and everything above it re-runs cleanly.
--
-- RULES: never DROP/RENAME a column; ALTER … ADD COLUMN only with constant defaults; ≤ 100 bound params per statement AND ≤ 100 columns per table
-- (sessions = 71 after 0003) — new per-session facts go to 1:1 side tables; every index = 1 extra row written per insert (justify it);
-- D1 ENFORCES FOREIGN KEYS — every FK child column needs an index or a parent delete is a full scan; CREATE TABLE/INDEX IF NOT EXISTS
-- and DROP INDEX IF EXISTS are re-runnable, ALTER TABLE ADD COLUMN is not — keep ALTERs at the end of their file.

-- ---------------------------------------------------------------------------
-- share_links: one row per minted link. `token` is a 4-character id from an
-- unambiguous lowercase alphabet (no l / 1 / o / 0) and is the primary key, so
-- its autoindex covers every lookup. `revoked` marks a link the owner has
-- retired: hits are STILL recorded (that is the point — a revoked link that
-- keeps being opened is itself the signal), the console just marks it.
-- Never pruned: a link outlives its hits.
CREATE TABLE IF NOT EXISTS share_links (
  token      TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  note       TEXT,
  channel    TEXT,
  created_at INTEGER NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- share_hits: one row per document request carrying a known token. `kind` is
-- view | unfurl | bot (a person, a named preview bot, other automation) and
-- `agent` names the platform for an unfurl. Pruned with the side tables
-- (sideTableRetentionDays) by server/plugins/prune.ts.
CREATE TABLE IF NOT EXISTS share_hits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token         TEXT NOT NULL REFERENCES share_links(token) ON DELETE CASCADE,
  ts            INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  agent         TEXT,
  as_org        TEXT,
  country       TEXT,
  referrer_host TEXT,
  path          TEXT
);
-- (token, ts): FK child column (a share_links delete must never scan) + the
-- per-link hit log and every rollup the console reads.
CREATE INDEX IF NOT EXISTS idx_share_hits_token_ts ON share_hits(token, ts);
-- (ts): the retention band walk and the "last activity" window.
CREATE INDEX IF NOT EXISTS idx_share_hits_ts ON share_hits(ts);

-- ---------------------------------------------------------------------------
-- session_net.share_token: the `rb_k` cookie the capture middleware set,
-- read back by /api/collect on the first envelope (first write wins). This is
-- what turns a link into a session: the console can show that Jane's link
-- produced a visit that read six pages and copied the email address.
-- session_net, not sessions: the banner says new per-session facts belong in
-- the 1:1 side tables, this IS a document-request fact (fetch_site /
-- doc_referer live here) and its SQL is generated from a column array.
-- session_net therefore goes 39 → 40 columns, and Statement B of /api/collect
-- 39 → 40 bound params (0002's header comment predates this file).
ALTER TABLE session_net ADD COLUMN share_token TEXT;
-- (share_token): the per-link session lookup; NULL on almost every row.
CREATE INDEX IF NOT EXISTS idx_session_net_share ON session_net(share_token);
