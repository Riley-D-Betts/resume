// Replay stitching (plan deltas A0 / A3, C6): one segment per recording id in
// page_started_at order, a rid without its seq 0 dropped, damaged chunks
// skipped, the R2 get budget honoured, both R2 key layouts, and the inflate
// budget turning into the ReplayBudgetError the endpoint answers 422 with.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'

import { LEGACY_RID } from '../../shared/analytics/events.ts'
import type { ChunkRow } from '../../server/utils/replayStitch.ts'
import { CHUNK_INFLATE_BUDGET, R2_GET_BUDGET, ReplayBudgetError, SESSION_INFLATE_BUDGET, inflateBudgeted, stitchReplay } from '../../server/utils/replayStitch.ts'
import { migratedDb, seedSession } from './_memdb.ts'

const SID = '0123456789abcdef-0000'

function row(rid: string, seq: number, pageStartedAt: number, compressed = 0): ChunkRow {
  return { rid, seq, compressed, page_started_at: pageStartedAt }
}

function bytes(s: string): ArrayBuffer {
  const u = new TextEncoder().encode(s)
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}

function gz(s: string): ArrayBuffer {
  const b = gzipSync(Buffer.from(s, 'utf8'))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

/** An R2 stand-in: a key → body map plus the keys that were asked for. */
function bucket(map: Record<string, ArrayBuffer>) {
  const asked: string[] = []
  return {
    asked,
    get: async (key: string): Promise<ArrayBuffer | null> => {
      asked.push(key)
      return map[key] ?? null
    },
  }
}

const ev = (n: number) => JSON.stringify([{ type: n }])

test('segments come back in page_started_at order, one per rid', async () => {
  const b = bucket({
    [`replays/${SID}/ridB/00000.json`]: bytes(ev(1)),
    [`replays/${SID}/ridB/00001.json`]: bytes(ev(2)),
    [`replays/${SID}/ridA/00000.json`]: bytes(ev(3)),
  })
  // The endpoint hands rows ordered by (page_started_at, rid, seq).
  const rows = [row('ridB', 0, 100), row('ridB', 1, 100), row('ridA', 0, 900)]
  const res = await stitchReplay(SID, rows, b.get)
  assert.deepEqual(res.segments.map((s) => s.rid), ['ridB', 'ridA'])
  assert.deepEqual(res.segments.map((s) => s.startedAt), [100, 900])
  assert.deepEqual(res.segments[0]?.events, [{ type: 1 }, { type: 2 }])
  assert.equal(res.total, 3)
  assert.equal(res.read, 3)
  assert.equal(res.truncated, false)
})

test('a rid whose seq 0 is missing is skipped whole (no FullSnapshot to play)', async () => {
  const b = bucket({
    [`replays/${SID}/ridA/00001.json`]: bytes(ev(1)),
    [`replays/${SID}/ridB/00000.json`]: bytes(ev(2)),
  })
  const res = await stitchReplay(SID, [row('ridA', 1, 100), row('ridB', 0, 200)], b.get)
  assert.deepEqual(res.segments.map((s) => s.rid), ['ridB'])
  // The skipped rid costs no R2 gets at all.
  assert.deepEqual(b.asked, [`replays/${SID}/ridB/00000.json`])
})

test('legacy rows use the flat key layout, new rows the rid layout', async () => {
  const b = bucket({
    [`replays/${SID}/00000.json.gz`]: gz(ev(7)),
    [`replays/${SID}/ridA/00000.json`]: bytes(ev(8)),
  })
  const res = await stitchReplay(SID, [row(LEGACY_RID, 0, 10, 1), row('ridA', 0, 20)], b.get)
  assert.deepEqual(b.asked, [`replays/${SID}/00000.json.gz`, `replays/${SID}/ridA/00000.json`])
  assert.deepEqual(res.segments.map((s) => s.rid), [LEGACY_RID, 'ridA'])
  assert.deepEqual(res.segments[0]?.events, [{ type: 7 }])
})

test('damaged, missing and mis-shaped chunks are skipped, not fatal', async () => {
  const b = bucket({
    [`replays/${SID}/ridA/00000.json`]: bytes(ev(1)),
    [`replays/${SID}/ridA/00001.json`]: bytes('{not json'),
    [`replays/${SID}/ridA/00003.json`]: bytes('{"not":"an array"}'),
    [`replays/${SID}/ridA/00004.json`]: bytes(ev(4)),
    // 00002 is absent from the bucket entirely (pruned)
  })
  const rows = [0, 1, 2, 3, 4].map((seq) => row('ridA', seq, 5))
  const res = await stitchReplay(SID, rows, b.get)
  assert.deepEqual(res.segments[0]?.events, [{ type: 1 }, { type: 4 }])
  assert.equal(res.read, 5)
})

test('a rid outside the id shape never reaches R2', async () => {
  const b = bucket({})
  const res = await stitchReplay(SID, [row('../../etc/passwd', 0, 1)], b.get)
  assert.deepEqual(res.segments, [])
  assert.deepEqual(b.asked, [])
})

test('the R2 get budget truncates instead of burning subrequests', async () => {
  const map: Record<string, ArrayBuffer> = {}
  const rows: ChunkRow[] = []
  for (let seq = 0; seq < 5; seq++) {
    map[`replays/${SID}/ridA/${String(seq).padStart(5, '0')}.json`] = bytes(ev(seq))
    rows.push(row('ridA', seq, 1))
  }
  const b = bucket(map)
  const res = await stitchReplay(SID, rows, b.get, { getBudget: 3 })
  assert.equal(res.truncated, true)
  assert.equal(res.read, 3)
  assert.equal(b.asked.length, 3)
  // Current behaviour: the rid that ran out of budget mid-way is dropped
  // rather than played half-stitched — `truncated` is what the UI shows.
  assert.deepEqual(res.segments, [])
  assert.ok(R2_GET_BUDGET > 3)
})

test('inflateBudgeted stops a gzip bomb at the budget', async () => {
  const big = JSON.stringify([{ pad: 'x'.repeat(200_000) }])
  await assert.rejects(() => inflateBudgeted(gz(big), 1024), ReplayBudgetError)
  const small = await inflateBudgeted(gz(ev(1)), CHUNK_INFLATE_BUDGET)
  assert.equal(small.text, ev(1))
  assert.equal(small.bytes, ev(1).length)
})

test('the inflate budget surfaces as ReplayBudgetError (the endpoint 422 path)', async () => {
  const big = JSON.stringify([{ pad: 'x'.repeat(200_000) }])
  const b = bucket({ [`replays/${SID}/ridA/00000.json.gz`]: gz(big) })
  await assert.rejects(
    () => stitchReplay(SID, [row('ridA', 0, 1, 1)], b.get, { chunkBudget: 4096 }),
    (err: unknown) => err instanceof ReplayBudgetError && /replay too large/.test((err as Error).message),
  )
  // …and an UNCOMPRESSED chunk over the budget throws the same error.
  const plain = bucket({ [`replays/${SID}/ridA/00000.json`]: bytes(big) })
  await assert.rejects(
    () => stitchReplay(SID, [row('ridA', 0, 1)], plain.get, { chunkBudget: 4096 }),
    ReplayBudgetError,
  )
  assert.ok(SESSION_INFLATE_BUDGET > CHUNK_INFLATE_BUDGET)
})

test('the endpoint query only feeds confirmed rows, ordered for the stitcher', () => {
  const db = migratedDb()
  seedSession(db, SID, { startedAt: 1 })
  const ins = db.prepare('INSERT INTO replay_chunks_v2 (sid, rid, seq, compressed, bytes, page_started_at, created_at, pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  ins.run(SID, 'ridB', 0, 0, 10, 200, 1, 0)
  ins.run(SID, 'ridA', 0, 0, 10, 100, 1, 0)
  ins.run(SID, 'ridA', 1, 0, 10, 100, 1, 1) // still pending — must not be stitched
  const rows = db
    .prepare('SELECT rid, seq, compressed, page_started_at FROM replay_chunks_v2 WHERE sid = ? AND pending = 0 ORDER BY page_started_at, rid, seq')
    .all(SID) as unknown as ChunkRow[]
  assert.deepEqual(rows.map((r) => [r.rid, r.seq]), [['ridA', 0], ['ridB', 0]])
  db.close()
})
