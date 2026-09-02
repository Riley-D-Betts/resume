// shared/analytics/cookbook.ts — SQL console presets (contract E.4). Every
// preset is a read-only SELECT / WITH that passes sqlGuard; none touches the
// TLS fingerprint columns (ja3 / ja4 / sha1 — automation signals only, never
// grouped, per contract §I; tests/unit/cookbook.test.ts pins both).
// `${tzOffsetMin}` in a preset is substituted by `renderCookbookSql`.
//
// PURE MODULE: no Nuxt auto-imports.

import type { CookbookEntry } from './ops.ts'

export const COOKBOOK: readonly CookbookEntry[] = [
  {
    title: 'Orgs that came back',
    sql:
      "SELECT COALESCE(NULLIF(as_org, ''), '(unknown)') AS org, COUNT(DISTINCT vid) AS visitors, COUNT(*) AS sessions,\n"
      + '       SUM(is_returning) AS returning_sessions, MAX(last_seen_at) AS last_seen\n'
      + 'FROM sessions\n'
      + 'WHERE is_bot = 0\n'
      + 'GROUP BY org\n'
      + 'HAVING SUM(is_returning) > 0\n'
      + 'ORDER BY last_seen DESC',
    note: 'Organisations with at least one returning session in the whole table.',
  },
  {
    title: 'Who copied my email',
    sql:
      "SELECT e.ts, e.sid, s.as_org, s.country, s.city, COALESCE(e.path, s.entry_path) AS path, json_extract(e.payload, '$.snippet') AS snippet\n"
      + 'FROM events e JOIN sessions s ON s.sid = e.sid\n'
      + "WHERE e.type = 'copy' AND json_extract(e.payload, '$.hasEmail') = 1\n"
      + 'ORDER BY e.ts DESC',
  },
  {
    title: 'Mailto clicks by org',
    sql:
      "SELECT COALESCE(NULLIF(as_org, ''), '(unknown)') AS org, SUM(mailto_clicks) AS mailto_clicks, SUM(form_submitted) AS mail_handoffs, COUNT(*) AS sessions\n"
      + 'FROM sessions\n'
      + 'WHERE is_bot = 0 AND (mailto_clicks > 0 OR form_submitted > 0)\n'
      + 'GROUP BY org\n'
      + 'ORDER BY mailto_clicks DESC, mail_handoffs DESC',
    note: 'A mail handoff is the contact form composing a mailto: — the site counts the handoff, never delivery.',
  },
  {
    title: 'Form abandoners by subject',
    sql:
      "SELECT COALESCE(json_extract(e.payload, '$.subject'), '(none)') AS subject, COUNT(DISTINCT s.sid) AS abandoned_sessions\n"
      + "FROM sessions s JOIN events e ON e.sid = s.sid AND e.type = 'form'\n"
      + 'WHERE s.form_started > 0 AND s.form_submitted = 0 AND s.is_bot = 0\n'
      + 'GROUP BY subject\n'
      + 'ORDER BY abandoned_sessions DESC',
  },
  {
    title: 'p75 LCP by device',
    sql:
      "WITH u AS (SELECT COALESCE(s.device_type, '?') AS key, p.lcp_ms AS v\n"
      + '           FROM page_perf p JOIN sessions s ON s.sid = p.sid\n'
      + '           WHERE p.lcp_ms IS NOT NULL AND s.is_bot = 0)\n'
      + 'SELECT key AS device, v AS p75_lcp_ms, n AS loads\n'
      + 'FROM (SELECT key, v, ROW_NUMBER() OVER (PARTITION BY key ORDER BY v) AS rn, COUNT(*) OVER (PARTITION BY key) AS n FROM u)\n'
      + 'WHERE rn = (n * 75 + 99) / 100\n'
      + 'ORDER BY loads DESC',
    note: 'Rank = ceil(n x 0.75) in integer math — the same window-function percentile the Performance view uses.',
  },
  {
    title: 'Top path flows',
    sql:
      "SELECT COALESCE(from_path, '(entry)') AS from_path, path AS to_path, COUNT(*) AS n\n"
      + 'FROM page_visits\n'
      + 'GROUP BY 1, 2\n'
      + 'ORDER BY n DESC',
  },
  {
    title: 'Sessions per hour (UTC)',
    sql:
      "SELECT strftime('%Y-%m-%d %H:00', datetime(started_at / 1000, 'unixepoch', '${tzOffsetMin} minutes')) AS hour, COUNT(*) AS sessions\n"
      + 'FROM sessions\n'
      + "WHERE is_bot = 0 AND started_at > (strftime('%s', 'now') - 7 * 86400) * 1000\n"
      + 'GROUP BY hour\n'
      + 'ORDER BY hour DESC',
    note: "${tzOffsetMin} is replaced with your browser's UTC offset in minutes, so the hours read in your zone (0 keeps UTC).",
  },
  {
    title: 'TZ offset mismatch',
    sql:
      'SELECT s.sid, s.started_at, s.country, s.city, s.tz AS client_tz, n.cf_tz, n.client_tz_offset_min, n.cf_tz_offset_min, s.as_org\n'
      + 'FROM sessions s JOIN session_net n ON n.sid = s.sid\n'
      + 'WHERE n.client_tz_offset_min IS NOT NULL AND n.cf_tz_offset_min IS NOT NULL AND n.client_tz_offset_min <> n.cf_tz_offset_min\n'
      + 'ORDER BY s.started_at DESC',
    note: 'Browser clock zone differs from the zone of the connecting IP — a VPN, a traveller, or a headless browser with a fixed clock.',
  },
  {
    title: 'Errors by browser',
    sql:
      "SELECT s.browser, e.type, COALESCE(json_extract(e.payload, '$.msg'), json_extract(e.payload, '$.src')) AS message, COUNT(*) AS n, COUNT(DISTINCT e.sid) AS sessions\n"
      + 'FROM events e JOIN sessions s ON s.sid = e.sid\n'
      + "WHERE e.type IN ('js_error', 'resource_error', 'console_error')\n"
      + 'GROUP BY 1, 2, 3\n'
      + 'ORDER BY n DESC',
  },
  {
    title: 'What did org X read',
    sql:
      'SELECT pv.path, COUNT(*) AS visits, COUNT(DISTINCT pv.sid) AS sessions, SUM(pv.active_ms) / 1000 AS active_s, CAST(AVG(pv.max_scroll_pct) AS INTEGER) AS avg_scroll_pct\n'
      + 'FROM page_visits pv JOIN sessions s ON s.sid = pv.sid\n'
      + "WHERE s.as_org LIKE '%X%'\n"
      + 'GROUP BY pv.path\n'
      + 'ORDER BY visits DESC',
    note: 'Replace X with (part of) the organisation name. LIKE patterns are capped at 50 bytes by D1.',
  },
]

/** Substitute `${tzOffsetMin}` (minutes east of UTC, clamped to +/-900, integer). */
export function renderCookbookSql(sql: string, tzOffsetMin: number): string {
  const n = Number.isFinite(tzOffsetMin) ? Math.max(-900, Math.min(900, Math.trunc(tzOffsetMin))) : 0
  return sql.replaceAll('${tzOffsetMin}', String(n))
}
