import type { H3Event } from 'h3'
import { SCROLL_MILESTONES } from '../../../../shared/analytics/events'
import type { KN, OpsQuery, PageDetail, PageVisitRow, SectionStat } from '../../../../shared/analytics/ops'
import { requireAdmin } from '../../../utils/auth'
import { getDb } from '../../../utils/db'
import { OPS_CACHE_TTL_MS, opsCached } from '../../../utils/opsCache'
import type { Row } from '../../../utils/opsDb'
import { batchAll, bindStmt, toNum, toStr } from '../../../utils/opsDb'
import { buildWhere, parseOpsQuery, parseWindow } from '../../../utils/opsFilters'
import { TZ_HOUR_MS, dayIdxToYmd, daySql, listDays, localMsSql, tzSegments } from '../../../utils/opsTz'

const PATH_RE = /^\/[^\s?#]{0,199}$/

function kn(rows: Row[]): KN[] {
  return rows.map((r) => ({ k: toStr(r.k) ?? '(unknown)', n: toNum(r.n) }))
}

async function build(event: H3Event, q: OpsQuery, path: string): Promise<PageDetail> {
  const w = parseWindow(q)
  const db = getDb(event)
  const where = buildWhere(q, w)
  const tsFloor = Math.max(0, w.start - TZ_HOUR_MS)
  const local = localMsSql('pv.entered_at', tzSegments(w.tz, w.start, w.end))
  const pvJoin = `FROM page_visits pv JOIN sessions s ON s.sid = pv.sid WHERE pv.path = ? AND ${where.sql}`
  const evJoin = `FROM events e JOIN sessions s ON s.sid = e.sid WHERE COALESCE(e.path, s.entry_path) = ? AND e.ts >= ? AND ${where.sql}`
  const milestones = SCROLL_MILESTONES.map((m) => `COUNT(DISTINCT CASE WHEN pv.max_scroll_pct >= ${m} THEN pv.sid END) AS m${m}`).join(', ')

  const res = await batchAll(db, [
    /* 0 */ bindStmt(db, `SELECT ${daySql(local.sql)} AS d, COUNT(*) AS n ${pvJoin} GROUP BY d ORDER BY d`, [...local.args, path, ...where.args]),
    /* 1 */ bindStmt(
      db,
      `SELECT e.name AS section, CAST(ROUND(COALESCE(AVG(CAST(json_extract(e.payload, '$.dwellMs') AS REAL)), 0)) AS INTEGER) AS avgDwellMs, `
        + `COUNT(*) AS n, COUNT(DISTINCT e.sid) AS sessions ${evJoin} AND e.type = 'section_exit' AND e.name IS NOT NULL `
        + 'GROUP BY e.name ORDER BY n DESC LIMIT 100',
      [path, tsFloor, ...where.args],
    ),
    /* 2 */ bindStmt(db, `SELECT ${milestones} ${pvJoin}`, [path, ...where.args]),
    /* 3 */ bindStmt(
      db,
      `SELECT pv.path AS k, COUNT(*) AS n FROM page_visits pv JOIN sessions s ON s.sid = pv.sid WHERE pv.from_path = ? AND ${where.sql} `
        + 'GROUP BY k ORDER BY n DESC LIMIT 12',
      [path, ...where.args],
    ),
    /* 4 */ bindStmt(db, `SELECT pv.from_path AS k, COUNT(*) AS n ${pvJoin} AND pv.from_path IS NOT NULL GROUP BY k ORDER BY n DESC LIMIT 12`, [
      path,
      ...where.args,
    ]),
    /* 5 */ bindStmt(
      db,
      `WITH c AS MATERIALIZED (SELECT e.payload AS payload ${evJoin} AND e.type = 'click' ORDER BY e.ts DESC LIMIT 2000) `
        + `SELECT COALESCE(json_extract(payload, '$.sel'), '?') AS sel, COALESCE(json_extract(payload, '$.text'), '') AS text, COUNT(*) AS n `
        + 'FROM c GROUP BY sel, text ORDER BY n DESC LIMIT 50',
      [path, tsFloor, ...where.args],
    ),
    /* 6 */ bindStmt(db, `SELECT MIN(pv.active_ms / 5000, 12) AS b, COUNT(*) AS n ${pvJoin} GROUP BY b ORDER BY b`, [path, ...where.args]),
    /* 7 */ bindStmt(db, `SELECT pv.* ${pvJoin} ORDER BY pv.entered_at DESC LIMIT 50`, [path, ...where.args]),
  ])
  const at = (i: number): Row[] => res[i] ?? []

  const byDay = new Map(at(0).map((r) => [dayIdxToYmd(toNum(r.d)), toNum(r.n)]))
  const scroll = res[2]?.[0] ?? {}
  const hist = new Map(at(6).map((r) => [toNum(r.b), toNum(r.n)]))

  return {
    path,
    series: listDays(w.tz, w.start, w.end).map((day) => ({ day, pageviews: byDay.get(day) ?? 0 })),
    sections: at(1).map(
      (r): SectionStat => ({
        path,
        section: toStr(r.section) ?? '?',
        avgDwellMs: toNum(r.avgDwellMs),
        n: toNum(r.n),
        sessions: toNum(r.sessions),
      }),
    ),
    scrollFunnel: SCROLL_MILESTONES.map((pct) => ({ pct, sessions: toNum(scroll[`m${pct}`]) })),
    next: kn(at(3)),
    prev: kn(at(4)),
    clicks: at(5).map((r) => ({ sel: toStr(r.sel) ?? '?', text: toStr(r.text) ?? '', n: toNum(r.n) })),
    dwellHist: Array.from({ length: 13 }, (_, b) => ({ bucket: b < 12 ? `${b * 5}-${b * 5 + 5}s` : '60s+', n: hist.get(b) ?? 0 })),
    recent: at(7) as unknown as PageVisitRow[],
  }
}

/**
 * GET /api/ops/pages/detail?path=/x — one page: owner-tz day series, sections,
 * scroll funnel (sessions reaching each milestone), next / previous pages,
 * grouped clicks (newest 2 000 click events), dwell histogram (5 s buckets),
 * 50 recent visits. Cached 30 s.
 */
export default defineEventHandler(async (event): Promise<PageDetail> => {
  await requireAdmin(event)
  const raw = getQuery(event) as Record<string, unknown>
  const q = parseOpsQuery(raw)
  const path = typeof raw.path === 'string' ? raw.path.trim() : ''
  if (!PATH_RE.test(path)) throw createError({ statusCode: 400, statusMessage: 'path required' })
  return opsCached(event, OPS_CACHE_TTL_MS, () => build(event, q, path))
})
