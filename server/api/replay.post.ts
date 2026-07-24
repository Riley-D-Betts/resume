import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Strict header validation doubles as path-traversal defense: sid becomes a
// directory name and only ever contains hex digits and dashes.
const SID_RE = /^[0-9a-fA-F-]{16,64}$/
const SEQ_RE = /^\d{1,4}$/ // 0..9999
const MAX_CHUNK_BYTES = 2 * 1024 * 1024
const MAX_SESSION_BYTES = 15 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const ip = getClientIp(event)
  if (!rateLimit('replay', ip, 30, 60_000)) {
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
  }

  const sid = getHeader(event, 'x-rb-sid') ?? ''
  const seqRaw = getHeader(event, 'x-rb-seq') ?? ''
  if (!SID_RE.test(sid) || !SEQ_RE.test(seqRaw)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  }
  const seq = Number(seqRaw)
  const gz = getHeader(event, 'x-rb-gz') !== '0' // chunks are usually gzipped

  const declared = Number(getHeader(event, 'content-length') ?? 0)
  if (declared > MAX_CHUNK_BYTES) throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
  const body = await readRawBody(event, false).catch(() => undefined)
  if (!body || body.length === 0) throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  if (body.length > MAX_CHUNK_BYTES) throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })

  try {
    const db = getDb()

    // Cumulative per-session cap (excluding a chunk this seq would replace).
    const { total } = db
      .prepare('SELECT COALESCE(SUM(bytes), 0) AS total FROM replay_chunks WHERE sid = ? AND seq <> ?')
      .get(sid, seq) as { total: number }
    if (total + body.length > MAX_SESSION_BYTES) {
      throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
    }

    const dir = join(getDataDir(), 'replays', sid)
    mkdirSync(dir, { recursive: true })
    const base = String(seq).padStart(5, '0')
    writeFileSync(join(dir, `${base}${gz ? '.json.gz' : '.json'}`), body)
    try {
      // A re-sent seq may have flipped compression — drop the stale twin.
      unlinkSync(join(dir, `${base}${gz ? '.json' : '.json.gz'}`))
    } catch {
      // no twin — normal case
    }

    db.prepare(
      'INSERT OR REPLACE INTO replay_chunks (sid, seq, bytes, compressed, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(sid, seq, body.length, gz ? 1 : 0, Date.now())
    // The sid may have no sessions row yet (replay beat /api/collect) — the
    // UPDATE is then a no-op and the chunk is still accepted.
    db.prepare('UPDATE sessions SET has_replay = 1 WHERE sid = ?').run(sid)
  } catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    console.error('[replay] store failed:', err)
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error' })
  }

  setResponseStatus(event, 204)
  return null
})
