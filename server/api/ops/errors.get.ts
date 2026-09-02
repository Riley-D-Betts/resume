import type { H3Event } from 'h3'
import type { ErrorGroup, Errors, EventRow, KN, OpsQuery } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { OPS_CACHE_TTL_MS, opsCached } from '../../utils/opsCache'
import type { Row } from '../../utils/opsDb'
import { batchAll, bindStmt, toNum, toStr } from '../../utils/opsDb'
import type { WhereParts } from '../../utils/opsFilters'
import { buildWhere, parseOpsQuery, parseWindow, prevWindow } from '../../utils/opsFilters'
import { TZ_HOUR_MS, dayIdxToYmd, daySql, listDays, localMsSql, tzSegments } from '../../utils/opsTz'

const SAMPLE = 5000
const ERROR_TYPES = "('js_error', 'resource_error', 'console_error')"
const KIND: Record<string, ErrorGroup['kind']> = { js_error: 'js', resource_error: 'resource', console_error: 'console' }

/** Newest ≤ 5 000 error events in range with the grouping keys precomputed. Bind: [tsFloor, ...where.args]. */
function baseSql(where: WhereParts): string {
  return (
    'WITH base AS MATERIALIZED (SELECT e.id, e.sid, e.ts, e.type, e.name, COALESCE(e.path, s.entry_path) AS path, e.payload, s.browser, '
    + "COALESCE(json_extract(e.payload, '$.msg'), json_extract(e.payload, '$.tag') || ' ' || json_extract(e.payload, '$.src'), '(no message)') AS msg, "
    + "json_extract(e.payload, '$.src') AS src "
    + `FROM events e JOIN sessions s ON s.sid = e.sid WHERE e.type IN ${ERROR_TYPES} AND e.ts >= ? AND ${where.sql} ORDER BY e.ts DESC LIMIT ${SAMPLE})`
  )
}

function gkey(r: Row): string {
  return `${String(r.type)}\n${toStr(r.msg) ?? ''}\n${toStr(r.src) ?? ''}`
}

async function build(event: H3Event, q: OpsQuery): Promise<Errors> {
  const w = parseWindow(q)
  const db = getDb(event)
  const where = buildWhere(q, w)
  const compare = q.compare === '1' && w.range !== 'all'
  const pw = prevWindow(w)
  const wherePrev = buildWhere(q, pw)
  const tsFloor = Math.max(0, w.start - TZ_HOUR_MS)
  const tsFloorPrev = Math.max(0, pw.start - TZ_HOUR_MS)
  const base = baseSql(where)
  const args = [tsFloor, ...where.args]
  const local = localMsSql('ts', tzSegments(w.tz, w.start, w.end))

  const res = await batchAll(db, [
    /* 0 */ bindStmt(
      db,
      `${base} SELECT type, msg, src, COUNT(*) AS n, COUNT(DISTINCT sid) AS sessions, MIN(ts) AS firstSeen, MAX(ts) AS lastSeen `
        + 'FROM base GROUP BY type, msg, src ORDER BY n DESC LIMIT 100',
      args,
    ),
    /* 1 */ bindStmt(db, `${base} SELECT type, msg, src, COALESCE(browser, '?') AS k, COUNT(*) AS n FROM base GROUP BY type, msg, src, k ORDER BY n DESC LIMIT 600`, args),
    /* 2 */ bindStmt(db, `${base} SELECT type, msg, src, COALESCE(path, '?') AS k, COUNT(*) AS n FROM base GROUP BY type, msg, src, k ORDER BY n DESC LIMIT 600`, args),
    /* 3 */ bindStmt(
      db,
      `${base} SELECT type, msg, src, sid, json_extract(payload, '$.stack') AS stack FROM base WHERE id IN (SELECT MAX(id) FROM base GROUP BY type, msg, src) LIMIT 200`,
      args,
    ),
    /* 4 */ bindStmt(db, `${base} SELECT ${daySql(local.sql)} AS d, COUNT(*) AS n FROM base GROUP BY d ORDER BY d`, [...args, ...local.args]),
    /* 5 */ bindStmt(db, `${base} SELECT id, ts, type, name, path, payload FROM base ORDER BY ts DESC LIMIT 50`, args),
    /* 6 */ compare
      ? bindStmt(db, `${baseSql(wherePrev)} SELECT type, msg, src, COUNT(*) AS n FROM base GROUP BY type, msg, src ORDER BY n DESC LIMIT 500`, [
          tsFloorPrev,
          ...wherePrev.args,
        ])
      : bindStmt(db, 'SELECT 1 AS x'),
    /* 7 */ bindStmt(
      db,
      `SELECT COUNT(*) AS n FROM events e JOIN sessions s ON s.sid = e.sid WHERE e.type IN ${ERROR_TYPES} AND e.ts >= ? AND ${where.sql}`,
      args,
    ),
  ])
  const at = (i: number): Row[] => res[i] ?? []

  const browsers = new Map<string, KN[]>()
  for (const r of at(1)) {
    const k = gkey(r)
    const list = browsers.get(k) ?? []
    if (list.length < 8) list.push({ k: toStr(r.k) ?? '?', n: toNum(r.n) })
    browsers.set(k, list)
  }
  const paths = new Map<string, KN[]>()
  for (const r of at(2)) {
    const k = gkey(r)
    const list = paths.get(k) ?? []
    if (list.length < 8) list.push({ k: toStr(r.k) ?? '?', n: toNum(r.n) })
    paths.set(k, list)
  }
  const samples = new Map(at(3).map((r) => [gkey(r), r]))
  const prev = compare ? new Map(at(6).map((r) => [gkey(r), toNum(r.n)])) : null

  const groups: ErrorGroup[] = at(0).map((r) => {
    const k = gkey(r)
    const sample = samples.get(k)
    const g: ErrorGroup = {
      kind: KIND[String(r.type)] ?? 'js',
      msg: toStr(r.msg) ?? '(no message)',
      src: toStr(r.src),
      n: toNum(r.n),
      sessions: toNum(r.sessions),
      firstSeen: toNum(r.firstSeen),
      lastSeen: toNum(r.lastSeen),
      browsers: browsers.get(k) ?? [],
      paths: paths.get(k) ?? [],
      sampleStack: sample ? toStr(sample.stack) : null,
      sampleSid: sample ? String(sample.sid) : '',
    }
    if (prev) g.prev = prev.get(k) ?? 0
    return g
  })

  const byDay = new Map(at(4).map((r) => [dayIdxToYmd(toNum(r.d)), toNum(r.n)]))
  const total = toNum(res[7]?.[0]?.n)
  return {
    groups,
    series: listDays(w.tz, w.start, w.end).map((day) => ({ day, n: byDay.get(day) ?? 0 })),
    recent: at(5) as unknown as EventRow[],
    sampled: { n: Math.min(total, SAMPLE), total },
  }
}

/**
 * GET /api/ops/errors — JS / resource / console errors grouped by
 * (type, msg, src) with counts, sessions, first / last seen, browsers, paths
 * and a sample stack, over the newest ≤ 5 000 error events in range
 * (idx_events_type_ts); owner-tz day series; 50 newest rows; prev counts on
 * compare=1. Cached 30 s.
 */
export default defineEventHandler(async (event): Promise<Errors> => {
  await requireAdmin(event)
  const q = parseOpsQuery(getQuery(event) as Record<string, unknown>)
  return opsCached(event, OPS_CACHE_TTL_MS, () => build(event, q))
})
