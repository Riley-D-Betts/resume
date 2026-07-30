import { requireAdmin } from '../../../utils/auth'

/** Gunzip an R2 object body via the web-standard DecompressionStream. */
async function gunzipText(buf: ArrayBuffer): Promise<string> {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}

/**
 * GET /api/ops/replay/:id — stitch every stored rrweb chunk for the session
 * back into one flat event array for rrweb-player.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const sid = getRouterParam(event, 'id') ?? ''
  if (!/^[0-9a-fA-F-]{16,64}$/.test(sid)) {
    throw createError({ statusCode: 400, statusMessage: 'bad session id' })
  }

  const db = getDb(event)
  const bucket = getReplayBucket(event)
  const { results: chunks } = await db
    .prepare('SELECT seq, compressed FROM replay_chunks WHERE sid = ? ORDER BY seq')
    .bind(sid)
    .all<{ seq: number, compressed: number }>()
  if (chunks.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'no replay' })
  }

  const combined: unknown[] = []
  for (const chunk of chunks) {
    const ext = chunk.compressed ? '.json.gz' : '.json'
    const key = `replays/${sid}/${String(chunk.seq).padStart(5, '0')}${ext}`
    try {
      const obj = await bucket.get(key)
      if (!obj) continue
      const raw = await obj.arrayBuffer()
      const text = chunk.compressed ? await gunzipText(raw) : new TextDecoder().decode(raw)
      const events = JSON.parse(text) as unknown
      if (Array.isArray(events)) combined.push(...events)
    } catch {
      // damaged / pruned chunk — skip, keep what we can stitch
    }
  }
  if (combined.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'no replay' })
  }

  return combined
})
