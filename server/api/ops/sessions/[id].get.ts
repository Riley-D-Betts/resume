import { EVENT_TYPES } from '../../../../shared/analytics/events'
import type { BotReason, EventRow, PagePerfRow, PageVisitRow, SessionDetail, SessionEnvRow, SessionFull, SessionNetRow } from '../../../../shared/analytics/ops'
import { requireAdmin } from '../../../utils/auth'
import { isBotUA } from '../../../utils/bots'
import { getDb } from '../../../utils/db'
import { batchAll, bindStmt, toNum, toStr } from '../../../utils/opsDb'
import { activeSql, intParam, intentFlagsOf } from '../../../utils/opsFilters'

const ID_RE = /^[0-9a-fA-F-]{16,64}$/
const ALL_TYPES = new Set<string>(EVENT_TYPES)

/** Comma list of event types → SQL `AND e.type IN (…)` (validated against EVENT_TYPES) or ''. */
function typesClause(types: string | undefined): { sql: string; args: string[] } {
  if (!types) return { sql: '', args: [] }
  const list = [...new Set(types.split(',').map((t) => t.trim()).filter((t) => ALL_TYPES.has(t)))].slice(0, 31)
  if (list.length === 0) return { sql: '', args: [] }
  return { sql: ` AND e.type IN (${list.map(() => '?').join(', ')})`, args: list }
}

/**
 * GET /api/ops/sessions/:id?after=<event id>&limit=<≤500, default 500>&types=a,b —
 * the full session row + session_net + session_env, the visitor summary,
 * page visits, page_perf rows, the first events page (keyset `id > ?`,
 * ORDER BY id — the UI sorts by (ts, id)), `nextAfter`, and derived facts:
 * TZ mismatch, bot reason (+ the UA when honeypot), intent flags, Σ active.
 * `limit` is capped at 500 — LOAD MORE walks the rest through
 * `/api/ops/sessions/:id/events`.
 * Uncached.
 */
export default defineEventHandler(async (event): Promise<SessionDetail> => {
  await requireAdmin(event)
  const sid = getRouterParam(event, 'id') ?? ''
  if (!ID_RE.test(sid)) throw createError({ statusCode: 400, statusMessage: 'bad session id' })
  const raw = getQuery(event) as Record<string, unknown>
  const after = intParam(raw.after, 0, 0, Number.MAX_SAFE_INTEGER)
  // 500 events is the whole first page; the rest arrive through
  // /sessions/:id/events with the keyset cursor (R4-M10).
  const limit = intParam(raw.limit, 500, 1, 500)
  const types = typesClause(typeof raw.types === 'string' ? raw.types : undefined)
  const db = getDb(event)

  const res = await batchAll(db, [
    /* 0 */ bindStmt(db, `SELECT s.*, ${activeSql('s')} AS active_ms FROM sessions s WHERE s.sid = ?`, [sid]),
    /* 1 */ bindStmt(db, 'SELECT * FROM session_net WHERE sid = ?', [sid]),
    /* 2 */ bindStmt(db, 'SELECT * FROM session_env WHERE sid = ?', [sid]),
    /* 3 */ bindStmt(
      db,
      'SELECT v.visit_count, v.first_seen_at, v.last_seen_at, (SELECT COUNT(*) FROM sessions x WHERE x.vid = v.vid) - 1 AS otherSessions '
        + 'FROM visitors v WHERE v.vid = (SELECT vid FROM sessions WHERE sid = ?)',
      [sid],
    ),
    /* 4 */ bindStmt(db, 'SELECT * FROM page_visits WHERE sid = ? ORDER BY entered_at LIMIT 200', [sid]),
    /* 5 */ bindStmt(db, 'SELECT * FROM page_perf WHERE sid = ? ORDER BY ts LIMIT 50', [sid]),
    /* 6 */ bindStmt(
      db,
      `SELECT e.id, e.ts, e.type, e.name, e.path, e.payload FROM events e WHERE e.sid = ? AND e.id > ?${types.sql} ORDER BY e.id LIMIT ?`,
      [sid, after, ...types.args, limit + 1],
    ),
    /* 7 */ bindStmt(
      db,
      'SELECT EXISTS (SELECT 1 FROM honeypot_hits h WHERE h.ip = s.ip AND h.ua = s.ua) AS hit, '
        + 'EXISTS (SELECT 1 FROM honeypot_ips h WHERE h.ip = s.ip) AS legacyHit FROM sessions s WHERE s.sid = ?',
      [sid],
    ),
  ])
  const sessionRow = res[0]?.[0]
  if (!sessionRow) throw createError({ statusCode: 404, statusMessage: 'unknown session' })

  const net = (res[1]?.[0] as unknown as SessionNetRow | undefined) ?? null
  const env = (res[2]?.[0] as unknown as SessionEnvRow | undefined) ?? null
  const session = { ...(sessionRow as unknown as SessionFull), net, env }
  const visitorRow = res[3]?.[0]
  const eventsAll = (res[6] ?? []) as unknown as EventRow[]
  const events = eventsAll.slice(0, limit)
  const lastEvent = events[events.length - 1]
  const nextAfter = eventsAll.length > limit && lastEvent ? lastEvent.id : null
  const hp = res[7]?.[0] ?? {}
  const honeypotHit = toNum(hp.hit) === 1 || toNum(hp.legacyHit) === 1

  const ua = toStr(sessionRow.ua)
  let botReason: BotReason = null
  // HONEYPOT only when a honeypot row actually matched; a bare is_bot flag
  // (set at ingest for some other signal) is FLAGGED (R4-L13).
  if (isBotUA(ua)) botReason = 'ua'
  else if (net?.verified_bot === 1) botReason = 'verified'
  else if (honeypotHit) botReason = 'honeypot'
  else if (toNum(sessionRow.is_bot) === 1) botReason = 'flagged'

  const tzMismatch =
    net !== null
    && net.client_tz_offset_min !== null
    && net.cf_tz_offset_min !== null
    && net.client_tz_offset_min !== net.cf_tz_offset_min

  return {
    session,
    visitor: visitorRow
      ? {
          visitCount: toNum(visitorRow.visit_count),
          firstSeen: toNum(visitorRow.first_seen_at),
          lastSeen: toNum(visitorRow.last_seen_at),
          otherSessions: Math.max(0, toNum(visitorRow.otherSessions)),
        }
      : null,
    pages: (res[4] ?? []) as unknown as PageVisitRow[],
    perf: (res[5] ?? []) as unknown as PagePerfRow[],
    events,
    nextAfter,
    derived: {
      tzMismatch,
      botReason,
      honeypotUa: botReason === 'honeypot' ? ua : null,
      intentFlags: intentFlagsOf(sessionRow),
      activeMs: toNum(sessionRow.active_ms),
    },
  }
})
