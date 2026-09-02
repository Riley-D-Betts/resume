import type { H3Event } from 'h3'
import { SCROLL_MILESTONES } from '../../../shared/analytics/events'
import type { Aggregates, OpsQuery, Segment, SegmentDim } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { OPS_CACHE_TTL_MS, opsCached } from '../../utils/opsCache'
import type { Row } from '../../utils/opsDb'
import { batchAll, bindStmt, pctOf, splitDims, toNum, toStr, unionChunks } from '../../utils/opsDb'
import { ENGAGED_SQL, acceptLanguageFirstSql, activeSql, buildWhere, parseOpsQuery, parseWindow, referrerHostSql } from '../../utils/opsFilters'
import { TZ_HOUR_MS } from '../../utils/opsTz'

const SAMPLE = 5000
const DIMS = ['referrers', 'countries', 'cities', 'devices', 'browsers', 'languages', 'os', 'orgs', 'entryPaths', 'exitPaths', 'languagesRanked'] as const
const SEGMENT_DIMS: readonly SegmentDim[] = ['device', 'browser', 'country', 'referrerHost']

function unk(col: string): string {
  return `COALESCE(NULLIF(${col}, ''), '??')`
}

function topDim(dim: string, expr: string, limit = 12): string {
  return `SELECT * FROM (SELECT '${dim}' AS dim, ${expr} AS k, COUNT(*) AS n FROM base GROUP BY k ORDER BY n DESC LIMIT ${limit})`
}

function segmentDim(dim: SegmentDim, expr: string): string {
  return (
    `SELECT * FROM (SELECT '${dim}' AS dim, ${expr} AS key, COUNT(*) AS sessions, COALESCE(SUM(${ENGAGED_SQL}), 0) AS engaged, `
    + 'COALESCE(SUM(active_ms), 0) AS activeMs, COALESCE(SUM(form_submitted > 0 OR mailto_clicks > 0), 0) AS contact '
    + 'FROM base GROUP BY key ORDER BY sessions DESC LIMIT 12)'
  )
}

function parsePayload(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

async function build(event: H3Event, q: OpsQuery): Promise<Aggregates> {
  const w = parseWindow(q)
  const db = getDb(event)
  const where = buildWhere(q, w)
  const tsFloor = Math.max(0, w.start - TZ_HOUR_MS)

  const base =
    'WITH base AS MATERIALIZED (SELECT s.sid, s.referrer, s.country, s.city, s.device_type, s.browser, s.os, s.lang, s.as_org, '
    + 's.entry_path, s.exit_path, s.last_path, s.pageviews, s.form_submitted, s.mailto_clicks, n.accept_language, '
    + `${activeSql('s')} AS active_ms FROM sessions s LEFT JOIN session_net n ON n.sid = s.sid WHERE ${where.sql} `
    + `ORDER BY s.started_at DESC LIMIT ${SAMPLE})`

  // 11 dimensions → statements of ≤ 5 UNION ALL terms (workerd's compound-SELECT cap).
  const dimChunks = unionChunks([
    topDim('referrers', referrerHostSql('referrer')),
    topDim('countries', unk('country')),
    topDim('cities', unk('city')),
    topDim('devices', unk('device_type')),
    topDim('browsers', unk('browser')),
    topDim('languages', unk('lang')),
    topDim('os', unk('os')),
    topDim('orgs', `COALESCE(NULLIF(as_org, ''), '(unknown)')`),
    topDim('entryPaths', unk('entry_path')),
    topDim('exitPaths', `COALESCE(NULLIF(exit_path, ''), NULLIF(last_path, ''), '??')`),
    topDim('languagesRanked', acceptLanguageFirstSql('accept_language')),
  ])

  const segmentsSql = [
    segmentDim('device', unk('device_type')),
    segmentDim('browser', unk('browser')),
    segmentDim('country', unk('country')),
    segmentDim('referrerHost', referrerHostSql('referrer')),
  ].join(' UNION ALL ')

  const res = await batchAll(db, [
    /* 0 (dimChunks.length statements, read back as one) */ ...dimChunks.map((u) => bindStmt(db, `${base} ${u}`, where.args)),
    /* 1 */ bindStmt(db, `${base} ${segmentsSql}`, where.args),
    /* 2 */ bindStmt(
      db,
      `SELECT e.name AS section, CAST(ROUND(COALESCE(AVG(CAST(json_extract(e.payload, '$.dwellMs') AS REAL)), 0)) AS INTEGER) AS avgMs, COUNT(*) AS n `
        + `FROM events e JOIN sessions s ON s.sid = e.sid WHERE e.type = 'section_exit' AND e.name IS NOT NULL AND e.ts >= ? AND ${where.sql} `
        + 'GROUP BY e.name ORDER BY avgMs DESC LIMIT 50',
      [tsFloor, ...where.args],
    ),
    /* 3 */ bindStmt(
      db,
      `SELECT CAST(json_extract(e.payload, '$.pct') AS INTEGER) AS pct, COUNT(DISTINCT e.sid) AS sessions `
        + `FROM events e JOIN sessions s ON s.sid = e.sid WHERE e.type = 'scroll_depth' AND e.ts >= ? AND ${where.sql} GROUP BY pct`,
      [tsFloor, ...where.args],
    ),
    /* 4 */ bindStmt(
      db,
      `SELECT e.ts AS ts, e.payload AS payload FROM events e JOIN sessions s ON s.sid = e.sid `
        + `WHERE e.type = 'js_error' AND e.ts >= ? AND ${where.sql} ORDER BY e.ts DESC LIMIT 20`,
      [tsFloor, ...where.args],
    ),
    /* 5 */ bindStmt(db, `SELECT COUNT(*) AS n FROM sessions s WHERE ${where.sql}`, where.args),
  ])
  // Slot 0 is the concatenation of the dim chunks; slots 1+ follow them.
  const D = dimChunks.length
  const at = (i: number): Row[] => (i === 0 ? res.slice(0, D).flat() : (res[D - 1 + i] ?? []))

  const dims = splitDims(at(0), DIMS)
  const segments: Segment[] = at(1)
    .filter((r) => (SEGMENT_DIMS as readonly string[]).includes(String(r.dim)))
    .map((r) => {
      const sessions = toNum(r.sessions)
      return {
        dim: String(r.dim) as SegmentDim,
        key: toStr(r.key) ?? '??',
        sessions,
        engagedPct: pctOf(toNum(r.engaged), sessions),
        avgActiveMs: sessions > 0 ? Math.round(toNum(r.activeMs) / sessions) : 0,
        contactPct: pctOf(toNum(r.contact), sessions),
      }
    })
  const byPct = new Map(at(3).map((r) => [toNum(r.pct), toNum(r.sessions)]))
  const total = toNum(res[5]?.[0]?.n)

  const out: Aggregates = {
    referrers: dims.referrers,
    countries: dims.countries,
    cities: dims.cities,
    devices: dims.devices,
    browsers: dims.browsers,
    languages: dims.languages,
    os: dims.os,
    orgs: dims.orgs,
    entryPaths: dims.entryPaths,
    exitPaths: dims.exitPaths,
    languagesRanked: dims.languagesRanked,
    segments,
    sectionDwell: at(2).map((r) => ({ section: toStr(r.section) ?? '?', avgMs: toNum(r.avgMs), n: toNum(r.n) })),
    scrollFunnel: SCROLL_MILESTONES.map((pct) => ({ pct, sessions: byPct.get(pct) ?? 0 })),
    errors: at(4).map((r) => ({ ts: toNum(r.ts), payload: parsePayload(r.payload) })),
    sampled: { n: Math.min(total, SAMPLE), total },
  }
  return out
}

/**
 * GET /api/ops/aggregates — breakdown tables over a MATERIALIZED sample of the
 * ≤ 5 000 newest sessions in range (existing keys kept + os / orgs / entry /
 * exit / languagesRanked / segments), section dwell, scroll funnel, newest
 * js_error rows. Cached 30 s. Empty KN lists on an empty DB.
 */
export default defineEventHandler(async (event): Promise<Aggregates> => {
  await requireAdmin(event)
  const q = parseOpsQuery(getQuery(event) as Record<string, unknown>)
  return opsCached(event, OPS_CACHE_TTL_MS, () => build(event, q))
})
