import type { H3Event } from 'h3'
import type { OpsQuery, PageStat, Pages, SectionStat } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { OPS_CACHE_TTL_MS, opsCached } from '../../utils/opsCache'
import type { Row } from '../../utils/opsDb'
import { batchAll, bindStmt, pctOf, toNum, toStr } from '../../utils/opsDb'
import type { WhereParts } from '../../utils/opsFilters'
import { BOUNCE_SQL, activeSql, buildWhere, parseOpsQuery, parseWindow, prevWindow } from '../../utils/opsFilters'
import type { PercentileRow } from '../../utils/opsPercentile'
import { SAMPLE_LIMIT, foldPercentiles, percentileKey, percentileSelect } from '../../utils/opsPercentile'
import { TZ_HOUR_MS } from '../../utils/opsTz'

const ERROR_TYPES = "('js_error', 'resource_error', 'console_error')"
const PATH_LIMIT = 200

function perPathSql(where: WhereParts): string {
  return (
    'SELECT pv.path AS path, COUNT(*) AS pageviews, COUNT(DISTINCT pv.sid) AS sessions, COALESCE(AVG(pv.active_ms), 0) AS avgActiveMs, '
    + 'COALESCE(AVG(pv.max_scroll_pct), 0) AS avgScrollPct, '
    + 'COALESCE(SUM(CASE WHEN pv.active_ms > 0 THEN pv.text_len END), 0) AS textLen, '
    + 'COALESCE(SUM(CASE WHEN pv.active_ms > 0 AND pv.text_len IS NOT NULL THEN pv.active_ms END), 0) AS textActiveMs '
    + `FROM page_visits pv JOIN sessions s ON s.sid = pv.sid WHERE ${where.sql} GROUP BY pv.path ORDER BY pageviews DESC LIMIT ${PATH_LIMIT}`
  )
}

async function build(event: H3Event, q: OpsQuery): Promise<Pages> {
  const w = parseWindow(q)
  const db = getDb(event)
  const where = buildWhere(q, w)
  const compare = q.compare === '1' && w.range !== 'all'
  const wherePrev = buildWhere(q, prevWindow(w))
  const tsFloor = Math.max(0, w.start - TZ_HOUR_MS)

  const res = await batchAll(db, [
    /* 0 */ bindStmt(db, perPathSql(where), where.args),
    /* 1 */ bindStmt(
      db,
      `SELECT entry_path AS path, COUNT(*) AS entries, COALESCE(SUM(${BOUNCE_SQL}), 0) AS bounced FROM `
        + `(SELECT s.entry_path, s.pageviews, ${activeSql('s')} AS active_ms FROM sessions s WHERE ${where.sql}) b GROUP BY entry_path`,
      where.args,
    ),
    /* 2 */ bindStmt(
      db,
      `SELECT COALESCE(NULLIF(s.exit_path, ''), s.last_path) AS path, COUNT(*) AS exits FROM sessions s WHERE ${where.sql} GROUP BY 1`,
      where.args,
    ),
    /* 3 */ bindStmt(
      db,
      `WITH base AS MATERIALIZED (SELECT pv.path AS key, 'active' AS metric, pv.active_ms AS v FROM page_visits pv JOIN sessions s ON s.sid = pv.sid `
        + `WHERE ${where.sql} ORDER BY pv.entered_at DESC LIMIT ${SAMPLE_LIMIT}) ${percentileSelect('SELECT key, metric, v FROM base')}`,
      where.args,
    ),
    /* 4 */ bindStmt(
      db,
      `SELECT COALESCE(e.path, s.entry_path, '(unknown)') AS path, COUNT(*) AS n FROM events e JOIN sessions s ON s.sid = e.sid `
        + `WHERE e.type IN ${ERROR_TYPES} AND e.ts >= ? AND ${where.sql} GROUP BY 1 ORDER BY n DESC LIMIT ${PATH_LIMIT}`,
      [tsFloor, ...where.args],
    ),
    /* 5 */ bindStmt(
      db,
      `SELECT COALESCE(e.path, s.entry_path, '(unknown)') AS path, e.name AS section, `
        + `CAST(ROUND(COALESCE(AVG(CAST(json_extract(e.payload, '$.dwellMs') AS REAL)), 0)) AS INTEGER) AS avgDwellMs, COUNT(*) AS n, COUNT(DISTINCT e.sid) AS sessions `
        + `FROM events e JOIN sessions s ON s.sid = e.sid WHERE e.type = 'section_exit' AND e.name IS NOT NULL AND e.ts >= ? AND ${where.sql} `
        + 'GROUP BY 1, 2 ORDER BY n DESC LIMIT 200',
      [tsFloor, ...where.args],
    ),
    /* 6 */ bindStmt(db, 'SELECT MIN(entered_at) AS since FROM page_visits'),
    /* 7 */ compare ? bindStmt(db, perPathSql(wherePrev), wherePrev.args) : bindStmt(db, 'SELECT 1 AS x'),
  ])
  const at = (i: number): Row[] => res[i] ?? []

  const entries = new Map(at(1).map((r) => [toStr(r.path) ?? '', r]))
  const exits = new Map(at(2).map((r) => [toStr(r.path) ?? '', toNum(r.exits)]))
  const p50 = foldPercentiles(at(3) as unknown as PercentileRow[])
  const errors = new Map(at(4).map((r) => [toStr(r.path) ?? '', toNum(r.n)]))
  const prev = compare ? new Map(at(7).map((r) => [toStr(r.path) ?? '', r])) : null

  const pages: PageStat[] = at(0).map((r) => {
    const path = toStr(r.path) ?? '(unknown)'
    const en = entries.get(path)
    const textLen = toNum(r.textLen)
    const textActiveMs = toNum(r.textActiveMs)
    const stat: PageStat = {
      path,
      pageviews: toNum(r.pageviews),
      sessions: toNum(r.sessions),
      entries: en ? toNum(en.entries) : 0,
      exits: exits.get(path) ?? 0,
      avgActiveMs: Math.round(toNum(r.avgActiveMs)),
      p50ActiveMs: p50.get(percentileKey(path, 'active'))?.p50 ?? 0,
      avgScrollPct: Math.round(toNum(r.avgScrollPct)),
      bounceRate: en ? pctOf(toNum(en.bounced), toNum(en.entries)) : 0,
      errors: errors.get(path) ?? 0,
      textCps: textActiveMs > 0 && textLen > 0 ? Math.round((textLen / (textActiveMs / 1000)) * 10) / 10 : null,
    }
    const pr = prev?.get(path)
    if (prev) stat.prev = { pageviews: pr ? toNum(pr.pageviews) : 0, avgActiveMs: pr ? Math.round(toNum(pr.avgActiveMs)) : 0 }
    return stat
  })

  const sections: SectionStat[] = at(5).map((r) => ({
    path: toStr(r.path) ?? '(unknown)',
    section: toStr(r.section) ?? '?',
    avgDwellMs: toNum(r.avgDwellMs),
    n: toNum(r.n),
    sessions: toNum(r.sessions),
  }))
  const sinceRaw = res[6]?.[0]?.since
  return { pages, sections, since: sinceRaw === null || sinceRaw === undefined ? null : toNum(sinceRaw) }
}

/**
 * GET /api/ops/pages — per-path pageviews / sessions / entries / exits / avg +
 * p50 active / scroll / bounce / errors / TEXT CHARS PER ACTIVE SEC from
 * page_visits JOIN sessions; section dwell per page; `since` = the first
 * page_visits row ("PAGE-LEVEL DATA SINCE"). prev on compare=1. Cached 30 s.
 */
export default defineEventHandler(async (event): Promise<Pages> => {
  await requireAdmin(event)
  const q = parseOpsQuery(getQuery(event) as Record<string, unknown>)
  return opsCached(event, OPS_CACHE_TTL_MS, () => build(event, q))
})
