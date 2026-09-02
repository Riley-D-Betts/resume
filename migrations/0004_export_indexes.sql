-- 0004_export_indexes.sql — two indexes the /ops CSV and NDJSON export needs.
--
-- These belong in their own migration rather than appended to 0002: wrangler
-- skips a migration file it has already applied, so anything added to 0002
-- after the fact would never be created on a database that already ran it.
-- Both statements are idempotent, so re-running this file is harmless.

-- (ts, id): the export walks events by timestamp with a keyset on (ts, id).
-- Without it the planner scans idx_events_sid_ts and sorts in a temp b-tree.
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts, id);

-- (entered_at, pvid): the same keyset for the page_visits export, which today
-- scans idx_page_visits_sid and sorts.
CREATE INDEX IF NOT EXISTS idx_page_visits_entered ON page_visits(entered_at, pvid);
