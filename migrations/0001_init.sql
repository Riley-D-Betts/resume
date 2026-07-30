-- Migration number: 0001
-- Initial analytics schema, ported from server/utils/migrate.ts (v1).
-- Applied with `wrangler d1 migrations apply resume-analytics` — wrangler
-- tracks applied migrations in its own d1_migrations table, so never edit
-- this file once deployed; add 0002_*.sql instead.

CREATE TABLE visitors (
  vid            TEXT PRIMARY KEY,
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  visit_count    INTEGER NOT NULL DEFAULT 1,
  first_referrer TEXT,
  first_utm_source TEXT,
  first_utm_medium TEXT,
  first_utm_campaign TEXT
);

CREATE TABLE sessions (
  sid          TEXT PRIMARY KEY,
  vid          TEXT NOT NULL REFERENCES visitors(vid),
  started_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  ua TEXT,
  browser TEXT,
  browser_ver TEXT,
  os TEXT,
  device_type TEXT,
  screen_w INTEGER, screen_h INTEGER,
  viewport_w INTEGER, viewport_h INTEGER,
  dpr REAL,
  lang TEXT,
  tz TEXT,
  country TEXT, region TEXT, city TEXT, lat REAL, lon REAL,
  referrer TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT,
  entry_path TEXT,
  pageviews INTEGER NOT NULL DEFAULT 0,
  max_scroll_pct INTEGER NOT NULL DEFAULT 0,
  is_bot INTEGER NOT NULL DEFAULT 0,
  has_replay INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_started ON sessions(started_at);
CREATE INDEX idx_sessions_vid     ON sessions(vid);

CREATE TABLE events (
  id      INTEGER PRIMARY KEY,
  sid     TEXT NOT NULL REFERENCES sessions(sid) ON DELETE CASCADE,
  ts      INTEGER NOT NULL,
  type    TEXT NOT NULL,
  name    TEXT,
  payload TEXT
);
CREATE INDEX idx_events_sid_ts  ON events(sid, ts);
CREATE INDEX idx_events_type_ts ON events(type, ts);

CREATE TABLE replay_chunks (
  sid        TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  bytes      INTEGER NOT NULL,
  compressed INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (sid, seq)
);

-- Honeypot flags moved out of process memory: Workers isolates are many and
-- short-lived, so the 24h bot flag has to live in the database to stick.
CREATE TABLE honeypot_ips (
  ip         TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
