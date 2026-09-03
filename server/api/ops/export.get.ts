import type { ExportEntity, ExportFormat } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { toCsv, toNdjson } from '../../utils/csv'
import { getDb } from '../../utils/db'
import type { Row } from '../../utils/opsDb'
import { toNum } from '../../utils/opsDb'
import type { WhereParts } from '../../utils/opsFilters'
import { SESSION_COLUMNS, buildWhere, intParam, parseOpsQuery, parseWindow, splitCursor } from '../../utils/opsFilters'

const PAGE_MAX = 1000
const SESSION_FULL = [...SESSION_COLUMNS, 'ip', 'ua', 'screen_w', 'screen_h', 'viewport_w', 'viewport_h', 'dpr', 'lang', 'tz', 'lat', 'lon', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'dnt', 'save_data', 'selects', 'right_clicks', 'hovers', 'subtabs', 'hidden_ms', 'blurs', 'ptr_n', 'touch_n', 'key_n', 'first_interaction_ms']

/** Column order for an empty page (the header line must still be emitted). */
const COLUMNS: Record<ExportEntity, readonly string[]> = {
  sessions: SESSION_FULL,
  visitors: ['vid', 'first_seen_at', 'last_seen_at', 'visit_count', 'first_referrer', 'first_utm_source', 'first_utm_medium', 'first_utm_campaign', 'first_as_org', 'first_country', 'first_entry_path', 'last_as_org', 'last_country'],
  page_visits: ['pvid', 'sid', 'path', 'entered_at', 'left_at', 'from_path', 'nav_kind', 'soft_nav_ms', 'active_ms', 'hidden_ms', 'max_scroll_pct', 'scroll_px', 'scroll_reversals', 'max_scroll_vel', 'sections_seen', 'clicks', 'text_len', 'console_errors', 'leave_reason'],
  page_perf: ['pvid', 'sid', 'ts', 'path', 'ttfb_ms', 'fcp_ms', 'lcp_ms', 'lcp_sel', 'lcp_size', 'cls', 'inp_ms', 'dns_ms', 'connect_ms', 'tls_ms', 'request_ms', 'response_ms', 'dom_interactive_ms', 'dcl_ms', 'load_ms', 'transfer_bytes', 'encoded_bytes', 'decoded_bytes', 'redirects', 'protocol', 'nav_type', 'res_count', 'res_bytes', 'res_cached', 'res_by_type', 'res_slowest', 'long_tasks', 'long_task_ms', 'long_task_max_ms', 'loaf_count', 'loaf_ms', 'loaf_max_ms', 'loaf_script', 'soft_nav_ms'],
  events: ['id', 'sid', 'ts', 'type', 'name', 'path', 'payload'],
}

interface Page {
  sql: string
  args: unknown[]
  /** Build the next cursor from the last row of a full page. */
  cursor: (last: Row) => string
}

/**
 * Keyset page per entity: sessions (started_at, sid), visitors
 * (last_seen_at, vid), page_visits (entered_at, pvid), page_perf (ts, pvid),
 * events (ts, id) — the events page walks the TIME axis, not the rowid, so
 * the range predicate is the leading one (R4-M6; wants idx_events_ts(ts, id)).
 */
function pageFor(entity: ExportEntity, where: WhereParts, after: string | undefined, limit: number, tsStart: number, tsEnd: number): Page {
  const c = splitCursor(after)
  const lim = limit + 1
  switch (entity) {
    case 'sessions': {
      const ks = c ? ' AND (s.started_at > ? OR (s.started_at = ? AND s.sid > ?))' : ''
      return {
        sql: `SELECT ${SESSION_FULL.map((x) => `s.${x}`).join(', ')} FROM sessions s WHERE ${where.sql}${ks} ORDER BY s.started_at, s.sid LIMIT ?`,
        args: [...where.args, ...(c ? [c.n, c.n, c.id] : []), lim],
        cursor: (r) => `${toNum(r.started_at)}:${String(r.sid)}`,
      }
    }
    case 'visitors': {
      const ks = c ? ' AND (v.last_seen_at > ? OR (v.last_seen_at = ? AND v.vid > ?))' : ''
      return {
        sql: `SELECT v.* FROM visitors v WHERE EXISTS (SELECT 1 FROM sessions s WHERE s.vid = v.vid AND ${where.sql})${ks} ORDER BY v.last_seen_at, v.vid LIMIT ?`,
        args: [...where.args, ...(c ? [c.n, c.n, c.id] : []), lim],
        cursor: (r) => `${toNum(r.last_seen_at)}:${String(r.vid)}`,
      }
    }
    case 'page_visits': {
      const ks = c ? ' AND (pv.entered_at > ? OR (pv.entered_at = ? AND pv.pvid > ?))' : ''
      return {
        sql: `SELECT pv.* FROM page_visits pv WHERE pv.entered_at >= ? AND pv.entered_at < ? AND EXISTS (SELECT 1 FROM sessions s WHERE s.sid = pv.sid AND ${where.sql})${ks} ORDER BY pv.entered_at, pv.pvid LIMIT ?`,
        args: [tsStart, tsEnd, ...where.args, ...(c ? [c.n, c.n, c.id] : []), lim],
        cursor: (r) => `${toNum(r.entered_at)}:${String(r.pvid)}`,
      }
    }
    case 'page_perf': {
      const ks = c ? ' AND (p.ts > ? OR (p.ts = ? AND p.pvid > ?))' : ''
      return {
        sql: `SELECT p.* FROM page_perf p WHERE p.ts >= ? AND p.ts < ? AND EXISTS (SELECT 1 FROM sessions s WHERE s.sid = p.sid AND ${where.sql})${ks} ORDER BY p.ts, p.pvid LIMIT ?`,
        args: [tsStart, tsEnd, ...where.args, ...(c ? [c.n, c.n, c.id] : []), lim],
        cursor: (r) => `${toNum(r.ts)}:${String(r.pvid)}`,
      }
    }
    case 'events':
    default: {
      const ks = c ? ' AND (e.ts > ? OR (e.ts = ? AND e.id > ?))' : ''
      return {
        sql: `SELECT e.id, e.sid, e.ts, e.type, e.name, e.path, e.payload FROM events e WHERE e.ts >= ? AND e.ts < ?${ks} AND EXISTS (SELECT 1 FROM sessions s WHERE s.sid = e.sid AND ${where.sql}) ORDER BY e.ts, e.id LIMIT ?`,
        args: [tsStart, tsEnd, ...(c ? [c.n, c.n, c.id] : []), ...where.args, lim],
        cursor: (r) => `${toNum(r.ts)}:${toNum(r.id)}`,
      }
    }
  }
}

/**
 * GET /api/ops/export?entity=sessions|visitors|page_visits|page_perf|events&format=csv|ndjson&after=<cursor>&limit=<≤1000>
 * + the usual filters — one buffered page of ≤ 1 000 rows (contract D15). Headers
 * set before the body: `x-rb-next: <cursor>` while more remain, `x-rb-rows: n`,
 * Content-Disposition. The CSV header line is emitted on the first page only
 * (no `after`), so the client just concatenates pages. Uncached.
 */
export default defineEventHandler(async (event): Promise<string> => {
  await requireAdmin(event)
  const q = parseOpsQuery(getQuery(event) as Record<string, unknown>)
  const entity: ExportEntity = q.entity ?? 'sessions'
  const format: ExportFormat = q.format ?? 'csv'
  const limit = intParam(q.limit, PAGE_MAX, 1, PAGE_MAX)
  const w = parseWindow(q)
  const where = buildWhere(q, w)
  // events / page rows carry client or server timestamps near the session window — widen by an hour
  const tsStart = Math.max(0, w.start - 3_600_000)
  const tsEnd = w.end + 3_600_000
  const page = pageFor(entity, where, q.after, limit, tsStart, tsEnd)

  const { results } = await getDb(event).prepare(page.sql).bind(...page.args).all<Row>()
  const rows = results.slice(0, limit)
  const last = rows[rows.length - 1]
  const more = results.length > limit && last !== undefined

  const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
  const ext = format === 'ndjson' ? 'ndjson' : 'csv'
  setHeader(event, 'Content-Type', format === 'ndjson' ? 'application/x-ndjson; charset=utf-8' : 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="rb-${entity}-${stamp(w.start)}-${stamp(w.end)}.${ext}"`)
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'x-rb-rows', String(rows.length))
  setHeader(event, 'x-rb-entity', entity)
  if (more && last) setHeader(event, 'x-rb-next', page.cursor(last))
  setHeader(event, 'Access-Control-Expose-Headers', 'x-rb-next, x-rb-rows, x-rb-entity')

  if (format === 'ndjson') return toNdjson(rows)
  const columns = rows[0] ? Object.keys(rows[0]) : COLUMNS[entity]
  return toCsv(columns, rows, q.after === undefined)
})
