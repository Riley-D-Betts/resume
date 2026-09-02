import type { Cohorts, FreqBucket, HeatCell, RecencyBucket } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { OPS_CACHE_TTL_MS, opsCached } from '../../utils/opsCache'
import { batchAll, bindStmt, toNum } from '../../utils/opsDb'
import { buildWhere, parseOpsQuery, parseWindow } from '../../utils/opsFilters'
import { TZ_DAY_MS, dowSql, hourSql, localMsSql, tzSegments } from '../../utils/opsTz'

const RECENCY: readonly RecencyBucket[] = ['<1d', '1-7d', '7-30d', '30-90d', '90d+']
const FREQ: readonly FreqBucket[] = ['1', '2-3', '4-9', '10+']

/**
 * GET /api/ops/cohorts — visitors with ≥ 1 session in the window: recency
 * (relative to window.end) × frequency (visit_count) matrix with marginals,
 * returning share, and the owner-tz day × hour heatmap of their sessions.
 * Cached 30 s.
 */
export default defineEventHandler(async (event): Promise<Cohorts> => {
  await requireAdmin(event)
  const q = parseOpsQuery(getQuery(event) as Record<string, unknown>)
  return opsCached(event, OPS_CACHE_TTL_MS, async () => {
    const w = parseWindow(q)
    const db = getDb(event)
    const where = buildWhere(q, w)
    const local = localMsSql('s.started_at', tzSegments(w.tz, w.start, w.end))
    const d = TZ_DAY_MS
    const res = await batchAll(db, [
      bindStmt(
        db,
        `WITH vs AS (SELECT DISTINCT s.vid FROM sessions s WHERE ${where.sql}), `
          + 'x AS (SELECT (? - v.last_seen_at) AS age, v.visit_count AS vc FROM visitors v JOIN vs ON vs.vid = v.vid) '
          + `SELECT CASE WHEN age < ${d} THEN 0 WHEN age < ${7 * d} THEN 1 WHEN age < ${30 * d} THEN 2 WHEN age < ${90 * d} THEN 3 ELSE 4 END AS rec, `
          + 'CASE WHEN vc <= 1 THEN 0 WHEN vc <= 3 THEN 1 WHEN vc <= 9 THEN 2 ELSE 3 END AS freq, COUNT(*) AS n, '
          + 'COALESCE(SUM(vc > 1), 0) AS returningN FROM x GROUP BY rec, freq',
        [...where.args, w.end],
      ),
      bindStmt(
        db,
        `WITH b AS (SELECT ${local.sql} AS lt FROM sessions s WHERE ${where.sql}) `
          + `SELECT ${dowSql('lt')} AS dow, ${hourSql('lt')} AS hour, COUNT(*) AS n FROM b GROUP BY dow, hour`,
        [...local.args, ...where.args],
      ),
    ])
    const matrix: number[][] = RECENCY.map(() => FREQ.map(() => 0))
    let visitors = 0
    let returning = 0
    for (const r of res[0] ?? []) {
      const rec = Math.min(4, Math.max(0, toNum(r.rec)))
      const freq = Math.min(3, Math.max(0, toNum(r.freq)))
      const n = toNum(r.n)
      const row = matrix[rec]
      if (row) row[freq] = (row[freq] ?? 0) + n
      visitors += n
      returning += toNum(r.returningN)
    }
    const heatmap: HeatCell[] = (res[1] ?? []).map((r) => ({ dow: toNum(r.dow), hour: toNum(r.hour), n: toNum(r.n) }))
    return {
      recency: RECENCY.map((bucket, i) => ({ bucket, n: (matrix[i] ?? []).reduce((a, b) => a + b, 0) })),
      frequency: FREQ.map((bucket, j) => ({ bucket, n: matrix.reduce((a, row) => a + (row[j] ?? 0), 0) })),
      matrix,
      returningShare: visitors > 0 ? Math.round((returning / visitors) * 1000) / 10 : 0,
      heatmap,
      visitors,
    }
  })
})
