// Pins tz.ts: offsetMin across the 2026 DST transitions in America/Boise, the
// Asia/Kolkata + Asia/Calcutta alias (+330, a half-hour zone), and the bucket
// helpers the ops API re-buckets with (contract D12).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bucket15, dayKey, hourIn, isKnownTz, offsetMin, startOfDayIn, weekdayIn } from '../../server/utils/tz.ts'

test('America/Boise: −420 before the 2026-03-08 spring-forward, −360 after; back on 2026-11-01', () => {
  // DST starts 2026-03-08 02:00 MST = 09:00 UTC.
  assert.equal(offsetMin('America/Boise', Date.UTC(2026, 2, 8, 8, 59, 0)), -420)
  assert.equal(offsetMin('America/Boise', Date.UTC(2026, 2, 8, 9, 0, 0)), -360)
  assert.equal(offsetMin('America/Boise', Date.UTC(2026, 2, 8, 12, 0, 0)), -360)
  // DST ends 2026-11-01 02:00 MDT = 08:00 UTC.
  assert.equal(offsetMin('America/Boise', Date.UTC(2026, 10, 1, 7, 59, 0)), -360)
  assert.equal(offsetMin('America/Boise', Date.UTC(2026, 10, 1, 8, 0, 0)), -420)
  // Mid-summer / mid-winter sanity.
  assert.equal(offsetMin('America/Boise', Date.UTC(2026, 6, 4, 12, 0, 0)), -360)
  assert.equal(offsetMin('America/Boise', Date.UTC(2026, 0, 15, 12, 0, 0)), -420)
})

test('Asia/Kolkata and its Asia/Calcutta alias are +330 all year', () => {
  for (const tz of ['Asia/Kolkata', 'Asia/Calcutta']) {
    assert.equal(offsetMin(tz, Date.UTC(2026, 0, 1)), 330, tz)
    assert.equal(offsetMin(tz, Date.UTC(2026, 6, 1)), 330, tz)
    assert.equal(isKnownTz(tz), true)
  }
  assert.equal(offsetMin('UTC', Date.UTC(2026, 5, 1)), 0)
  assert.equal(offsetMin('Etc/GMT+12', Date.UTC(2026, 5, 1)), -720)
})

test('unknown / empty zones yield null and are not valid', () => {
  assert.equal(offsetMin('Mars/Olympus_Mons', Date.UTC(2026, 0, 1)), null)
  assert.equal(offsetMin('', Date.UTC(2026, 0, 1)), null)
  assert.equal(offsetMin(null, Date.UTC(2026, 0, 1)), null)
  assert.equal(offsetMin(undefined, Date.UTC(2026, 0, 1)), null)
  assert.equal(isKnownTz('Mars/Olympus_Mons'), false)
  assert.equal(isKnownTz(''), false)
})

test('bucket15 floors to UTC quarter hours', () => {
  const t = Date.UTC(2026, 3, 5, 13, 44, 59, 999)
  assert.equal(bucket15(t), Date.UTC(2026, 3, 5, 13, 30, 0, 0))
  assert.equal(bucket15(Date.UTC(2026, 3, 5, 13, 45, 0, 0)), Date.UTC(2026, 3, 5, 13, 45, 0, 0))
})

test('day / hour / weekday helpers read the owner zone; startOfDayIn survives DST days', () => {
  const late = Date.UTC(2026, 3, 6, 3, 30) // 03:30 UTC Monday = 21:30 Sunday in Boise (MDT)
  assert.equal(dayKey(late, 'America/Boise'), '2026-04-05')
  assert.equal(hourIn(late, 'America/Boise'), 21)
  assert.equal(weekdayIn(late, 'America/Boise'), 0)
  assert.equal(dayKey(late, 'Asia/Kolkata'), '2026-04-06')
  assert.equal(hourIn(late, 'Asia/Kolkata'), 9)
  // Local midnight on the spring-forward day is 07:00 UTC (still MST at midnight).
  assert.equal(startOfDayIn(Date.UTC(2026, 2, 8, 20, 0), 'America/Boise'), Date.UTC(2026, 2, 8, 7, 0))
  // The day after: midnight is 06:00 UTC (MDT).
  assert.equal(startOfDayIn(Date.UTC(2026, 2, 9, 20, 0), 'America/Boise'), Date.UTC(2026, 2, 9, 6, 0))
  // Unknown zone falls back to UTC.
  assert.equal(dayKey(late, 'Nope/Nowhere'), '2026-04-06')
})
