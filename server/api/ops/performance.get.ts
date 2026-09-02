import type { H3Event } from 'h3'
import type { KN, OpsQuery, PerfMetric, Percentiles, Performance } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { OPS_CACHE_TTL_MS, opsCached } from '../../utils/opsCache'
import type { Row } from '../../utils/opsDb'
import { batchAll, bindStmt, splitDims, toNum, toStr, unionChunks } from '../../utils/opsDb'
import type { WhereParts } from '../../utils/opsFilters'
import { buildWhere, parseOpsQuery, parseWindow } from '../../utils/opsFilters'
import type { PercentileRow } from '../../utils/opsPercentile'
import { PERF_METRICS, SAMPLE_LIMIT, foldPercentiles, percentileKey, percentileSelect, perfPercentileSql } from '../../utils/opsPercentile'
import { dayIdxToYmd, daySql, localMsSql, tzSegments } from '../../utils/opsTz'

type Dim = NonNullable<OpsQuery['dim']>

const DIM_EXPR: Record<Dim, string> = {
  device: 's.device_type',
  browser: 's.browser',
  os: 's.os',
  country: 's.country',
  path: 'p.path',
  protocol: 'p.protocol',
}

/** Histogram bin widths (ms; cls in 1/20 units). */
const HIST: readonly { metric: PerfMetric; col: string; width: number; expr: string }[] = [
  { metric: 'lcp', col: 'lcp_ms', width: 250, expr: 'lcp_ms / 250' },
  { metric: 'fcp', col: 'fcp_ms', width: 250, expr: 'fcp_ms / 250' },
  { metric: 'ttfb', col: 'ttfb_ms', width: 100, expr: 'ttfb_ms / 100' },
  { metric: 'inp', col: 'inp_ms', width: 50, expr: 'inp_ms / 50' },
  { metric: 'cls', col: 'cls', width: 0.05, expr: 'CAST(cls * 20 AS INTEGER)' },
]
const HIST_MAX_BIN = 40

const NAV_PHASES: readonly { phase: string; col: string }[] = [
  { phase: 'dns', col: 'dns_ms' },
  { phase: 'connect', col: 'connect_ms' },
  { phase: 'tls', col: 'tls_ms' },
  { phase: 'request', col: 'request_ms' },
  { phase: 'response', col: 'response_ms' },
  { phase: 'domInteractive', col: 'dom_interactive_ms' },
  { phase: 'dcl', col: 'dcl_ms' },
  { phase: 'load', col: 'load_ms' },
]

const NET_DIMS = ['rtt', 'protocol', 'tls', 'cipher', 'colo'] as const

function baseSql(cols: string, where: WhereParts, extra = ''): string {
  return (
    `WITH base AS MATERIALIZED (SELECT ${cols} FROM page_perf p JOIN sessions s ON s.sid = p.sid `
    + `WHERE p.ts >= ? AND p.ts < ? AND ${where.sql}${extra} ORDER BY p.ts DESC LIMIT ${SAMPLE_LIMIT})`
  )
}

function emptyP(): Percentiles {
  return { p50: 0, p75: 0, p95: 0, n: 0 }
}

async function build(event: H3Event, q: OpsQuery): Promise<Performance> {
  const w = parseWindow(q)
  const db = getDb(event)
  const where = buildWhere(q, w)
  const dim: Dim = q.dim ?? 'device'
  const args = [w.start, w.end, ...where.args]
  const local = localMsSql('p.ts', tzSegments(w.tz, w.start, w.end))

  const histSql = HIST.map(
    (h, i) => `SELECT '${h.metric}' AS metric, MIN(${h.expr}, ${HIST_MAX_BIN}) AS b, COUNT(*) AS n FROM base WHERE ${h.col} IS NOT NULL GROUP BY ${i === 0 ? 'b' : '2'}`,
  ).join(' UNION ALL ')
  // 8 phases → ≤ 5 UNION ALL terms per statement (workerd's compound-SELECT cap).
  // Every (key, metric) is its own percentile partition, so splitting the
  // phases across statements does not change a single value.
  const navChunks = unionChunks(
    NAV_PHASES.map((p) => `SELECT '(all)' AS key, '${p.phase}' AS metric, ${p.col} AS v FROM base WHERE ${p.col} IS NOT NULL`),
  )
  const navStmt = (union: string) =>
    bindStmt(db, `${baseSql(NAV_PHASES.map((p) => `p.${p.col}`).join(', '), where)} ${percentileSelect(union)}`, args)
  const netDim = (d: string, expr: string): string =>
    `SELECT * FROM (SELECT '${d}' AS dim, ${expr} AS k, COUNT(*) AS n FROM nb GROUP BY k ORDER BY n DESC LIMIT 12)`
  const rttExpr =
    "CASE WHEN client_rtt_ms IS NULL THEN '(unknown)' WHEN client_rtt_ms < 50 THEN '<50 ms' WHEN client_rtt_ms < 100 THEN '50-100 ms' "
    + "WHEN client_rtt_ms < 200 THEN '100-200 ms' WHEN client_rtt_ms < 500 THEN '200-500 ms' ELSE '500+ ms' END"

  const res = await batchAll(db, [
    /* 0 percentiles */ bindStmt(db, perfPercentileSql(DIM_EXPR[dim], where.sql), args),
    /* 1 lcp series */ bindStmt(
      db,
      `WITH base AS MATERIALIZED (SELECT ${daySql(local.sql)} AS key, 'lcp' AS metric, p.lcp_ms AS v FROM page_perf p JOIN sessions s ON s.sid = p.sid `
        + `WHERE p.lcp_ms IS NOT NULL AND p.ts >= ? AND p.ts < ? AND ${where.sql} ORDER BY p.ts DESC LIMIT ${SAMPLE_LIMIT}) `
        + percentileSelect('SELECT key, metric, v FROM base'),
      [...local.args, ...args],
    ),
    /* 2 hist */ bindStmt(db, `${baseSql('p.lcp_ms, p.fcp_ms, p.ttfb_ms, p.inp_ms, p.cls', where)} ${histSql}`, args),
    /* 3 nav (first chunk; the rest follow slot 7) */ navStmt(navChunks[0] ?? ''),
    /* 4 lcp elements */ bindStmt(
      db,
      `${baseSql('p.lcp_sel, p.lcp_ms', where)}, keys AS (SELECT lcp_sel FROM base WHERE lcp_sel IS NOT NULL GROUP BY lcp_sel ORDER BY COUNT(*) DESC LIMIT 12) `
        + percentileSelect("SELECT b.lcp_sel AS key, 'lcp' AS metric, b.lcp_ms AS v FROM base b JOIN keys k ON k.lcp_sel = b.lcp_sel WHERE b.lcp_ms IS NOT NULL"),
      args,
    ),
    /* 5 slowest resources */ bindStmt(
      db,
      `WITH r AS MATERIALIZED (SELECT p.res_slowest FROM page_perf p JOIN sessions s ON s.sid = p.sid WHERE p.res_slowest IS NOT NULL AND p.ts >= ? AND p.ts < ? AND ${where.sql} `
        + 'ORDER BY p.ts DESC LIMIT 500), '
        + "x AS (SELECT json_extract(j.value, '$.name') AS name, CAST(json_extract(j.value, '$.dur') AS REAL) AS dur FROM r, json_each(r.res_slowest) j "
        + "WHERE json_extract(j.value, '$.name') IS NOT NULL), "
        + 'k AS (SELECT name FROM x GROUP BY name ORDER BY COUNT(*) DESC LIMIT 20) '
        + percentileSelect("SELECT x.name AS key, 'dur' AS metric, x.dur AS v FROM x JOIN k ON k.name = x.name"),
      args,
    ),
    /* 6 tiles */ bindStmt(
      db,
      `${baseSql('p.res_count, p.res_bytes, p.res_cached, p.long_tasks, p.long_task_ms, p.long_task_max_ms, p.loaf_count, p.loaf_ms, p.loaf_max_ms', where)}, `
        + 'lt AS (SELECT long_task_max_ms AS v, ROW_NUMBER() OVER (ORDER BY long_task_max_ms) AS rn, COUNT(*) OVER () AS n FROM base WHERE long_task_max_ms IS NOT NULL), '
        + 'lf AS (SELECT loaf_max_ms AS v, ROW_NUMBER() OVER (ORDER BY loaf_max_ms) AS rn, COUNT(*) OVER () AS n FROM base WHERE loaf_max_ms IS NOT NULL) '
        + 'SELECT (SELECT COUNT(*) FROM base) AS n, COALESCE(AVG(res_count), 0) AS avgCount, COALESCE(AVG(res_bytes), 0) AS avgBytes, COALESCE(AVG(res_cached), 0) AS avgCached, '
        + 'COALESCE(SUM(long_tasks > 0), 0) AS ltPages, COALESCE(AVG(long_task_ms), 0) AS ltAvg, (SELECT v FROM lt WHERE rn = (n * 95 + 99) / 100) AS ltP95, '
        + 'COALESCE(SUM(loaf_count > 0), 0) AS lfPages, COALESCE(AVG(loaf_ms), 0) AS lfAvg, (SELECT v FROM lf WHERE rn = (n * 95 + 99) / 100) AS lfP95, '
        + `(SELECT COUNT(*) FROM page_perf p JOIN sessions s ON s.sid = p.sid WHERE p.ts >= ? AND p.ts < ? AND ${where.sql}) AS total FROM base`,
      [...args, ...args],
    ),
    /* 7 network */ bindStmt(
      db,
      'WITH nb AS MATERIALIZED (SELECT n.client_rtt_ms, n.http_protocol, n.tls_version, n.tls_cipher, n.colo FROM session_net n JOIN sessions s ON s.sid = n.sid '
        + `WHERE ${where.sql} ORDER BY s.started_at DESC LIMIT ${SAMPLE_LIMIT}) `
        + [
          netDim('rtt', rttExpr),
          netDim('protocol', "COALESCE(NULLIF(http_protocol, ''), '(unknown)')"),
          netDim('tls', "COALESCE(NULLIF(tls_version, ''), '(unknown)')"),
          netDim('cipher', "COALESCE(NULLIF(tls_cipher, ''), '(unknown)')"),
          netDim('colo', "COALESCE(NULLIF(colo, ''), '(unknown)')"),
        ].join(' UNION ALL '),
      where.args,
    ),
    /* 8+ nav (remaining chunks) */ ...navChunks.slice(1).map(navStmt),
  ])
  const at = (i: number): Row[] => res[i] ?? []
  const navRows = [...at(3), ...navChunks.slice(1).flatMap((_, i) => at(8 + i))]

  const p = foldPercentiles(at(0) as unknown as PercentileRow[])
  const vitals = PERF_METRICS.map((m) => ({ metric: m.metric, ...(p.get(percentileKey('(all)', m.metric)) ?? emptyP()) }))
  const byDim: Performance['byDim'] = []
  for (const [id, pc] of p) {
    const sp = id.lastIndexOf(' ') // metrics never contain spaces; keys (browser names, paths) may
    const key = id.slice(0, sp)
    const metric = id.slice(sp + 1) as PerfMetric
    if (key !== '(all)') byDim.push({ key, metric, ...pc })
  }

  const lcpSeries = [...foldPercentiles(at(1) as unknown as PercentileRow[])]
    .map(([id, pc]) => ({ day: dayIdxToYmd(Number(id.slice(0, id.lastIndexOf(' ')))), p75: pc.p75, n: pc.n }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))

  const histRows = at(2)
  const hist = HIST.map((h) => ({
    metric: h.metric,
    bins: histRows
      .filter((r) => r.metric === h.metric)
      .map((r) => {
        const b = toNum(r.b)
        return { from: Math.round(b * h.width * 1000) / 1000, to: Math.round((b + 1) * h.width * 1000) / 1000, n: toNum(r.n) }
      })
      .sort((a, b) => a.from - b.from),
  }))

  const nav = foldPercentiles(navRows as unknown as PercentileRow[])
  const navBreakdown = NAV_PHASES.map((ph) => ({ phase: ph.phase, p50: nav.get(percentileKey('(all)', ph.phase))?.p50 ?? 0 }))

  const lcpElements = [...foldPercentiles(at(4) as unknown as PercentileRow[])]
    .map(([id, pc]) => ({ sel: id.slice(0, id.lastIndexOf(' ')), n: pc.n, p75: pc.p75 }))
    .sort((a, b) => b.n - a.n)

  const slowest = [...foldPercentiles(at(5) as unknown as PercentileRow[])]
    .map(([id, pc]) => ({ name: id.slice(0, id.lastIndexOf(' ')), n: pc.n, p75Ms: Math.round(pc.p75) }))
    .sort((a, b) => b.n - a.n)

  const t = res[6]?.[0] ?? {}
  const net = splitDims(at(7), NET_DIMS)
  const knList = (rows: KN[]): KN[] => rows

  return {
    dim,
    vitals,
    byDim,
    sampled: { n: toNum(t.n), total: toNum(t.total) },
    lcpSeries,
    hist,
    navBreakdown,
    lcpElements,
    resources: {
      avgCount: Math.round(toNum(t.avgCount)),
      avgBytes: Math.round(toNum(t.avgBytes)),
      avgCached: Math.round(toNum(t.avgCached)),
      slowest,
    },
    longTasks: { pagesWithAny: toNum(t.ltPages), avgTotalMs: Math.round(toNum(t.ltAvg)), p95Longest: toNum(t.ltP95) },
    loaf: { pagesWithAny: toNum(t.lfPages), avgTotalMs: Math.round(toNum(t.lfAvg)), p95Longest: toNum(t.lfP95) },
    rtt: net.rtt.map((r) => ({ bucket: toStr(r.k) ?? '(unknown)', n: r.n })),
    protocol: knList(net.protocol),
    tls: knList(net.tls),
    cipher: knList(net.cipher),
    colo: knList(net.colo),
  }
}

/**
 * GET /api/ops/performance?dim=device|browser|os|country|path|protocol —
 * p50 / p75 / p95 for 8 metrics overall and by `dim` (one D27 window query
 * over a MATERIALIZED ≤ 5 000-row sample), LCP p75 per owner-tz day, SQL
 * histograms, nav-phase p50s, LCP elements, slowest resources (newest 500
 * res_slowest JSON via json_each), long tasks / LoAF, RTT / protocol / TLS /
 * cipher / colo distributions. One D1 batch. Cached 30 s.
 */
export default defineEventHandler(async (event): Promise<Performance> => {
  await requireAdmin(event)
  const q = parseOpsQuery(getQuery(event) as Record<string, unknown>)
  return opsCached(event, OPS_CACHE_TTL_MS, () => build(event, q))
})
