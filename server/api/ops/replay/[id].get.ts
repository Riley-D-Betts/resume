import type { ReplayError, ReplaySegments } from '../../../../shared/analytics/ops'
import { requireAdmin } from '../../../utils/auth'
import { getDb, getReplayBucket } from '../../../utils/db'
import type { ChunkRow } from '../../../utils/replayStitch'
import { ReplayBudgetError, stitchReplay } from '../../../utils/replayStitch'

const SID_RE = /^[0-9a-fA-F-]{16,64}$/

/**
 * GET /api/ops/replay/:id — stitch the session's rrweb chunks into segments
 * (one per recording id, ordered by page_started_at; plan deltas A0 / A3).
 * Reads replay_chunks_v2 (pending = 0), maps legacy rows to the old R2 key
 * layout, inflates through a byte-budgeted DecompressionStream reader (8 MB
 * per chunk, 32 MB per session → 422 { error: 'replay too large' }), skips
 * damaged / missing chunks and any rid without its seq 0, 404 when nothing
 * stitched. The UI plays segments sequentially.
 */
export default defineEventHandler(async (event): Promise<ReplaySegments | ReplayError> => {
  await requireAdmin(event)
  const sid = getRouterParam(event, 'id') ?? ''
  if (!SID_RE.test(sid)) throw createError({ statusCode: 400, statusMessage: 'bad session id' })

  const db = getDb(event)
  const bucket = getReplayBucket(event)
  const { results: rows } = await db
    .prepare('SELECT rid, seq, compressed, page_started_at FROM replay_chunks_v2 WHERE sid = ? AND pending = 0 ORDER BY page_started_at, rid, seq')
    .bind(sid)
    .all<ChunkRow>()
  if (rows.length === 0) throw createError({ statusCode: 404, statusMessage: 'no replay' })

  try {
    const result = await stitchReplay(sid, rows, async (key) => {
      const obj = await bucket.get(key)
      return obj ? await obj.arrayBuffer() : null
    })
    if (result.segments.length === 0) throw createError({ statusCode: 404, statusMessage: 'no replay' })
    setHeader(event, 'Cache-Control', 'no-store')
    return { segments: result.segments, chunks: { read: result.read, total: result.total }, truncated: result.truncated }
  } catch (err) {
    if (err instanceof ReplayBudgetError) {
      console.warn('[ops-replay] inflate budget exceeded', { sid })
      setResponseStatus(event, 422)
      return { error: 'replay too large' }
    }
    throw err
  }
})
