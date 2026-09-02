-- Migration number: 0003
-- Column additions only (ALTER TABLE … ADD COLUMN). NOT re-runnable: SQLite has
-- no ADD COLUMN IF NOT EXISTS, so this file is kept apart from the idempotent
-- 0002. Recovery when it fails part-way (docs/ANALYTICS.md §7): apply the
-- remaining ALTERs by hand with `wrangler d1 execute resume-analytics --remote
-- --command "..."`, then insert the bookkeeping row into d1_migrations.
-- Every default is a constant, so each ALTER is O(1) and old Worker code keeps
-- working against the widened tables.
--
-- RULES: never DROP/RENAME a column; ALTER … ADD COLUMN only with constant defaults; ≤ 100 bound params per statement AND ≤ 100 columns per table
-- (sessions = 71 after 0003) — new per-session facts go to 1:1 side tables; every index = 1 extra row written per insert (justify it);
-- D1 ENFORCES FOREIGN KEYS — every FK child column needs an index or a parent delete is a full scan; CREATE TABLE/INDEX IF NOT EXISTS
-- and DROP INDEX IF EXISTS are re-runnable, ALTER TABLE ADD COLUMN is not — keep ALTERs in their own file.

-- ---------------------------------------------------------------------------
-- sessions: hot fields (filters, grouping) + per-session counters.
-- 34 columns from 0001 + 37 here = 71. Statement A binds 70 params
-- (contract C.5); anything new goes to session_net / session_env instead.
ALTER TABLE sessions ADD COLUMN exit_path TEXT;
ALTER TABLE sessions ADD COLUMN last_path TEXT;
ALTER TABLE sessions ADD COLUMN is_returning INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN visit_n INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN nav_kind TEXT;
ALTER TABLE sessions ADD COLUMN asn INTEGER;
ALTER TABLE sessions ADD COLUMN as_org TEXT;
ALTER TABLE sessions ADD COLUMN is_webdriver INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN gpc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN dnt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN save_data INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN is_tor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN prints INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN copies INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN email_copies INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN selects INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN form_started INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN form_submitted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN finds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN searches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN exit_intents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN rage_clicks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN dead_clicks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN right_clicks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN errors INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN outbounds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN mailto_clicks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN hovers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN eggs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN subtabs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN hidden_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN blurs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN ptr_n INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN touch_n INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN key_n INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN first_interaction_ms INTEGER;
ALTER TABLE sessions ADD COLUMN events_n INTEGER NOT NULL DEFAULT 0;
-- (as_org): Organizations view grouping / drill-down. No idx_sessions_last_seen
-- (contract D29: LIVE scans the last 6 h of started_at instead).
CREATE INDEX IF NOT EXISTS idx_sessions_as_org ON sessions(as_org);

-- ---------------------------------------------------------------------------
-- visitors: denormalised "who" facts (first/last org + country, landing path).
ALTER TABLE visitors ADD COLUMN first_as_org TEXT;
ALTER TABLE visitors ADD COLUMN first_country TEXT;
ALTER TABLE visitors ADD COLUMN first_entry_path TEXT;
ALTER TABLE visitors ADD COLUMN last_as_org TEXT;
ALTER TABLE visitors ADD COLUMN last_country TEXT;

-- ---------------------------------------------------------------------------
-- events: per-event page path (K4). No index (rows-written budget); path
-- queries go through page_visits, legacy rows fall back to sessions.entry_path.
ALTER TABLE events ADD COLUMN path TEXT;
