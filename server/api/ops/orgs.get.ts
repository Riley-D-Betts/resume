import type { H3Event } from 'h3'
import type { OpsQuery, OrgRow, Orgs } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { OPS_CACHE_TTL_MS, opsCached } from '../../utils/opsCache'
import type { Row } from '../../utils/opsDb'
import { batchAll, bindStmt, jsonNumbers, jsonStrings, toNum, toStr } from '../../utils/opsDb'
import { activeSql, buildWhere, parseOpsQuery, parseWindow, prevWindow, sortSpec } from '../../utils/opsFilters'
import { orgKind } from '../../utils/orgKind'

const ORG_EXPR = "COALESCE(NULLIF(s.as_org, ''), '(unknown)')"
const SORTS: Record<string, string> = {
  lastSeen: 'lastSeen',
  sessions: 'sessions',
  visitors: 'visitors',
  contact: 'contact',
}
const LIMIT = 200

async function build(event: H3Event, q: OpsQuery): Promise<Orgs> {
  const w = parseWindow(q)
  const db = getDb(event)
  const where = buildWhere(q, w)
  const compare = q.compare === '1' && w.range !== 'all'
  const wherePrev = buildWhere(q, prevWindow(w))
  const sort = sortSpec(q, SORTS, 'lastSeen')
  const hideIsp = q.hideIsp === '1'
  // `kind` comes from the AS name in JS, so HIDE ISP/CLOUD can only filter
  // after the fetch — pull 1 000 candidates so 200 org rows survive it (R4-L8).
  const fetchLimit = hideIsp ? 1000 : LIMIT

  const res = await batchAll(db, [
    /* 0 */ bindStmt(
      db,
      `SELECT ${ORG_EXPR} AS org, json_group_array(DISTINCT s.asn) AS asns, COUNT(*) AS sessions, COUNT(DISTINCT s.vid) AS visitors, `
        + 'COUNT(DISTINCT CASE WHEN s.is_returning = 1 THEN s.vid END) AS returningVisitors, COALESCE(SUM(s.pageviews), 0) AS pageviews, '
        + `COALESCE(SUM(${activeSql('s')}), 0) AS activeMs, COALESCE(SUM(s.form_submitted), 0) AS mailHandoffs, `
        + 'COALESCE(SUM(s.mailto_clicks), 0) AS mailtoClicks, COALESCE(SUM(s.email_copies), 0) AS emailCopies, COALESCE(SUM(s.prints), 0) AS prints, '
        + 'COALESCE(SUM(s.form_submitted), 0) + COALESCE(SUM(s.mailto_clicks), 0) + COALESCE(SUM(s.email_copies), 0) AS contact, '
        + 'json_group_array(DISTINCT s.country) AS countries, json_group_array(DISTINCT s.city) AS cities, '
        + 'MIN(s.started_at) AS firstSeen, MAX(s.last_seen_at) AS lastSeen, MAX(s.has_replay) AS hasReplay '
        + `FROM sessions s WHERE ${where.sql} GROUP BY org ORDER BY ${sort.col} ${sort.dir}, lastSeen DESC LIMIT ${fetchLimit}`,
      where.args,
    ),
    /* 1 */ bindStmt(
      db,
      `SELECT ${ORG_EXPR} AS org, json_group_array(DISTINCT n.rdns_host) AS hosts FROM session_net n JOIN sessions s ON s.sid = n.sid `
        + `WHERE n.rdns_host IS NOT NULL AND ${where.sql} GROUP BY org ORDER BY org LIMIT 500`,
      where.args,
    ),
    /* 2 */ compare
      ? bindStmt(db, `SELECT ${ORG_EXPR} AS org, COUNT(*) AS n FROM sessions s WHERE ${wherePrev.sql} GROUP BY org LIMIT 500`, wherePrev.args)
      : bindStmt(db, 'SELECT 1 AS x'),
  ])
  const at = (i: number): Row[] => res[i] ?? []
  const rdns = new Map(at(1).map((r) => [toStr(r.org) ?? '(unknown)', jsonStrings(r.hosts, 10)]))
  const prev = compare ? new Map(at(2).map((r) => [toStr(r.org) ?? '(unknown)', toNum(r.n)])) : null

  let orgs: OrgRow[] = at(0).map((r) => {
    const org = toStr(r.org) ?? '(unknown)'
    const sessions = toNum(r.sessions)
    const row: OrgRow = {
      org,
      kind: orgKind(org),
      asns: jsonNumbers(r.asns, 10),
      sessions,
      visitors: toNum(r.visitors),
      returningVisitors: toNum(r.returningVisitors),
      pageviews: toNum(r.pageviews),
      avgActiveMs: sessions > 0 ? Math.round(toNum(r.activeMs) / sessions) : 0,
      mailHandoffs: toNum(r.mailHandoffs),
      mailtoClicks: toNum(r.mailtoClicks),
      emailCopies: toNum(r.emailCopies),
      prints: toNum(r.prints),
      countries: jsonStrings(r.countries, 10),
      cities: jsonStrings(r.cities, 10),
      firstSeen: toNum(r.firstSeen),
      lastSeen: toNum(r.lastSeen),
      hasReplay: toNum(r.hasReplay) === 1,
      rdnsHosts: rdns.get(org) ?? [],
    }
    if (prev) row.prevSessions = prev.get(org) ?? 0
    return row
  })
  if (hideIsp) orgs = orgs.filter((o) => o.kind !== 'isp' && o.kind !== 'cloud').slice(0, LIMIT)
  return { orgs }
}

/**
 * GET /api/ops/orgs?sort=lastSeen|sessions|visitors|contact&dir=&hideIsp=1 —
 * "who is looking": sessions grouped by as_org with json_group_array(DISTINCT …)
 * for ASNs / countries / cities, rDNS hosts from session_net, a kind badge
 * (org / isp / cloud — never a sort key), prevSessions on compare=1. Default
 * sort lastSeen DESC; ≤ 200 orgs. Cached 30 s.
 */
export default defineEventHandler(async (event): Promise<Orgs> => {
  await requireAdmin(event)
  const q = parseOpsQuery(getQuery(event) as Record<string, unknown>)
  return opsCached(event, OPS_CACHE_TTL_MS, () => build(event, q))
})
