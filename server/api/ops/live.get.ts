import type { Live, LiveSession } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import type { Row } from '../../utils/opsDb'
import { batchAll, bindStmt, toNum, toStr } from '../../utils/opsDb'
import { intentFlagsOf, parseOpsQuery, sessionProjection } from '../../utils/opsFilters'
import { TZ_HOUR_MS } from '../../utils/opsTz'

const LOOKBACK_MS = 6 * TZ_HOUR_MS
const STRIP_MS = 5 * 60_000
const ACTIVE_MS = 60_000

function toLive(r: Row): LiveSession {
  return {
    sid: String(r.sid),
    startedAt: toNum(r.started_at),
    lastSeenAt: toNum(r.last_seen_at),
    path: toStr(r.last_path) ?? toStr(r.exit_path) ?? toStr(r.entry_path),
    country: toStr(r.country),
    city: toStr(r.city),
    asOrg: toStr(r.as_org),
    deviceType: toStr(r.device_type),
    browser: toStr(r.browser),
    pageviews: toNum(r.pageviews),
    activeMs: toNum(r.active_ms),
    hasReplay: toNum(r.has_replay) === 1,
    isBot: toNum(r.is_bot) === 1,
    intent: intentFlagsOf(r),
  }
}

/**
 * GET /api/ops/live?bots=1 — ACTIVE NOW (input in the last 60 s) + the last
 * 5 minutes (≤ 50, newest first). Uncached; scans started_at > now − 6 h
 * (contract D10 / D29: no last_seen_at index), so sessions longer than 6 h
 * drop out of the strip.
 */
export default defineEventHandler(async (event): Promise<Live> => {
  await requireAdmin(event)
  const q = parseOpsQuery(getQuery(event) as Record<string, unknown>)
  const db = getDb(event)
  const now = Date.now()
  const bots = q.bots === '1' ? '' : 'AND s.is_bot = 0'
  const res = await batchAll(db, [
    bindStmt(
      db,
      `SELECT ${sessionProjection('s')} FROM sessions s WHERE s.started_at > ? AND s.last_seen_at > ? ${bots} ORDER BY s.last_seen_at DESC LIMIT 50`,
      [now - LOOKBACK_MS, now - STRIP_MS],
    ),
    bindStmt(db, `SELECT COUNT(*) AS n FROM sessions s WHERE s.started_at > ? AND s.last_seen_at > ? ${bots}`, [
      now - LOOKBACK_MS,
      now - ACTIVE_MS,
    ]),
  ])
  return {
    activeNow: toNum(res[1]?.[0]?.n),
    sessions: (res[0] ?? []).map(toLive),
    now,
  }
})
