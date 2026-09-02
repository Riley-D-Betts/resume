import type { Filters } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { OPS_CACHE_TTL_MS, opsCached } from '../../utils/opsCache'
import { batchAll, bindStmt, splitDims } from '../../utils/opsDb'
import { buildWhere, parseOpsQuery, parseWindow } from '../../utils/opsFilters'

const SAMPLE = 5000
const TOP = 50
const DIMS = ['orgs', 'countries', 'devices', 'browsers', 'oses', 'paths'] as const

function topDim(dim: string, expr: string): string {
  return `SELECT * FROM (SELECT '${dim}' AS dim, ${expr} AS k, COUNT(*) AS n FROM base WHERE ${expr} IS NOT NULL AND ${expr} <> '' GROUP BY k ORDER BY n DESC LIMIT ${TOP})`
}

/**
 * GET /api/ops/filters — the FilterBar's option lists (top 50 orgs,
 * countries, devices, browsers, OSes, paths) over the ≤ 5 000 newest sessions
 * in range: two statements in one batch. Cached 30 s.
 */
export default defineEventHandler(async (event): Promise<Filters> => {
  await requireAdmin(event)
  const q = parseOpsQuery(getQuery(event) as Record<string, unknown>)
  return opsCached(event, OPS_CACHE_TTL_MS, async () => {
    const w = parseWindow(q)
    const db = getDb(event)
    const where = buildWhere(q, w)
    const base = `WITH base AS MATERIALIZED (SELECT s.sid, s.as_org, s.country, s.device_type, s.browser, s.os FROM sessions s WHERE ${where.sql} ORDER BY s.started_at DESC LIMIT ${SAMPLE})`
    const res = await batchAll(db, [
      bindStmt(
        db,
        `${base} ${[
          topDim('orgs', 'as_org'),
          topDim('countries', 'country'),
          topDim('devices', 'device_type'),
          topDim('browsers', 'browser'),
          topDim('oses', 'os'),
        ].join(' UNION ALL ')}`,
        where.args,
      ),
      bindStmt(
        db,
        `${base} SELECT 'paths' AS dim, pv.path AS k, COUNT(*) AS n FROM page_visits pv JOIN base b ON b.sid = pv.sid GROUP BY k ORDER BY n DESC LIMIT ${TOP}`,
        where.args,
      ),
    ])
    const dims = splitDims([...(res[0] ?? []), ...(res[1] ?? [])], DIMS)
    return {
      orgs: dims.orgs,
      countries: dims.countries,
      devices: dims.devices,
      browsers: dims.browsers,
      oses: dims.oses,
      paths: dims.paths,
    }
  })
})
