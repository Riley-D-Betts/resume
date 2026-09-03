// server/utils/opsPercentile.ts — the D27 percentile query: window functions
// over a MATERIALIZED sample of <= 5 000 rows, picking the rows whose rank
// equals ceil(n * p) in integer math — no CEIL, no JS sorting. PURE.

import type { PerfMetric, Percentiles } from '../../shared/analytics/ops.ts'

export const SAMPLE_LIMIT = 5000

export const PERF_METRICS: readonly { metric: PerfMetric; col: string }[] = [
  { metric: 'ttfb', col: 'ttfb_ms' },
  { metric: 'fcp', col: 'fcp_ms' },
  { metric: 'lcp', col: 'lcp_ms' },
  { metric: 'cls', col: 'cls' },
  { metric: 'inp', col: 'inp_ms' },
  { metric: 'dcl', col: 'dcl_ms' },
  { metric: 'load', col: 'load_ms' },
  { metric: 'softNav', col: 'soft_nav_ms' },
]

/** Integer-math rank targets: (n * p + 99) / 100 == ceil(n * p / 100). */
export function percentileTargets(n: number): { p50: number; p75: number; p95: number } {
  return {
    p50: Math.floor((n * 50 + 99) / 100),
    p75: Math.floor((n * 75 + 99) / 100),
    p95: Math.floor((n * 95 + 99) / 100),
  }
}

/**
 * Wrap `SELECT key, metric, v FROM ...` so only the p50 / p75 / p95 rows of
 * every (key, metric) partition come back, with their rank and partition size.
 */
export function percentileSelect(inner: string): string {
  return (
    'SELECT key, metric, v, rn, n FROM ('
    + 'SELECT key, metric, v, ROW_NUMBER() OVER (PARTITION BY key, metric ORDER BY v) AS rn, '
    + `COUNT(*) OVER (PARTITION BY key, metric) AS n FROM (${inner})`
    + ') WHERE rn IN ((n * 50 + 99) / 100, (n * 75 + 99) / 100, (n * 95 + 99) / 100)'
  )
}

export interface PercentileRow {
  key: string
  metric: string
  v: number
  rn: number
  n: number
}

export function percentileKey(key: string, metric: string): string {
  return `${key} ${metric}`
}

/** Rows of `percentileSelect` -> one Percentiles per (key, metric). */
export function foldPercentiles(rows: readonly PercentileRow[]): Map<string, Percentiles> {
  const out = new Map<string, Percentiles>()
  for (const r of rows) {
    const id = percentileKey(String(r.key), String(r.metric))
    let p = out.get(id)
    if (!p) {
      p = { p50: null, p75: null, p95: null, n: Number(r.n) }
      out.set(id, p)
    }
    const t = percentileTargets(Number(r.n))
    const v = Number(r.v)
    if (r.rn === t.p50) p.p50 = v
    if (r.rn === t.p75) p.p75 = v
    if (r.rn === t.p95) p.p95 = v
  }
  return out
}

/**
 * The Performance view's one percentile statement (contract D.2): a sample of
 * the newest <= 5 000 page_perf rows in range, the top `keyLimit` keys of
 * `dimExpr`, eight metrics x (key + '(all)'). Bind: [tsStart, tsEnd, ...whereArgs].
 *
 * The metric columns are unpivoted with `json_each` + one CASE per row rather
 * than one UNION ALL term per metric: workerd's SQLite (D1) rejects compound
 * SELECTs beyond 5 terms, and 8 metrics x 2 would be 16.
 */
export function perfPercentileSql(dimExpr: string, whereSql: string, keyLimit = 12): string {
  const cols = PERF_METRICS.map((m) => `p.${m.col}`).join(', ')
  const metrics = JSON.stringify(PERF_METRICS.map((m) => m.metric))
  const v = `CASE m.value ${PERF_METRICS.map((m) => `WHEN '${m.metric}' THEN b.${m.col}`).join(' ')} END`
  return (
    `WITH base AS MATERIALIZED (SELECT COALESCE(NULLIF(${dimExpr}, ''), '(unknown)') AS key, ${cols} `
    + `FROM page_perf p JOIN sessions s ON s.sid = p.sid WHERE p.ts >= ? AND p.ts < ? AND ${whereSql} `
    + `ORDER BY p.ts DESC LIMIT ${SAMPLE_LIMIT}), `
    + `keys AS (SELECT key FROM base GROUP BY key ORDER BY COUNT(*) DESC LIMIT ${keyLimit}), `
    + `u AS (SELECT b.key AS key, m.value AS metric, ${v} AS v FROM base b JOIN keys k ON k.key = b.key CROSS JOIN json_each('${metrics}') m `
    + `UNION ALL SELECT '(all)', m.value, ${v} FROM base b CROSS JOIN json_each('${metrics}') m) `
    + percentileSelect('SELECT key, metric, v FROM u WHERE v IS NOT NULL')
  )
}
