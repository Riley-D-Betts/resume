// server/utils/replayStitch.ts — stitch rrweb chunks back into playable
// segments (plan deltas A0 / A3). One segment per recording id (`rid`, one
// per document load), ordered by page_started_at; chunks are inflated through
// a DecompressionStream reader with a byte budget (8 MB per chunk, 32 MB per
// session) so a gzip bomb stops the request instead of the isolate. Damaged
// or missing chunks are skipped; a rid without its seq 0 (the FullSnapshot)
// is skipped whole. Takes an object getter so it is testable without R2.

import { LEGACY_RID } from '../../shared/analytics/events.ts'
import type { ReplaySegment } from '../../shared/analytics/ops.ts'

export const CHUNK_INFLATE_BUDGET = 8 * 1024 * 1024
export const SESSION_INFLATE_BUDGET = 32 * 1024 * 1024
/** R2 gets per request (Workers Free: 50 subrequests per invocation, minus the D1 calls). */
export const R2_GET_BUDGET = 45

const RID_RE = /^[0-9A-Za-z_-]{1,64}$/

export interface ChunkRow {
  rid: string
  seq: number
  compressed: number
  page_started_at: number
}

export class ReplayBudgetError extends Error {
  constructor(message = 'replay too large') {
    super(message)
    this.name = 'ReplayBudgetError'
  }
}

/** R2 key layout: legacy rows keep `replays/<sid>/<00000>`, new rows use `replays/<sid>/<rid>/<00000>`. */
export function chunkKey(sid: string, rid: string, seq: number, compressed: boolean): string {
  const file = `${String(seq).padStart(5, '0')}${compressed ? '.json.gz' : '.json'}`
  return rid === LEGACY_RID ? `replays/${sid}/${file}` : `replays/${sid}/${rid}/${file}`
}

/** Inflate gzip bytes to text, aborting once more than `maxBytes` came out. */
export async function inflateBudgeted(buf: ArrayBuffer, maxBytes: number): Promise<{ text: string; bytes: number }> {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new ReplayBudgetError()
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return { text, bytes }
}

export interface StitchResult {
  segments: ReplaySegment[]
  /** Chunks fetched from R2. */
  read: number
  /** Ledger rows considered. */
  total: number
  /** True when the R2 subrequest budget stopped the stitch early. */
  truncated: boolean
}

export interface StitchOptions {
  chunkBudget?: number
  sessionBudget?: number
  getBudget?: number
}

/**
 * `rows` must be ordered by (page_started_at, rid, seq) with pending rows
 * already excluded. Throws ReplayBudgetError when the inflate budget is hit.
 */
export async function stitchReplay(
  sid: string,
  rows: readonly ChunkRow[],
  getObject: (key: string) => Promise<ArrayBuffer | null>,
  opts: StitchOptions = {},
): Promise<StitchResult> {
  const chunkBudget = opts.chunkBudget ?? CHUNK_INFLATE_BUDGET
  const sessionBudget = opts.sessionBudget ?? SESSION_INFLATE_BUDGET
  const getBudget = opts.getBudget ?? R2_GET_BUDGET

  // group by rid, first-appearance order (rows already sorted by page_started_at)
  const byRid = new Map<string, ChunkRow[]>()
  for (const r of rows) {
    if (!RID_RE.test(r.rid)) continue
    let list = byRid.get(r.rid)
    if (!list) {
      list = []
      byRid.set(r.rid, list)
    }
    list.push(r)
  }

  const segments: ReplaySegment[] = []
  let read = 0
  let inflated = 0
  let truncated = false

  outer: for (const [rid, list] of byRid) {
    list.sort((a, b) => a.seq - b.seq)
    const head = list[0]
    if (!head || head.seq !== 0) continue // no FullSnapshot — nothing to play
    const events: unknown[] = []
    for (const chunk of list) {
      if (read >= getBudget) {
        truncated = true
        break outer
      }
      read++
      try {
        const raw = await getObject(chunkKey(sid, rid, chunk.seq, chunk.compressed === 1))
        if (!raw) continue
        let text: string
        if (chunk.compressed === 1) {
          const out = await inflateBudgeted(raw, Math.min(chunkBudget, sessionBudget - inflated))
          inflated += out.bytes
          text = out.text
        } else {
          if (raw.byteLength > chunkBudget || inflated + raw.byteLength > sessionBudget) throw new ReplayBudgetError()
          inflated += raw.byteLength
          text = new TextDecoder().decode(raw)
        }
        const parsed = JSON.parse(text) as unknown
        if (Array.isArray(parsed)) for (const ev of parsed) events.push(ev)
      } catch (err) {
        if (err instanceof ReplayBudgetError) throw err
        // damaged / pruned chunk — skip, keep what we can stitch
      }
    }
    if (events.length > 0) segments.push({ rid, startedAt: head.page_started_at, events })
  }

  return { segments, read, total: rows.length, truncated }
}
