// Pins the retention band walker (audit R2-H1): the nightly prune anchors on
// the OLDEST un-pruned row and walks upward in 48 h bands, so a backlog older
// than MAX_BANDS × 48 h below the cutoff still drains — the previous walk
// started at the cutoff and stopped at the first empty band, which could never
// reach further than 16 days below it.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planPruneBands } from '../../server/utils/d1.ts'
import { migratedDb, seedSession } from './_memdb.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const BAND = 48 * HOUR
const MAX_BANDS = 8

/** The SQL prune.ts runs, mirrored here so the plan is exercised on real SQLite. */
const PERF_ANCHOR = 'SELECT MIN(ts) AS oldest FROM page_perf WHERE ts < ?'
const PERF_BAND = 'DELETE FROM page_perf WHERE ts >= ? AND ts < ?'
// The session-band steps anchor in the band's own units (sessions.started_at),
// not on the child row's timestamp: an event's ts sits ABOVE its session's
// started_at, so a ts anchor would put the first band past the session and the
// walk would stall on it forever.
const EVENTS_ANCHOR
  = 'SELECT started_at AS oldest FROM sessions WHERE started_at < ? AND EXISTS (SELECT 1 FROM events e WHERE e.sid = sessions.sid) ORDER BY started_at LIMIT 1'
const EVENTS_BAND = 'DELETE FROM events WHERE sid IN (SELECT sid FROM sessions WHERE started_at >= ? AND started_at < ?)'
const NET_ANCHOR
  = 'SELECT started_at AS oldest FROM sessions WHERE started_at < ? AND EXISTS (SELECT 1 FROM session_net n WHERE n.sid = sessions.sid) ORDER BY started_at LIMIT 1'
const NET_BAND = 'DELETE FROM session_net WHERE sid IN (SELECT sid FROM sessions WHERE started_at >= ? AND started_at < ?)'

test('planPruneBands: contiguous, clipped at the cutoff, bounded, empty when nothing is stale', () => {
  const cutoff = 1_800_000_000_000
  assert.deepEqual(planPruneBands(null, cutoff, MAX_BANDS, BAND), [])
  assert.deepEqual(planPruneBands(undefined, cutoff, MAX_BANDS, BAND), [])
  assert.deepEqual(planPruneBands(Number.NaN, cutoff, MAX_BANDS, BAND), [])
  assert.deepEqual(planPruneBands(cutoff, cutoff, MAX_BANDS, BAND), [], 'anchor at the cutoff = nothing stale')
  assert.deepEqual(planPruneBands(cutoff + DAY, cutoff, MAX_BANDS, BAND), [], 'anchor above the cutoff')

  // One day of backlog → a single band, clipped so it never crosses the cutoff.
  assert.deepEqual(planPruneBands(cutoff - DAY, cutoff, MAX_BANDS, BAND), [{ lo: cutoff - DAY, hi: cutoff }])

  // Exactly three bands' worth.
  const three = planPruneBands(cutoff - 3 * BAND, cutoff, MAX_BANDS, BAND)
  assert.equal(three.length, 3)
  assert.deepEqual(three[0], { lo: cutoff - 3 * BAND, hi: cutoff - 2 * BAND })
  assert.equal(three[2]!.hi, cutoff)

  // A 400-day backlog: capped at MAX_BANDS, contiguous, starting at the anchor.
  const anchor = cutoff - 400 * DAY
  const plan = planPruneBands(anchor, cutoff, MAX_BANDS, BAND)
  assert.equal(plan.length, MAX_BANDS)
  assert.equal(plan[0]!.lo, anchor)
  for (let i = 1; i < plan.length; i++) assert.equal(plan[i]!.lo, plan[i - 1]!.hi, 'no gap between bands')
  assert.ok(plan[plan.length - 1]!.hi <= cutoff)
  assert.equal(plan[plan.length - 1]!.hi - plan[0]!.lo, MAX_BANDS * BAND, '16 days drained per run')

  // Degenerate inputs never loop.
  assert.deepEqual(planPruneBands(anchor, cutoff, 0, BAND), [])
  assert.deepEqual(planPruneBands(anchor, cutoff, MAX_BANDS, 0), [])
})

test('30 nightly runs drain a 400-day backlog completely (the anchored walk)', () => {
  const day0 = 1_800_000_000_000
  const retention = 180 * DAY
  // One row per day for the last 400 days.
  const rows = new Set<number>()
  for (let d = 0; d < 400; d++) rows.add(day0 - d * DAY - 1000)
  const before = rows.size

  let bandsWalked = 0
  for (let night = 0; night < 30; night++) {
    const now = day0 + night * DAY
    const cutoff = now - retention
    const anchor = [...rows].filter((t) => t < cutoff).sort((a, b) => a - b)[0] ?? null
    const plan = planPruneBands(anchor, cutoff, MAX_BANDS, BAND)
    assert.ok(plan.length <= MAX_BANDS, 'never more than MAX_BANDS batches per night')
    bandsWalked += plan.length
    for (const { lo, hi } of plan) for (const t of [...rows]) if (t >= lo && t < hi) rows.delete(t)
  }

  const finalCutoff = day0 + 29 * DAY - retention
  const stale = [...rows].filter((t) => t < finalCutoff)
  assert.deepEqual(stale, [], `${stale.length} rows older than the cutoff survived 30 runs`)
  assert.ok(rows.size > 0 && rows.size < before, 'rows inside retention are kept')
  assert.ok(bandsWalked <= 30 * MAX_BANDS)
})

test('the OLD cutoff-anchored walk is what left the backlog (regression witness)', () => {
  const day0 = 1_800_000_000_000
  const retention = 180 * DAY
  const rows = new Set<number>()
  for (let d = 0; d < 400; d++) rows.add(day0 - d * DAY - 1000)
  for (let night = 0; night < 30; night++) {
    const cutoff = day0 + night * DAY - retention
    for (let k = 0; k < MAX_BANDS; k++) {
      const hi = cutoff - BAND * k
      const lo = hi - BAND
      let changes = 0
      for (const t of [...rows]) {
        if (t >= lo && t < hi) {
          rows.delete(t)
          changes++
        }
      }
      if (k + 1 >= 2 && changes === 0) break // the old `if (k+1 >= MIN_BANDS && changes === 0) break`
    }
  }
  const finalCutoff = day0 + 29 * DAY - retention
  const stale = [...rows].filter((t) => t < finalCutoff)
  assert.ok(stale.length > 100, `expected the old walk to strand a backlog, stranded ${stale.length}`)
})

test('the anchor queries run on the migrated schema and advance as rows are deleted', () => {
  const db = migratedDb()
  const now = 1_800_000_000_000
  const cutoff = now - 180 * DAY

  // Nothing stale yet: MIN over an empty set is NULL → no bands.
  const empty = db.prepare(PERF_ANCHOR).get(cutoff) as { oldest: number | null }
  assert.equal(empty.oldest, null)
  assert.deepEqual(planPruneBands(empty.oldest, cutoff, MAX_BANDS, BAND), [])

  // 40 sessions every 10 days from 400 days ago to 10 days ago (so rows exist
  // on both sides of the cutoff), each with an event, a perf and a net row.
  for (let d = 0; d < 40; d++) {
    const startedAt = now - (400 - d * 10) * DAY
    const sid = `sid-${String(d).padStart(4, '0')}-0000-0000-000000000000`
    seedSession(db, sid, { startedAt })
    db.prepare('INSERT INTO events (sid, ts, type, name, payload, path) VALUES (?, ?, ?, ?, NULL, ?)').run(sid, startedAt + 10, 'click', null, '/')
    db.prepare('INSERT INTO page_perf (pvid, sid, ts, path) VALUES (?, ?, ?, ?)').run(`pv-${d}`, sid, startedAt + 10, '/')
    db.prepare('INSERT INTO session_net (sid, created_at) VALUES (?, ?)').run(sid, startedAt)
  }
  const staleBefore = (db.prepare('SELECT COUNT(*) AS n FROM page_perf WHERE ts < ?').get(cutoff) as { n: number }).n
  assert.ok(staleBefore > MAX_BANDS, 'fixture has more stale rows than one run can walk')

  // Every anchor points at the oldest un-pruned band, in its own units.
  const perfAnchor = (db.prepare(PERF_ANCHOR).get(cutoff) as { oldest: number }).oldest
  assert.equal(perfAnchor, now - 400 * DAY + 10, 'page_perf anchors on its own ts (same column as its band)')
  assert.equal((db.prepare(EVENTS_ANCHOR).get(cutoff) as { oldest: number }).oldest, now - 400 * DAY)
  assert.equal((db.prepare(NET_ANCHOR).get(cutoff) as { oldest: number }).oldest, now - 400 * DAY)

  // Run nightly until drained; each night walks ≤ MAX_BANDS bands from each
  // step's own anchor, and the anchor only ever moves forward.
  const step = (anchorSql: string, deletes: string[]): number => {
    const a = (db.prepare(anchorSql).get(cutoff) as { oldest: number | null } | undefined)?.oldest ?? null
    const plan = planPruneBands(a, cutoff, MAX_BANDS, BAND)
    for (const { lo, hi } of plan) for (const sql of deletes) db.prepare(sql).run(lo, hi)
    return plan.length
  }
  let nights = 0
  let previousEvents = -Infinity
  for (; nights < 40; nights++) {
    const anchorNow = (db.prepare(EVENTS_ANCHOR).get(cutoff) as { oldest: number | null } | undefined)?.oldest ?? Infinity
    assert.ok(anchorNow >= previousEvents, 'the events anchor never moves backwards')
    previousEvents = anchorNow
    const walked = step(PERF_ANCHOR, [PERF_BAND]) + step(EVENTS_ANCHOR, [EVENTS_BAND]) + step(NET_ANCHOR, [NET_BAND])
    if (walked === 0) break
  }
  assert.ok(nights > 1, 'a 220-day backlog takes more than one night')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM page_perf WHERE ts < ?').get(cutoff) as { n: number }).n, 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM events WHERE ts < ?').get(cutoff) as { n: number }).n, 0)
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM session_net n JOIN sessions s ON s.sid = n.sid WHERE s.started_at < ?').get(cutoff) as { n: number }).n,
    0,
    'side tables drain too',
  )
  assert.ok((db.prepare('SELECT COUNT(*) AS n FROM page_perf').get() as { n: number }).n > 0, 'rows inside retention survive')
  db.close()
})

// The share-link step (8b): same anchored walk, banded on share_hits.ts, and
// share_links rows are never pruned — a link outlives its evidence.
const SHARE_ANCHOR = 'SELECT MIN(ts) AS oldest FROM share_hits WHERE ts < ?'
const SHARE_BAND = 'DELETE FROM share_hits WHERE ts >= ? AND ts < ?'

test('share_hits drains by band while share_links survives', () => {
  const db = migratedDb()
  const now = 1_800_000_000_000
  const cutoff = now - 365 * DAY
  db.prepare("INSERT INTO share_links (token, label, created_at) VALUES ('7fq2', 'Jane Okafor — Acme', ?)").run(now - 500 * DAY)

  // Nothing stale yet: the anchor is null and the plan is empty.
  assert.equal((db.prepare(SHARE_ANCHOR).get(cutoff) as { oldest: number | null }).oldest, null)

  // One hit every 5 days from 500 days ago to 5 days ago.
  for (let d = 0; d < 100; d++) {
    const ts = now - (500 - d * 5) * DAY
    db.prepare("INSERT INTO share_hits (token, ts, kind, agent) VALUES ('7fq2', ?, 'view', NULL)").run(ts)
  }
  const stale = (db.prepare('SELECT COUNT(*) AS n FROM share_hits WHERE ts < ?').get(cutoff) as { n: number }).n
  assert.ok(stale > 0, 'fixture has stale hits')
  assert.equal((db.prepare(SHARE_ANCHOR).get(cutoff) as { oldest: number }).oldest, now - 500 * DAY, 'anchored on its own ts column')

  let nights = 0
  for (; nights < 40; nights++) {
    const anchor = (db.prepare(SHARE_ANCHOR).get(cutoff) as { oldest: number | null }).oldest
    const plan = planPruneBands(anchor, cutoff, MAX_BANDS, BAND)
    if (plan.length === 0) break
    for (const { lo, hi } of plan) db.prepare(SHARE_BAND).run(lo, hi)
  }
  assert.ok(nights > 1, 'a 135-day backlog takes more than one night')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM share_hits WHERE ts < ?').get(cutoff) as { n: number }).n, 0)
  assert.ok((db.prepare('SELECT COUNT(*) AS n FROM share_hits').get() as { n: number }).n > 0, 'hits inside retention survive')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM share_links').get() as { n: number }).n, 1, 'the link itself is never pruned')
  db.close()
})
