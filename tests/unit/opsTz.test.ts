// Owner-timezone bucketing (contract B10 / D12, audit A4, R4-M2). The offset
// segments are checked against Intl, and the SQL fragments are RUN on
// node:sqlite — the engine D1 uses — so `daySql` is pinned to an INTEGER day
// index and the per-day sums are pinned across both US DST switches.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  TZ_DAY_MS,
  dayIdxOf,
  dayIdxToYmd,
  dayStart,
  daySql,
  dowSql,
  hourSql,
  isValidTz,
  listDays,
  localMsSql,
  tzOffsetMin,
  tzSegments,
} from '../../server/utils/opsTz.ts'
import { migratedDb, seedSession } from './_memdb.ts'

const BOISE = 'America/Boise'
const KOLKATA = 'Asia/Kolkata'

/** Epoch ms of a UTC wall clock. */
function utc(y: number, mo: number, d: number, h = 0, mi = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi)
}

test('isValidTz accepts IANA zones and rejects junk', () => {
  assert.equal(isValidTz(BOISE), true)
  assert.equal(isValidTz(KOLKATA), true)
  assert.equal(isValidTz('UTC'), true)
  assert.equal(isValidTz('Not/AZone'), false)
  assert.equal(isValidTz(''), false)
  assert.equal(isValidTz('x'.repeat(65)), false)
  assert.equal(isValidTz(42), false)
})

test('tzOffsetMin: Boise MST/MDT, Kolkata is a permanent +330', () => {
  assert.equal(tzOffsetMin(BOISE, utc(2026, 1, 15, 12)), -420) // MST
  assert.equal(tzOffsetMin(BOISE, utc(2026, 7, 15, 12)), -360) // MDT
  assert.equal(tzOffsetMin(KOLKATA, utc(2026, 1, 15, 12)), 330)
  assert.equal(tzOffsetMin(KOLKATA, utc(2026, 7, 15, 12)), 330)
})

test('tzSegments: one segment per transition, bisected to the minute', () => {
  // 2026-03-08 09:00 UTC = 02:00 MST → 03:00 MDT
  const spring = tzSegments(BOISE, utc(2026, 3, 1), utc(2026, 3, 15))
  assert.equal(spring.length, 2)
  assert.equal(spring[0]?.offMin, -420)
  assert.equal(spring[1]?.offMin, -360)
  assert.ok(Math.abs((spring[1]?.from ?? 0) - utc(2026, 3, 8, 9)) <= 60_000, `spring from ${spring[1]?.from}`)

  // 2026-11-01 08:00 UTC = 02:00 MDT → 01:00 MST
  const fall = tzSegments(BOISE, utc(2026, 10, 25), utc(2026, 11, 8))
  assert.equal(fall.length, 2)
  assert.equal(fall[0]?.offMin, -360)
  assert.equal(fall[1]?.offMin, -420)
  assert.ok(Math.abs((fall[1]?.from ?? 0) - utc(2026, 11, 1, 8)) <= 60_000, `fall from ${fall[1]?.from}`)

  // A zone without DST is one flat segment, minutes included.
  const kol = tzSegments(KOLKATA, utc(2026, 1, 1), utc(2026, 12, 31))
  assert.equal(kol.length, 1)
  assert.equal(kol[0]?.offMin, 330)
})

test('dayStart lands on local midnight on both DST days', () => {
  // The 23-hour day: local midnight is 07:00 UTC.
  assert.equal(dayStart(BOISE, utc(2026, 3, 8, 18)), utc(2026, 3, 8, 7))
  // The 25-hour day: local midnight is 06:00 UTC (still MDT).
  assert.equal(dayStart(BOISE, utc(2026, 11, 1, 18)), utc(2026, 11, 1, 6))
  // +05:30 midnight is 18:30 UTC the day before.
  assert.equal(dayStart(KOLKATA, utc(2026, 6, 10, 12)), utc(2026, 6, 9, 18, 30))
})

test('dayIdxOf / dayIdxToYmd / listDays agree on the owner day', () => {
  assert.equal(dayIdxToYmd(dayIdxOf(BOISE, utc(2026, 3, 8, 8))), '2026-03-08') // 01:00 MST
  assert.equal(dayIdxToYmd(dayIdxOf(BOISE, utc(2026, 3, 9, 5, 59))), '2026-03-08') // 23:59 MDT
  assert.equal(dayIdxToYmd(dayIdxOf(KOLKATA, utc(2026, 6, 9, 19))), '2026-06-10') // 00:30 IST
  // [local midnight 03-08, local midnight 03-11) — MST turns into MDT inside it.
  assert.deepEqual(listDays(BOISE, utc(2026, 3, 8, 7), utc(2026, 3, 11, 6)), ['2026-03-08', '2026-03-09', '2026-03-10'])
  assert.deepEqual(listDays(BOISE, 0, utc(2026, 3, 11, 6), 2), ['2026-03-09', '2026-03-10'])
})

// ---------------------------------------------------------------- on SQLite

test('daySql / hourSql / dowSql return INTEGERs on SQLite', () => {
  const db = migratedDb()
  const segs = tzSegments(BOISE, utc(2026, 3, 1), utc(2026, 11, 8))
  const local = localMsSql('s.started_at', segs)
  // 03:30 UTC on 2026-03-08 = 20:30 MST on Sunday 2026-03-07.
  seedSession(db, 'a-1', { startedAt: utc(2026, 3, 8, 3, 30) })
  const row = db
    .prepare(
      `SELECT ${daySql(local.sql)} AS d, typeof(${daySql(local.sql)}) AS dt, `
        + `${hourSql(local.sql)} AS h, typeof(${hourSql(local.sql)}) AS ht, `
        + `${dowSql(local.sql)} AS dow, typeof(${dowSql(local.sql)}) AS dowt FROM sessions s`,
    )
    .get(...local.args, ...local.args, ...local.args, ...local.args, ...local.args, ...local.args) as Record<string, unknown>
  assert.equal(row.dt, 'integer')
  assert.equal(row.ht, 'integer')
  assert.equal(row.dowt, 'integer')
  assert.equal(dayIdxToYmd(Number(row.d)), '2026-03-07')
  assert.equal(row.h, 20)
  assert.equal(row.dow, 6) // Saturday
  db.close()
})

test('per-day sums land in the owner zone across the 23-hour spring day', () => {
  const db = migratedDb()
  const segs = tzSegments(BOISE, utc(2026, 3, 6), utc(2026, 3, 11))
  const local = localMsSql('s.started_at', segs)
  const rows: [string, number][] = [
    ['s-1', utc(2026, 3, 8, 6, 59)], // 23:59 MST → still 2026-03-07
    ['s-2', utc(2026, 3, 8, 7, 1)], // 00:01 MST → 2026-03-08
    ['s-3', utc(2026, 3, 8, 12)], // 06:00 MDT → 2026-03-08
    ['s-4', utc(2026, 3, 9, 5, 59)], // 23:59 MDT → still 2026-03-08
    ['s-5', utc(2026, 3, 9, 6, 1)], // 00:01 MDT → 2026-03-09
  ]
  for (const [sid, at] of rows) seedSession(db, sid, { startedAt: at })
  const out = db
    .prepare(`SELECT ${daySql(local.sql)} AS d, COUNT(*) AS n FROM sessions s GROUP BY d ORDER BY d`)
    .all(...local.args) as { d: number; n: number }[]
  assert.deepEqual(
    out.map((r) => [dayIdxToYmd(Number(r.d)), Number(r.n)]),
    [
      ['2026-03-07', 1],
      ['2026-03-08', 3],
      ['2026-03-09', 1],
    ],
  )
  db.close()
})

test('per-day sums across the 25-hour autumn day, and +05:30 minutes are exact', () => {
  const db = migratedDb()
  const segs = tzSegments(BOISE, utc(2026, 10, 30), utc(2026, 11, 4))
  const local = localMsSql('s.started_at', segs)
  for (const [sid, at] of [
    ['f-1', utc(2026, 11, 1, 5, 59)], // 23:59 MDT → 2026-10-31
    ['f-2', utc(2026, 11, 1, 7)], // 01:00 MDT (before the switch) → 2026-11-01
    ['f-3', utc(2026, 11, 1, 9)], // 02:00 MST (after) → 2026-11-01
    ['f-4', utc(2026, 11, 2, 7)], // 00:00 MST → 2026-11-02
  ] as [string, number][]) seedSession(db, sid, { startedAt: at })
  const out = db
    .prepare(`SELECT ${daySql(local.sql)} AS d, COUNT(*) AS n FROM sessions s GROUP BY d ORDER BY d`)
    .all(...local.args) as { d: number; n: number }[]
  assert.deepEqual(
    out.map((r) => [dayIdxToYmd(Number(r.d)), Number(r.n)]),
    [
      ['2026-10-31', 1],
      ['2026-11-01', 2],
      ['2026-11-02', 1],
    ],
  )
  db.close()

  const db2 = migratedDb()
  const kol = localMsSql('s.started_at', tzSegments(KOLKATA, utc(2026, 6, 1), utc(2026, 6, 30)))
  seedSession(db2, 'k-1', { startedAt: utc(2026, 6, 9, 18, 29) }) // 23:59 IST → 2026-06-09
  seedSession(db2, 'k-2', { startedAt: utc(2026, 6, 9, 18, 31) }) // 00:01 IST → 2026-06-10
  const kRows = db2
    .prepare(`SELECT ${daySql(kol.sql)} AS d, COUNT(*) AS n FROM sessions s GROUP BY d ORDER BY d`)
    .all(...kol.args) as { d: number; n: number }[]
  assert.deepEqual(
    kRows.map((r) => dayIdxToYmd(Number(r.d))),
    ['2026-06-09', '2026-06-10'],
  )
  assert.equal(kol.args.length, 1) // one flat offset, bound in ms
  assert.equal(kol.args[0], 330 * 60_000)
  db2.close()
})

test('TZ_DAY_MS is a day and a local-ms fragment with no segments is a no-op', () => {
  assert.equal(TZ_DAY_MS, 86_400_000)
  const none = localMsSql('x', [])
  assert.equal(none.sql, '(x)')
  assert.deepEqual(none.args, [])
})
