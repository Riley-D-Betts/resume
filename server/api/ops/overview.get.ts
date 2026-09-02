import type { H3Event } from 'h3'
import type { EventRow, HeatCell, KN, OpsQuery, Overview, RecentSession, SeriesPoint } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { OPS_CACHE_TTL_MS, opsCached } from '../../utils/opsCache'
import type { Row } from '../../utils/opsDb'
import { batchAll, bindStmt, toNum, toStr } from '../../utils/opsDb'
import type { WhereParts } from '../../utils/opsFilters'
import {
  buildWhere,
  foldStats,
  intentFlagsOf,
  parseOpsQuery,
  parseWindow,
  prevWindow,
  referrerHostSql,
  sessionProjection,
  statsSql,
} from '../../utils/opsFilters'
import type { SqlFragment } from '../../utils/opsTz'
import { TZ_DAY_MS, TZ_HOUR_MS, dayIdxToYmd, dayStart, daySql, dowSql, hourSql, listDays, localMsSql, tzSegments } from '../../utils/opsTz'
import { orgKind } from '../../utils/orgKind'

/** The day series is bounded to the last year even for range=all (≤ 366 rows). */
const SERIES_MAX_MS = 365 * TZ_DAY_MS
const ERROR_TYPES = "('js_error', 'resource_error', 'console_error')"

function kn(rows: Row[]): KN[] {
  return rows.map((r) => ({ k: toStr(r.k) ?? '(unknown)', n: toNum(r.n) }))
}

function seriesSql(where: WhereParts, local: SqlFragment): string {
  return (
    `SELECT ${daySql(local.sql)} AS d, COUNT(*) AS sessions, COALESCE(SUM(s.pageviews), 0) AS pageviews, COUNT(DISTINCT s.vid) AS visitors `
    + `FROM sessions s WHERE ${where.sql} GROUP BY d ORDER BY d`
  )
}

function seriesOf(rows: Row[], tz: string, start: number, end: number): SeriesPoint[] {
  const byDay = new Map<string, Row>()
  for (const r of rows) byDay.set(dayIdxToYmd(toNum(r.d)), r)
  return listDays(tz, start, end).map((day) => {
    const r = byDay.get(day)
    const sessions = r ? toNum(r.sessions) : 0
    return { day, sessions, pageviews: r ? toNum(r.pageviews) : 0, visitors: r ? toNum(r.visitors) : 0, n: sessions }
  })
}

function toRecent(r: Row): RecentSession {
  return {
    sid: String(r.sid),
    startedAt: toNum(r.started_at),
    lastSeenAt: toNum(r.last_seen_at),
    country: toStr(r.country),
    city: toStr(r.city),
    asOrg: toStr(r.as_org),
    deviceType: toStr(r.device_type),
    browser: toStr(r.browser),
    entryPath: toStr(r.entry_path),
    pageviews: toNum(r.pageviews),
    activeMs: toNum(r.active_ms),
    durationMs: toNum(r.duration_ms),
    isBot: toNum(r.is_bot) === 1,
    hasReplay: toNum(r.has_replay) === 1,
    intent: intentFlagsOf(r),
  }
}

async function build(event: H3Event, q: OpsQuery): Promise<Overview> {
  const now = Date.now()
  const w = parseWindow(q, now)
  const db = getDb(event)
  const where = buildWhere(q, w)
  const today = dayStart(w.tz, now)
  const compare = q.compare === '1' && w.range !== 'all'
  const pw = prevWindow(w)
  const wherePrev = buildWhere(q, pw)
  const bots = q.bots === '1' ? '' : 'AND s.is_bot = 0'
  const tsFloor = Math.max(0, w.start - TZ_HOUR_MS)

  const seriesStart = Math.max(w.start, w.end - SERIES_MAX_MS)
  const whereSeries = buildWhere(q, { ...w, start: seriesStart })
  const local = localMsSql('s.started_at', tzSegments(w.tz, seriesStart, w.end))
  const localPrev = localMsSql('s.started_at', tzSegments(w.tz, pw.start, pw.end))
  const localHeat = localMsSql('s.started_at', tzSegments(w.tz, w.start, w.end))

  const top = (expr: string, limit = 10) =>
    bindStmt(db, `SELECT ${expr} AS k, COUNT(*) AS n FROM sessions s WHERE ${where.sql} GROUP BY k ORDER BY n DESC LIMIT ${limit}`, where.args)

  const res = await batchAll(db, [
    /* 0 */ bindStmt(db, statsSql(where), [...where.args, today]),
    /* 1 */ compare ? bindStmt(db, statsSql(wherePrev), [...wherePrev.args, today]) : bindStmt(db, 'SELECT 1 AS x'),
    /* 2 */ bindStmt(db, seriesSql(whereSeries, local), [...local.args, ...whereSeries.args]),
    /* 3 */ compare ? bindStmt(db, seriesSql(wherePrev, localPrev), [...localPrev.args, ...wherePrev.args]) : bindStmt(db, 'SELECT 1 AS x'),
    /* 4 */ bindStmt(
      db,
      `WITH b AS (SELECT ${localHeat.sql} AS lt FROM sessions s WHERE ${where.sql}) `
        + `SELECT ${dowSql('lt')} AS dow, ${hourSql('lt')} AS hour, COUNT(*) AS n FROM b GROUP BY dow, hour`,
      [...localHeat.args, ...where.args],
    ),
    /* 5 */ top(`COALESCE(NULLIF(s.as_org, ''), '(unknown)')`),
    /* 6 */ bindStmt(
      db,
      `SELECT pv.path AS k, COUNT(*) AS n FROM page_visits pv JOIN sessions s ON s.sid = pv.sid WHERE ${where.sql} GROUP BY k ORDER BY n DESC LIMIT 10`,
      where.args,
    ),
    /* 7 */ top(referrerHostSql('s.referrer')),
    /* 8 */ top(`COALESCE(NULLIF(s.entry_path, ''), '(unknown)')`),
    /* 9 */ top(`COALESCE(NULLIF(s.exit_path, ''), NULLIF(s.last_path, ''), '(unknown)')`),
    /* 10 */ bindStmt(
      db,
      `SELECT e.id, e.ts, e.type, e.name, e.path, e.payload FROM events e JOIN sessions s ON s.sid = e.sid `
        + `WHERE e.type IN ${ERROR_TYPES} AND e.ts >= ? AND ${where.sql} ORDER BY e.ts DESC LIMIT 20`,
      [tsFloor, ...where.args],
    ),
    /* 11 */ bindStmt(db, `SELECT ${sessionProjection('s')} FROM sessions s WHERE ${where.sql} ORDER BY s.started_at DESC LIMIT 8`, where.args),
    /* 12 */ bindStmt(
      db,
      `SELECT COUNT(DISTINCT r.sid) AS count, COALESCE(SUM(r.bytes), 0) AS bytes FROM replay_chunks_v2 r JOIN sessions s ON s.sid = r.sid `
        + `WHERE r.pending = 0 AND ${where.sql}`,
      where.args,
    ),
    /* 13 */ bindStmt(
      db,
      'SELECT (SELECT COUNT(*) FROM sessions) AS sessions, (SELECT COALESCE(MAX(id), 0) FROM events) AS eventsApprox, '
        + '(SELECT COALESCE(MAX(rowid), 0) FROM page_visits) AS pageVisitsApprox',
    ),
    /* 14 */ bindStmt(db, `SELECT COUNT(*) AS n FROM sessions s WHERE s.started_at > ? AND s.last_seen_at > ? ${bots}`, [
      now - 6 * TZ_HOUR_MS,
      now - 60_000,
    ]),
  ])
  const at = (i: number): Row[] => res[i] ?? []
  const one = (i: number): Row | undefined => at(i)[0]

  let sizeBytes: number | null = null
  try {
    const row = await db.prepare('SELECT page_count * page_size AS b FROM pragma_page_count(), pragma_page_size()').first<{ b: number }>()
    sizeBytes = row ? toNum(row.b) : null
  } catch {
    sizeBytes = null
  }

  const cur = foldStats(one(0))
  const prev = compare ? foldStats(one(1)) : null
  const heatmap: HeatCell[] = at(4).map((r) => ({ dow: toNum(r.dow), hour: toNum(r.hour), n: toNum(r.n) }))
  const d1 = one(13) ?? {}
  const replay = one(12) ?? {}

  const out: Overview = {
    stats: cur.stats,
    series: seriesOf(at(2), w.tz, seriesStart, w.end),
    heatmap,
    topOrgs: kn(at(5)).map((x) => ({ ...x, kind: orgKind(x.k) })),
    topPages: kn(at(6)),
    referrers: kn(at(7)),
    entryPaths: kn(at(8)),
    exitPaths: kn(at(9)),
    intent: cur.intent,
    errors: { total: cur.errors, recent: at(10) as unknown as EventRow[] },
    recent: at(11).map(toRecent),
    replay: { count: toNum(replay.count), bytes: toNum(replay.bytes) },
    d1: {
      sessions: toNum(d1.sessions),
      eventsApprox: toNum(d1.eventsApprox),
      pageVisitsApprox: toNum(d1.pageVisitsApprox),
      sizeBytes,
    },
    activeNow: toNum(one(14)?.n),
    visitsToday: cur.stats.visitsToday,
    uniques: cur.stats.visitors,
    avgActiveMs: cur.stats.avgActiveMs,
  }
  if (prev) {
    out.prev = { ...prev.stats, visitsToday: 0 }
    out.prevSeries = seriesOf(at(3), w.tz, pw.start, pw.end)
  }
  return out
}

/**
 * GET /api/ops/overview — tiles (+ prev on compare=1), owner-tz day series and
 * day × hour heatmap, top orgs / pages / referrer hosts / entry / exit paths,
 * intent tiles, errors { total, recent }, recent sessions, replay { count, bytes }
 * joined to the filtered sessions, D1 readouts (≈ counts, size). Cached 30 s.
 */
export default defineEventHandler(async (event): Promise<Overview> => {
  await requireAdmin(event)
  const q = parseOpsQuery(getQuery(event) as Record<string, unknown>)
  return opsCached(event, OPS_CACHE_TTL_MS, () => build(event, q))
})
