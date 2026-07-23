import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { requireAdmin } from '../../../utils/auth'

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

  const chunks = getDb()
    .prepare('SELECT seq, compressed FROM replay_chunks WHERE sid = ? ORDER BY seq')
    .all(sid) as { seq: number; compressed: number }[]
  if (chunks.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'no replay' })
  }

  const dir = join(getDataDir(), 'replays', sid)
  const combined: unknown[] = []
  for (const chunk of chunks) {
    const ext = chunk.compressed ? '.json.gz' : '.json'
    const file = join(dir, `${String(chunk.seq).padStart(5, '0')}${ext}`)
    try {
      const raw = readFileSync(file)
      const text = chunk.compressed ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
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
