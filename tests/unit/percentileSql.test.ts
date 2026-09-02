// Runs the D27 window-function percentile query (server/utils/opsPercentile.ts)
// on node:sqlite against seeded page_perf rows and checks p50 / p75 / p95 —
// with the shared buildWhere() predicate, the way performance.get.ts binds it.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  foldPercentiles,
  percentileKey,
  percentileSelect,
  percentileTargets,
  perfPercentileSql,
} from '../../server/utils/opsPercentile.ts'
import type { PercentileRow } from '../../server/utils/opsPercentile.ts'
import { buildWhere, parseWindow } from '../../server/utils/opsFilters.ts'
import { migratedDb, seedSession } from './_memdb.ts'

const T0 = 1_700_000_000_000

test('percentileTargets: integer ceil(n·p)', () => {
  assert.deepEqual(percentileTargets(1), { p50: 1, p75: 1, p95: 1 })
  assert.deepEqual(percentileTargets(4), { p50: 2, p75: 3, p95: 4 })
  assert.deepEqual(percentileTargets(10), { p50: 5, p75: 8, p95: 10 })
  assert.deepEqual(percentileTargets(100), { p50: 50, p75: 75, p95: 95 })
  assert.deepEqual(percentileTargets(0), { p50: 0, p75: 0, p95: 0 })
})

test('perf percentiles over seeded page_perf rows, by device and (all)', () => {
  const db = migratedDb()
  // desktop: lcp 1..100 → p50 = 50, p75 = 75, p95 = 95
  // mobile:  lcp 200..209 (10 values) → p50 = 204, p75 = 207, p95 = 209
  // bot:     lcp 9999 — excluded by the default bots filter
  const insertPerf = db.prepare(
    'INSERT INTO page_perf (pvid, sid, ts, path, lcp_ms, ttfb_ms, cls, soft_nav_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  for (let i = 1; i <= 100; i++) {
    const sid = `d-${String(i).padStart(3, '0')}`
    seedSession(db, sid, { startedAt: T0 + i * 1000, device: 'desktop' })
    insertPerf.run(`pv-${sid}`, sid, T0 + i * 1000, '/', i, i * 2, 0.01 * i, i % 2 === 0 ? i : null)
  }
  for (let i = 0; i < 10; i++) {
    const sid = `m-${i}`
    seedSession(db, sid, { startedAt: T0 + 500_000 + i * 1000, device: 'mobile' })
    insertPerf.run(`pv-${sid}`, sid, T0 + 500_000 + i * 1000, '/employee', 200 + i, null, null, null)
  }
  seedSession(db, 'bot-1', { startedAt: T0 + 900_000, device: 'desktop', isBot: 1 })
  insertPerf.run('pv-bot', 'bot-1', T0 + 900_000, '/', 9999, null, null, null)

  const now = T0 + 1_000_000
  const w = parseWindow({ range: '24h' }, now)
  const where = buildWhere({ range: '24h' }, w, 's')
  const sql = perfPercentileSql('s.device_type', where.sql)
  const rows = db.prepare(sql).all(w.start, w.end, ...(where.args as (string | number)[])) as unknown as PercentileRow[]
  const p = foldPercentiles(rows)

  const all = p.get(percentileKey('(all)', 'lcp'))
  assert.ok(all)
  assert.equal(all.n, 110)
  // 110 values: 1..100, 200..209 → rank 55 = 55, rank 83 = 83, rank 105 = 204
  assert.deepEqual(all, { p50: 55, p75: 83, p95: 204, n: 110 })

  const desktop = p.get(percentileKey('desktop', 'lcp'))
  assert.deepEqual(desktop, { p50: 50, p75: 75, p95: 95, n: 100 })

  const mobile = p.get(percentileKey('mobile', 'lcp'))
  assert.deepEqual(mobile, { p50: 204, p75: 207, p95: 209, n: 10 })

  // ttfb only on desktop rows (2..200 step 2) → p50 = 100, p75 = 150, p95 = 190
  assert.deepEqual(p.get(percentileKey('desktop', 'ttfb')), { p50: 100, p75: 150, p95: 190, n: 100 })
  assert.equal(p.get(percentileKey('mobile', 'ttfb')), undefined)

  // softNav on even desktop rows only (50 values: 2,4,…,100) → p50 = 50, p75 = 76, p95 = 96
  assert.deepEqual(p.get(percentileKey('(all)', 'softNav')), { p50: 50, p75: 76, p95: 96, n: 50 })

  // cls is REAL and survives
  const cls = p.get(percentileKey('desktop', 'cls'))
  assert.ok(cls)
  assert.ok(Math.abs(cls.p50 - 0.5) < 1e-9 && Math.abs(cls.p95 - 0.95) < 1e-9)

  // the bot row is filtered out, and bots=1 brings it back at the top
  const whereBots = buildWhere({ range: '24h', bots: '1' }, w, 's')
  const rowsBots = db
    .prepare(perfPercentileSql('s.device_type', whereBots.sql))
    .all(w.start, w.end, ...(whereBots.args as (string | number)[])) as unknown as PercentileRow[]
  const allBots = foldPercentiles(rowsBots).get(percentileKey('(all)', 'lcp'))
  assert.ok(allBots)
  assert.equal(allBots.n, 111)
  assert.equal(allBots.p95, 205)
  db.close()
})

test('percentileSelect on an ad-hoc partition (n = 1 collapses all three ranks)', () => {
  const db = migratedDb()
  const sql = percentileSelect("SELECT 'k' AS key, 'm' AS metric, 42 AS v")
  const rows = db.prepare(sql).all() as unknown as PercentileRow[]
  assert.equal(rows.length, 1)
  assert.deepEqual(foldPercentiles(rows).get(percentileKey('k', 'm')), { p50: 42, p75: 42, p95: 42, n: 1 })
  db.close()
})

test('the query plan uses idx_page_perf_ts for the sample', () => {
  const db = migratedDb()
  const w = parseWindow({ range: '7d' }, T0)
  const where = buildWhere({}, w, 's')
  const plan = db
    .prepare(`EXPLAIN QUERY PLAN ${perfPercentileSql('s.device_type', where.sql)}`)
    .all(w.start, w.end, ...(where.args as (string | number)[])) as { detail: string }[]
  assert.ok(plan.some((r) => /SEARCH p USING INDEX idx_page_perf_ts/.test(r.detail)), plan.map((r) => r.detail).join(' | '))
  db.close()
})
