// server/utils/collectSql.ts — the SQL behind /api/collect (contract C.5).
//
// PURE MODULE: no Nuxt/Nitro auto-imports, no runtime dependencies, so
// tests/unit/collectSql.test.ts can import it by relative path under
// `node --test` and prepare() every statement against a migrated :memory: DB.
//
// Every statement stays under D1's 100-bound-parameter cap; COLLECT_PARAM_COUNTS is
// the documented number per statement and the unit test asserts the SQL
// agrees with it. All placeholders are anonymous `?` — bind order is the
// column order written below (see BIND_ORDER in collect.post.ts).

/** Documented bound-parameter counts per statement (asserted by the unit test). */
export const COLLECT_PARAM_COUNTS = {
  visitors: 13,
  sessions: 70,
  session_net: 39,
  session_env: 62,
  page_visits: 19,
  page_perf: 38,
  /** 16 rows × 6 columns. */
  events_chunk: 96,
  precheck: 1,
  ip_cap: 2,
  honeypot_check: 3,
} as const

/** Rows per multi-row events INSERT (16 × 6 = 96 ≤ 100). */
export const EVENTS_ROWS_PER_STATEMENT = 16

/** Heartbeat granularity: each accepted heartbeat = 15 s of sessions.duration_ms. */
export const HEARTBEAT_MS = 15_000

// ---------------------------------------------------------------------------
// Pre-checks (before the batch)
// ---------------------------------------------------------------------------

/** 1 param: sid. */
export const PRECHECK_SQL = 'SELECT sid, events_n, last_seen_at, is_bot FROM sessions WHERE sid = ?'

/** 2 params: ip, since. New-sid cap per storage IP (plan delta A34; idx_sessions_ip). */
export const IP_CAP_SQL = 'SELECT COUNT(*) AS n FROM sessions WHERE ip = ? AND started_at >= ?'

/** 3 params: ip, ua, now. */
export const HONEYPOT_CHECK_SQL = 'SELECT 1 AS hit FROM honeypot_hits WHERE ip = ? AND ua = ? AND expires_at > ?'

// ---------------------------------------------------------------------------
// ① visitors — 13 params
// (vid, first_seen_at, last_seen_at, first_referrer, first_utm_source,
//  first_utm_medium, first_utm_campaign, first_as_org, first_country,
//  first_entry_path, last_as_org, last_country, sid-for-EXISTS)
// Runs only when the pre-check found no sessions row. The EXISTS is evaluated
// inside the batch so a beacon+fetch race can never double-count a visit (B9).
// ---------------------------------------------------------------------------

export const VISITORS_SQL = `INSERT INTO visitors (vid, first_seen_at, last_seen_at, visit_count, first_referrer, first_utm_source, first_utm_medium, first_utm_campaign,
  first_as_org, first_country, first_entry_path, last_as_org, last_country)
VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(vid) DO UPDATE SET
  last_seen_at = MAX(visitors.last_seen_at, excluded.last_seen_at),
  visit_count = visitors.visit_count + (CASE WHEN EXISTS (SELECT 1 FROM sessions WHERE sid = ?) THEN 0 ELSE 1 END),
  last_as_org = COALESCE(excluded.last_as_org, visitors.last_as_org),
  last_country = COALESCE(excluded.last_country, visitors.last_country)`

// ---------------------------------------------------------------------------
// ② sessions Statement A — 70 params
// 33 existing + 10 hot + 2 vid subqueries + 25 counters. has_replay is the
// literal 0. Bind order = COLLECT_SESSION_COLUMNS below.
// Insert-only: identity, is_returning / visit_n (from the visitors row ①
// wrote in this batch — prune-safe because visit_count is an increment).
// On conflict (audit A16 / A22): started_at = MIN, attribution / device / geo
// = first non-null (COALESCE(sessions.col, excluded.col)), counters += ,
// MAX for flags and max_scroll_pct, last_seen_at = MAX, exit_path / last_path
// only from the envelope that carries the newest last_seen_at.
// ---------------------------------------------------------------------------

export const COLLECT_SESSION_COLUMNS = [
  // 33 existing
  'sid', 'vid', 'started_at', 'last_seen_at', 'duration_ms', 'ip', 'ua',
  'browser', 'browser_ver', 'os', 'device_type',
  'screen_w', 'screen_h', 'viewport_w', 'viewport_h', 'dpr', 'lang', 'tz',
  'country', 'region', 'city', 'lat', 'lon',
  'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'entry_path', 'pageviews', 'max_scroll_pct', 'is_bot',
  // 10 hot
  'exit_path', 'last_path', 'nav_kind', 'asn', 'as_org', 'is_webdriver', 'gpc', 'dnt', 'save_data', 'is_tor',
  // 2 vid subqueries (bind vid twice)
  'is_returning:vid', 'visit_n:vid',
  // 25 counters
  'prints', 'copies', 'email_copies', 'selects', 'form_started', 'form_submitted', 'finds', 'searches',
  'exit_intents', 'rage_clicks', 'dead_clicks', 'right_clicks', 'errors', 'outbounds', 'mailto_clicks',
  'hovers', 'eggs', 'subtabs', 'hidden_ms', 'blurs', 'ptr_n', 'touch_n', 'key_n', 'first_interaction_ms', 'events_n',
] as const

const SESSION_COUNTERS = [
  'pageviews', 'duration_ms',
  'prints', 'copies', 'email_copies', 'selects', 'form_started', 'form_submitted', 'finds', 'searches',
  'exit_intents', 'rage_clicks', 'dead_clicks', 'right_clicks', 'errors', 'outbounds', 'mailto_clicks',
  'hovers', 'eggs', 'subtabs', 'hidden_ms', 'blurs', 'ptr_n', 'touch_n', 'key_n', 'events_n',
] as const

// os / device_type are NOT here: they are first-write with an iPadOS override
// (see SESSION_UA_UPGRADE below).
const SESSION_FIRST_NON_NULL = [
  'ip', 'ua', 'browser', 'browser_ver',
  'screen_w', 'screen_h', 'viewport_w', 'viewport_h', 'dpr', 'lang', 'tz',
  'country', 'region', 'city', 'lat', 'lon',
  'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'entry_path', 'nav_kind', 'asn', 'as_org', 'first_interaction_ms',
] as const

const SESSION_MAX_FLAGS = ['max_scroll_pct', 'is_bot', 'is_webdriver', 'gpc', 'dnt', 'save_data', 'is_tor'] as const

/**
 * os / device_type: first non-null, EXCEPT the iPadOS upgrade (audit R2-M2).
 * An iPad reports a desktop-Safari UA; only `maxTouchPoints` from the `env`
 * event tells it apart, and `env` rides whichever envelope the probe finished
 * on — usually not the first. Plain first-write would therefore keep 'macOS' /
 * 'desktop' forever, so a later envelope that resolves to iPadOS / tablet
 * wins. No extra bound parameters: the CASE reads `excluded`.
 */
const SESSION_UA_UPGRADE = [
  `  os = CASE WHEN excluded.os = 'iPadOS' THEN 'iPadOS' ELSE COALESCE(sessions.os, excluded.os) END`,
  `  device_type = CASE WHEN excluded.device_type = 'tablet' THEN 'tablet' ELSE COALESCE(sessions.device_type, excluded.device_type) END`,
].join(',\n')

export const SESSION_SQL = `INSERT INTO sessions (
  sid, vid, started_at, last_seen_at, duration_ms, ip, ua,
  browser, browser_ver, os, device_type,
  screen_w, screen_h, viewport_w, viewport_h, dpr, lang, tz,
  country, region, city, lat, lon,
  referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
  entry_path, pageviews, max_scroll_pct, is_bot, has_replay,
  exit_path, last_path, nav_kind, asn, as_org, is_webdriver, gpc, dnt, save_data, is_tor,
  is_returning, visit_n,
  prints, copies, email_copies, selects, form_started, form_submitted, finds, searches,
  exit_intents, rage_clicks, dead_clicks, right_clicks, errors, outbounds, mailto_clicks,
  hovers, eggs, subtabs, hidden_ms, blurs, ptr_n, touch_n, key_n, first_interaction_ms, events_n
) VALUES (
  ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, 0,
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
  CASE WHEN COALESCE((SELECT visit_count FROM visitors WHERE vid = ?), 1) > 1 THEN 1 ELSE 0 END,
  COALESCE((SELECT visit_count FROM visitors WHERE vid = ?), 1),
  ?, ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
)
ON CONFLICT(sid) DO UPDATE SET
  started_at = MIN(sessions.started_at, excluded.started_at),
  last_seen_at = MAX(sessions.last_seen_at, excluded.last_seen_at),
  exit_path = CASE WHEN excluded.last_seen_at >= sessions.last_seen_at THEN COALESCE(excluded.exit_path, sessions.exit_path) ELSE sessions.exit_path END,
  last_path = CASE WHEN excluded.last_seen_at >= sessions.last_seen_at THEN COALESCE(excluded.last_path, sessions.last_path) ELSE sessions.last_path END,
${SESSION_COUNTERS.map((c) => `  ${c} = sessions.${c} + excluded.${c}`).join(',\n')},
${SESSION_MAX_FLAGS.map((c) => `  ${c} = MAX(sessions.${c}, excluded.${c})`).join(',\n')},
${SESSION_UA_UPGRADE},
${SESSION_FIRST_NON_NULL.map((c) => `  ${c} = COALESCE(sessions.${c}, excluded.${c})`).join(',\n')}`

// ---------------------------------------------------------------------------
// ③ session_net Statement B — 39 params (= the 39 columns, in table order).
// cf / header columns are insert-only; the SSR handoff, the client tz offset
// and the rDNS host are first-write (COALESCE(session_net.col, excluded.col))
// because they can arrive on a later envelope or a later PTR answer.
// ---------------------------------------------------------------------------

export const SESSION_NET_COLUMNS = [
  'sid', 'created_at',
  'colo', 'http_protocol', 'tls_version', 'tls_cipher',
  'client_rtt_ms', 'rtt_kind', 'request_priority', 'accept_encoding',
  'tls_ciphers_sha1', 'tls_ext_sha1', 'tls_hello_len', 'cf_ray',
  'continent', 'region_code', 'postal_code', 'metro_code', 'cf_tz', 'is_eu',
  'bot_score', 'verified_bot', 'verified_bot_category', 'ja3_hash', 'ja4', 'client_trust_score',
  'accept_language', 'ch_ua', 'ch_mobile', 'ch_platform',
  'fetch_site', 'fetch_mode', 'fetch_dest', 'fetch_user', 'doc_referer', 'early_data',
  'client_tz_offset_min', 'cf_tz_offset_min',
  'rdns_host',
] as const

const NET_FIRST_WRITE = [
  'fetch_site', 'fetch_mode', 'fetch_dest', 'fetch_user', 'doc_referer', 'early_data',
  'client_tz_offset_min', 'cf_tz_offset_min', 'rdns_host',
] as const

export const SESSION_NET_SQL = `INSERT INTO session_net (${SESSION_NET_COLUMNS.join(', ')})
VALUES (${SESSION_NET_COLUMNS.map(() => '?').join(', ')})
ON CONFLICT(sid) DO UPDATE SET
${NET_FIRST_WRITE.map((c) => `  ${c} = COALESCE(session_net.${c}, excluded.${c})`).join(',\n')}`

// ---------------------------------------------------------------------------
// ④ session_env — 62 params (= the 62 columns, in table order).
// Latest non-null wins: COALESCE(excluded.col, session_env.col).
// ---------------------------------------------------------------------------

export const SESSION_ENV_COLUMNS = [
  'sid', 'created_at',
  'webdriver', 'ua_brands', 'ua_mobile', 'ua_platform',
  'ua_arch', 'ua_bitness', 'ua_model', 'ua_platform_ver', 'ua_full_versions', 'ua_form_factors', 'ua_wow64',
  'languages', 'max_touch_points', 'pdf_viewer', 'cookies_enabled', 'gpc_js', 'dnt_js',
  'gpu_vendor', 'gpu_renderer', 'webgpu_vendor', 'webgpu_arch', 'webgpu_device', 'webgpu_desc',
  'battery_level', 'battery_charging', 'storage_quota_mb', 'storage_usage_mb',
  'media_audioinput', 'media_videoinput', 'media_audiooutput',
  'color_scheme', 'reduced_motion', 'contrast', 'forced_colors', 'inverted_colors', 'reduced_transparency',
  'avail_w', 'avail_h', 'color_depth', 'orientation',
  'js_heap_limit_mb', 'js_heap_used_mb',
  'net_type', 'net_effective', 'net_downlink', 'net_rtt', 'net_save_data',
  'voices', 'tz_name', 'tz_offset_min', 'intl_locale', 'display_mode',
  'outer_w', 'outer_h', 'inner_w', 'inner_h',
  'device_memory', 'cores', 'platform', 'touch',
] as const

export const SESSION_ENV_SQL = `INSERT INTO session_env (${SESSION_ENV_COLUMNS.join(', ')})
VALUES (${SESSION_ENV_COLUMNS.map(() => '?').join(', ')})
ON CONFLICT(sid) DO UPDATE SET
${SESSION_ENV_COLUMNS.slice(2)
  .map((c) => `  ${c} = COALESCE(excluded.${c}, session_env.${c})`)
  .join(',\n')}`

// ---------------------------------------------------------------------------
// ⑤ page_visits — 19 params, order-independent upsert (contract C.5 ⑤).
// MAX(NULL, x) is NULL in SQLite — nullable columns are COALESCEd first.
// The NOT NULL DEFAULT 0 counters must be bound as 0, never null.
// ---------------------------------------------------------------------------

export const PAGE_VISIT_COLUMNS = [
  'pvid', 'sid', 'path', 'entered_at', 'left_at', 'from_path', 'nav_kind', 'soft_nav_ms',
  'active_ms', 'hidden_ms', 'max_scroll_pct', 'scroll_px', 'scroll_reversals', 'max_scroll_vel',
  'sections_seen', 'clicks', 'text_len', 'console_errors', 'leave_reason',
] as const

export const PAGE_VISITS_SQL = `INSERT INTO page_visits (${PAGE_VISIT_COLUMNS.join(', ')})
VALUES (${PAGE_VISIT_COLUMNS.map(() => '?').join(', ')})
ON CONFLICT(pvid) DO UPDATE SET
  entered_at = MIN(page_visits.entered_at, excluded.entered_at),
  left_at = NULLIF(MAX(COALESCE(page_visits.left_at, 0), COALESCE(excluded.left_at, 0)), 0),
  leave_reason = CASE WHEN COALESCE(excluded.left_at, 0) >= COALESCE(page_visits.left_at, 0)
                      THEN COALESCE(excluded.leave_reason, page_visits.leave_reason) ELSE page_visits.leave_reason END,
  from_path = COALESCE(page_visits.from_path, excluded.from_path),
  nav_kind = COALESCE(page_visits.nav_kind, excluded.nav_kind),
  soft_nav_ms = COALESCE(page_visits.soft_nav_ms, excluded.soft_nav_ms),
  text_len = COALESCE(page_visits.text_len, excluded.text_len),
  active_ms = MAX(page_visits.active_ms, excluded.active_ms),
  hidden_ms = MAX(page_visits.hidden_ms, excluded.hidden_ms),
  max_scroll_pct = MAX(page_visits.max_scroll_pct, excluded.max_scroll_pct),
  scroll_px = MAX(page_visits.scroll_px, excluded.scroll_px),
  scroll_reversals = MAX(page_visits.scroll_reversals, excluded.scroll_reversals),
  max_scroll_vel = MAX(COALESCE(page_visits.max_scroll_vel, 0), COALESCE(excluded.max_scroll_vel, 0)),
  sections_seen = MAX(page_visits.sections_seen, excluded.sections_seen),
  clicks = MAX(page_visits.clicks, excluded.clicks),
  console_errors = MAX(page_visits.console_errors, excluded.console_errors)`

// ---------------------------------------------------------------------------
// ⑥ page_perf — 38 params, first-write per column (COALESCE(page_perf.col, excluded.col)).
// ---------------------------------------------------------------------------

export const PAGE_PERF_COLUMNS = [
  'pvid', 'sid', 'ts', 'path',
  'ttfb_ms', 'fcp_ms', 'lcp_ms', 'lcp_sel', 'lcp_size', 'cls', 'inp_ms',
  'dns_ms', 'connect_ms', 'tls_ms', 'request_ms', 'response_ms',
  'dom_interactive_ms', 'dcl_ms', 'load_ms',
  'transfer_bytes', 'encoded_bytes', 'decoded_bytes', 'redirects', 'protocol', 'nav_type',
  'res_count', 'res_bytes', 'res_cached', 'res_by_type', 'res_slowest',
  'long_tasks', 'long_task_ms', 'long_task_max_ms',
  'loaf_count', 'loaf_ms', 'loaf_max_ms', 'loaf_script',
  'soft_nav_ms',
] as const

export const PAGE_PERF_SQL = `INSERT INTO page_perf (${PAGE_PERF_COLUMNS.join(', ')})
VALUES (${PAGE_PERF_COLUMNS.map(() => '?').join(', ')})
ON CONFLICT(pvid) DO UPDATE SET
${PAGE_PERF_COLUMNS.slice(2)
  .map((c) => `  ${c} = COALESCE(page_perf.${c}, excluded.${c})`)
  .join(',\n')}`

// ---------------------------------------------------------------------------
// ⑦ events — n rows × 6 params (sid, ts, type, name, payload, path); n ≤ 16.
// ---------------------------------------------------------------------------

export const EVENT_COLUMNS = ['sid', 'ts', 'type', 'name', 'payload', 'path'] as const

/** Multi-row INSERT for `n` event rows (1 ≤ n ≤ EVENTS_ROWS_PER_STATEMENT). */
export function eventsSql(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > EVENTS_ROWS_PER_STATEMENT) {
    throw new RangeError(`eventsSql: n must be 1..${EVENTS_ROWS_PER_STATEMENT}, got ${n}`)
  }
  const row = `(${EVENT_COLUMNS.map(() => '?').join(', ')})`
  return `INSERT INTO events (${EVENT_COLUMNS.join(', ')}) VALUES ${Array.from({ length: n }, () => row).join(', ')}`
}

/** Every fixed statement with its documented parameter count (for the unit test). */
export const COLLECT_STATEMENTS: ReadonlyArray<{ name: keyof typeof COLLECT_PARAM_COUNTS; sql: string }> = [
  { name: 'visitors', sql: VISITORS_SQL },
  { name: 'sessions', sql: SESSION_SQL },
  { name: 'session_net', sql: SESSION_NET_SQL },
  { name: 'session_env', sql: SESSION_ENV_SQL },
  { name: 'page_visits', sql: PAGE_VISITS_SQL },
  { name: 'page_perf', sql: PAGE_PERF_SQL },
  { name: 'events_chunk', sql: eventsSql(EVENTS_ROWS_PER_STATEMENT) },
  { name: 'precheck', sql: PRECHECK_SQL },
  { name: 'ip_cap', sql: IP_CAP_SQL },
  { name: 'honeypot_check', sql: HONEYPOT_CHECK_SQL },
]
