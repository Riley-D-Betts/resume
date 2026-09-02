-- Migration number: 0002
-- Side tables, the rid-keyed replay ledger, the durable login throttle and the
-- indexes for the analytics expansion. FULLY IDEMPOTENT: every statement is
-- CREATE ... IF NOT EXISTS, DROP INDEX IF EXISTS or INSERT OR IGNORE, so this
-- file can be re-run on any database (fresh, or carrying 0001 + live rows).
-- Column-adding ALTERs live in 0003_session_columns.sql (they are not re-runnable).
--
-- RULES: never DROP/RENAME a column; ALTER … ADD COLUMN only with constant defaults; ≤ 100 bound params per statement AND ≤ 100 columns per table
-- (sessions = 71 after 0003) — new per-session facts go to 1:1 side tables; every index = 1 extra row written per insert (justify it);
-- D1 ENFORCES FOREIGN KEYS — every FK child column needs an index or a parent delete is a full scan; CREATE TABLE/INDEX IF NOT EXISTS
-- and DROP INDEX IF EXISTS are re-runnable, ALTER TABLE ADD COLUMN is not — keep ALTERs in their own file.

-- ---------------------------------------------------------------------------
-- session_net: one row per session (1:1). request.cf network/geo extras,
-- request headers, the document-request Sec-Fetch-* facts from the SSR
-- handoff, client vs Cloudflare timezone offsets and the optional reverse-DNS
-- host. TLS/JA3/JA4 hashes are automation signals only: never grouped or
-- joined on. 39 columns = the 39 bound params of Statement B (contract C.5).
-- The TEXT PRIMARY KEY autoindex covers the FK child column (no extra index).
CREATE TABLE IF NOT EXISTS session_net (
  sid TEXT PRIMARY KEY REFERENCES sessions(sid) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  colo TEXT, http_protocol TEXT, tls_version TEXT, tls_cipher TEXT,
  client_rtt_ms INTEGER, rtt_kind TEXT, request_priority TEXT, accept_encoding TEXT,
  tls_ciphers_sha1 TEXT, tls_ext_sha1 TEXT, tls_hello_len INTEGER, cf_ray TEXT,
  continent TEXT, region_code TEXT, postal_code TEXT, metro_code TEXT, cf_tz TEXT, is_eu INTEGER,
  bot_score INTEGER, verified_bot INTEGER, verified_bot_category TEXT, ja3_hash TEXT, ja4 TEXT, client_trust_score INTEGER,
  accept_language TEXT, ch_ua TEXT, ch_mobile INTEGER, ch_platform TEXT,
  fetch_site TEXT, fetch_mode TEXT, fetch_dest TEXT, fetch_user INTEGER, doc_referer TEXT, early_data INTEGER,
  client_tz_offset_min INTEGER, cf_tz_offset_min INTEGER,
  rdns_host TEXT
);

-- ---------------------------------------------------------------------------
-- session_env: one row per session (1:1). The browser `env` probe, typed for
-- grouping; latest non-null value wins on merge. 62 columns = 62 bound params.
-- The TEXT PRIMARY KEY autoindex covers the FK child column (no extra index).
CREATE TABLE IF NOT EXISTS session_env (
  sid TEXT PRIMARY KEY REFERENCES sessions(sid) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  webdriver INTEGER, ua_brands TEXT, ua_mobile INTEGER, ua_platform TEXT,
  ua_arch TEXT, ua_bitness TEXT, ua_model TEXT, ua_platform_ver TEXT, ua_full_versions TEXT, ua_form_factors TEXT, ua_wow64 INTEGER,
  languages TEXT, max_touch_points INTEGER, pdf_viewer INTEGER, cookies_enabled INTEGER, gpc_js INTEGER, dnt_js INTEGER,
  gpu_vendor TEXT, gpu_renderer TEXT, webgpu_vendor TEXT, webgpu_arch TEXT, webgpu_device TEXT, webgpu_desc TEXT,
  battery_level INTEGER, battery_charging INTEGER, storage_quota_mb INTEGER, storage_usage_mb INTEGER,
  media_audioinput INTEGER, media_videoinput INTEGER, media_audiooutput INTEGER,
  color_scheme TEXT, reduced_motion INTEGER, contrast TEXT, forced_colors INTEGER, inverted_colors INTEGER, reduced_transparency INTEGER,
  avail_w INTEGER, avail_h INTEGER, color_depth INTEGER, orientation TEXT,
  js_heap_limit_mb INTEGER, js_heap_used_mb INTEGER,
  net_type TEXT, net_effective TEXT, net_downlink REAL, net_rtt INTEGER, net_save_data INTEGER,
  voices INTEGER, tz_name TEXT, tz_offset_min INTEGER, intl_locale TEXT, display_mode TEXT,
  outer_w INTEGER, outer_h INTEGER, inner_w INTEGER, inner_h INTEGER,
  device_memory REAL, cores INTEGER, platform TEXT, touch INTEGER
);

-- ---------------------------------------------------------------------------
-- page_visits: one row per page visit (pvid) — the unit of page analytics and
-- the Pages / Flows / Live / PathTimeline fast path. Kept with sessions
-- (sideTableRetentionDays). 19 columns = 19 bound params.
CREATE TABLE IF NOT EXISTS page_visits (
  pvid TEXT PRIMARY KEY,
  sid TEXT NOT NULL REFERENCES sessions(sid) ON DELETE CASCADE,
  path TEXT NOT NULL,
  entered_at INTEGER NOT NULL,
  left_at INTEGER,
  from_path TEXT, nav_kind TEXT, soft_nav_ms INTEGER,
  active_ms INTEGER NOT NULL DEFAULT 0, hidden_ms INTEGER NOT NULL DEFAULT 0,
  max_scroll_pct INTEGER NOT NULL DEFAULT 0, scroll_px INTEGER NOT NULL DEFAULT 0,
  scroll_reversals INTEGER NOT NULL DEFAULT 0, max_scroll_vel INTEGER,
  sections_seen INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0,
  text_len INTEGER, console_errors INTEGER NOT NULL DEFAULT 0,
  leave_reason TEXT
);
-- (sid, entered_at): FK child + the per-session ACTIVE subquery and PathTimeline.
CREATE INDEX IF NOT EXISTS idx_page_visits_sid  ON page_visits(sid, entered_at);
-- (path, entered_at): Pages view and page detail by range.
CREATE INDEX IF NOT EXISTS idx_page_visits_path ON page_visits(path, entered_at);

-- ---------------------------------------------------------------------------
-- page_perf: one row per document load / SPA visit (pvid): vitals, navigation
-- timing, resource and long-task summaries (first write per column). Pruned
-- with events (eventRetentionDays). 38 columns = 38 bound params.
CREATE TABLE IF NOT EXISTS page_perf (
  pvid TEXT PRIMARY KEY,
  sid TEXT NOT NULL REFERENCES sessions(sid) ON DELETE CASCADE,
  ts INTEGER NOT NULL, path TEXT NOT NULL,
  ttfb_ms INTEGER, fcp_ms INTEGER, lcp_ms INTEGER, lcp_sel TEXT, lcp_size INTEGER, cls REAL, inp_ms INTEGER,
  dns_ms INTEGER, connect_ms INTEGER, tls_ms INTEGER, request_ms INTEGER, response_ms INTEGER,
  dom_interactive_ms INTEGER, dcl_ms INTEGER, load_ms INTEGER,
  transfer_bytes INTEGER, encoded_bytes INTEGER, decoded_bytes INTEGER, redirects INTEGER, protocol TEXT, nav_type TEXT,
  res_count INTEGER, res_bytes INTEGER, res_cached INTEGER, res_by_type TEXT, res_slowest TEXT,
  long_tasks INTEGER, long_task_ms INTEGER, long_task_max_ms INTEGER,
  loaf_count INTEGER, loaf_ms INTEGER, loaf_max_ms INTEGER, loaf_script TEXT,
  soft_nav_ms INTEGER
);
-- (ts): Performance view by range and the prune band.
CREATE INDEX IF NOT EXISTS idx_page_perf_ts  ON page_perf(ts);
-- (sid): FK child (cascade) — verified SCAN page_perf without it.
CREATE INDEX IF NOT EXISTS idx_page_perf_sid ON page_perf(sid);

-- ---------------------------------------------------------------------------
-- rdns_cache: reverse-DNS answers (NUXT_RDNS_ENABLED, only used while
-- NUXT_IP_ANONYMIZE=false). Expired rows are swept by the prune cron.
CREATE TABLE IF NOT EXISTS rdns_cache (
  ip TEXT PRIMARY KEY,
  host TEXT,
  resolved_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- honeypot_hits: forward and retro bot flags keyed on (ip, ua) so one scanner
-- behind a NAT no longer hides an office (contract D26). Supersedes
-- honeypot_ips (0001), which stays for the legacy sweep and is never dropped.
CREATE TABLE IF NOT EXISTS honeypot_hits (
  ip TEXT NOT NULL,
  ua TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (ip, ua)
);

-- ---------------------------------------------------------------------------
-- replay_chunks_v2: rrweb chunk ledger keyed (sid, rid, seq). replay_chunks
-- (0001) is keyed (sid, seq): a reload or a second tab inside the 30-minute
-- sid window restarted seq at 0 and silently overwrote or interleaved the
-- earlier recording (audit A0). SQLite cannot change a primary key, so
-- recordings move here with a per-document-load recording id (rid) and the
-- page_started_at that orders segments in the player.
--   * replay_chunks is LEGACY: never dropped, never written again. Readers
--     (stitcher, prune, has_replay) use replay_chunks_v2 only.
--   * Its rows are copied below under rid = legacy (INSERT OR IGNORE keeps
--     the copy idempotent).
--   * R2 keys: rid = legacy rows keep the old layout replays/<sid>/<seq>
--     (.json or .json.gz); new rows use replays/<sid>/<rid>/<seq>.
--   * pending = 1 while the R2 object is being written: the accounting row is
--     inserted before bucket.put and flipped after (audit A21), so orphans are
--     visible to the prune sweep.
-- No FK to sessions: a chunk may legitimately land before the first envelope
-- and the prune step deletes children explicitly.
CREATE TABLE IF NOT EXISTS replay_chunks_v2 (
  sid TEXT NOT NULL,
  rid TEXT NOT NULL,
  seq INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  compressed INTEGER NOT NULL DEFAULT 1,
  pending INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  page_started_at INTEGER NOT NULL,
  PRIMARY KEY (sid, rid, seq)
);
-- (created_at): age-based prune and the orphan sweep.
CREATE INDEX IF NOT EXISTS idx_replay_chunks_v2_created ON replay_chunks_v2(created_at);
-- No (sid) index: the composite PRIMARY KEY autoindex leads with sid, so every
-- per-session lookup (cap check, stitcher, prune) is SEARCH ... (sid=?) already.
INSERT OR IGNORE INTO replay_chunks_v2 (sid, rid, seq, bytes, compressed, pending, created_at, page_started_at)
  SELECT sid, 'legacy', seq, bytes, compressed, 0, created_at, created_at FROM replay_chunks;

-- ---------------------------------------------------------------------------
-- login_attempts: durable /ops login throttle (audit A23). The in-memory
-- limiter is per-isolate, so its budget multiplied by the isolate count; this
-- row (one per client IP, IPv6 truncated by the caller) is the global one:
-- >= 10 failures per 15-minute window -> 429 until locked_until.
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- sessions / visitors indexes. The composite (vid, started_at) replaces
-- idx_sessions_vid (Visitors join + per-visitor timelines) — created first so
-- the FK child column is never left un-indexed.
CREATE INDEX IF NOT EXISTS idx_sessions_vid_started ON sessions(vid, started_at);
DROP INDEX IF EXISTS idx_sessions_vid;
-- (ip): honeypot retro-flag of the sessions already written by a flagged (ip, ua).
CREATE INDEX IF NOT EXISTS idx_sessions_ip ON sessions(ip);
-- (last_seen_at): Visitors sort/keyset and the visitor prune.
CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors(last_seen_at);
