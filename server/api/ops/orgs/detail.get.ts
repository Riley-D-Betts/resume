import type { H3Event } from 'h3'
import type { KN, OpsQuery, OrgDetail, SessionRow } from '../../../../shared/analytics/ops'
import { requireAdmin } from '../../../utils/auth'
import { getDb } from '../../../utils/db'
import { OPS_CACHE_TTL_MS, opsCached } from '../../../utils/opsCache'
import type { Row } from '../../../utils/opsDb'
import { batchAll, bindStmt, toNum, toStr } from '../../../utils/opsDb'
import { buildWhere, foldStats, parseOpsQuery, parseWindow, sessionProjection, statsSql } from '../../../utils/opsFilters'
import { dayIdxToYmd, dayStart, daySql, listDays, localMsSql, tzSegments } from '../../../utils/opsTz'
import { orgKind } from '../../../utils/orgKind'

function kn(rows: Row[]): KN[] {
  return rows.map((r) => ({ k: toStr(r.k) ?? '(unknown)', n: toNum(r.n) }))
}

async function build(event: H3Event, q: OpsQuery, org: string): Promise<OrgDetail> {
  const now = Date.now()
  const w = parseWindow(q, now)
  const db = getDb(event)
  const where = buildWhere({ ...q, org }, w)
  const local = localMsSql('s.started_at', tzSegments(w.tz, w.start, w.end))

  const res = await batchAll(db, [
    /* 0 */ bindStmt(db, statsSql(where), [...where.args, dayStart(w.tz, now)]),
    /* 1 */ bindStmt(db, `SELECT ${daySql(local.sql)} AS d, COUNT(*) AS n FROM sessions s WHERE ${where.sql} GROUP BY d ORDER BY d`, [
      ...local.args,
      ...where.args,
    ]),
    /* 2 */ bindStmt(db, `SELECT ${sessionProjection('s')} FROM sessions s WHERE ${where.sql} ORDER BY s.started_at DESC LIMIT 100`, where.args),
    /* 3 */ bindStmt(
      db,
      `SELECT s.vid AS vid, COUNT(*) AS sessions, MIN(s.started_at) AS firstSeen, MAX(s.last_seen_at) AS lastSeen FROM sessions s `
        + `WHERE ${where.sql} GROUP BY s.vid ORDER BY lastSeen DESC LIMIT 100`,
      where.args,
    ),
    /* 4 */ bindStmt(
      db,
      `SELECT pv.path AS k, COUNT(*) AS n FROM page_visits pv JOIN sessions s ON s.sid = pv.sid WHERE ${where.sql} GROUP BY k ORDER BY n DESC LIMIT 20`,
      where.args,
    ),
    /* 5 */ bindStmt(
      db,
      `SELECT COALESCE(NULLIF(s.country, ''), '??') AS k, COUNT(*) AS n FROM sessions s WHERE ${where.sql} GROUP BY k ORDER BY n DESC LIMIT 12`,
      where.args,
    ),
    /* 6 */ bindStmt(
      db,
      `SELECT n.rdns_host AS k, COUNT(*) AS n FROM session_net n JOIN sessions s ON s.sid = n.sid WHERE n.rdns_host IS NOT NULL AND ${where.sql} `
        + 'GROUP BY k ORDER BY n DESC LIMIT 20',
      where.args,
    ),
    /* 7 */ bindStmt(db, `SELECT DISTINCT s.asn AS asn FROM sessions s WHERE ${where.sql} AND s.asn IS NOT NULL LIMIT 10`, where.args),
  ])
  const at = (i: number): Row[] => res[i] ?? []
  const folded = foldStats(res[0]?.[0])
  const byDay = new Map(at(1).map((r) => [dayIdxToYmd(toNum(r.d)), toNum(r.n)]))

  return {
    org,
    kind: orgKind(org),
    asns: at(7).map((r) => toNum(r.asn)),
    totals: folded.stats,
    intent: folded.intent,
    series: listDays(w.tz, w.start, w.end).map((day) => ({ day, sessions: byDay.get(day) ?? 0 })),
    sessions: at(2) as unknown as SessionRow[],
    visitors: at(3).map((r) => ({ vid: String(r.vid), sessions: toNum(r.sessions), firstSeen: toNum(r.firstSeen), lastSeen: toNum(r.lastSeen) })),
    pages: kn(at(4)),
    countries: kn(at(5)),
    rdnsHosts: kn(at(6)),
  }
}

/**
 * GET /api/ops/orgs/detail?org=<as_org | (unknown)> — one organisation:
 * totals (Stats + intent tiles), owner-tz day series, ≤ 100 newest sessions,
 * visitors, pages read, countries, rDNS hosts. Cached 30 s.
 */
export default defineEventHandler(async (event): Promise<OrgDetail> => {
  await requireAdmin(event)
  const raw = getQuery(event) as Record<string, unknown>
  const q = parseOpsQuery(raw)
  const org = typeof raw.org === 'string' ? raw.org.trim().slice(0, 200) : ''
  if (org.length === 0) throw createError({ statusCode: 400, statusMessage: 'org required' })
  return opsCached(event, OPS_CACHE_TTL_MS, () => build(event, q, org))
})
