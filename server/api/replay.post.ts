import { ID_RE, replayKey, replayKeyPair } from '../utils/replayKeys'
import { REPLAY_TOKEN_COOKIE, replayTokenMatches } from '../utils/replayAuth'

/**
 * POST /api/replay — one rrweb chunk (plan deltas A0 / A7 / A14 / A21).
 *
 * Headers: x-rb-sid, x-rb-rid (ids), x-rb-seq (0..9999), x-rb-gz (0|1,
 * default 1), x-rb-ps (page start, ms; clamped to [now−7 d, now+60 s]).
 * Body: the chunk (≤ 2 MB), gzipped JSON unless x-rb-gz: 0.
 *
 * Auth: the `rb_rt` cookie /api/collect issued must match x-rb-sid (401), and
 * the sid must already have a non-bot `sessions` row (403) — a stranger can
 * no longer write chunks into anyone's session.
 *
 * Write order (A21): accounting row with pending = 1 → bucket.put → delete the
 * stale compression twin → pending = 0 (+ has_replay once seq 0 exists, A14).
 * A crash between the row and the flip leaves a pending row the prune sweeps.
 */

const SEQ_RE = /^\d{1,4}$/ // 0..9999
const MAX_CHUNK_BYTES = 2 * 1024 * 1024
const MAX_SESSION_BYTES = 15 * 1024 * 1024
const PS_PAST_MS = 7 * 24 * 60 * 60 * 1000
const PS_FUTURE_MS = 60_000

export default defineEventHandler(async (event) => {
  const ip = getClientIp(event)
  if (!rateLimit('replay', ip, 30, 60_000)) {
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
  }

  const cfg = useRuntimeConfig(event)
  if (cfg.honorGpc && (getHeader(event, 'sec-gpc') === '1' || getHeader(event, 'dnt') === '1')) {
    setResponseStatus(event, 204)
    return null
  }

  const sid = getHeader(event, 'x-rb-sid') ?? ''
  const rid = getHeader(event, 'x-rb-rid') ?? ''
  const seqRaw = getHeader(event, 'x-rb-seq') ?? ''
  if (!ID_RE.test(sid) || !ID_RE.test(rid) || !SEQ_RE.test(seqRaw)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  }
  const seq = Number(seqRaw)
  const gz = getHeader(event, 'x-rb-gz') !== '0' // chunks are usually gzipped
  const now = Date.now()
  const psRaw = Number(getHeader(event, 'x-rb-ps') ?? Number.NaN)
  const pageStartedAt = Number.isFinite(psRaw) ? Math.min(Math.max(psRaw, now - PS_PAST_MS), now + PS_FUTURE_MS) : now

  if (!replayTokenMatches(event, sid, getCookie(event, REPLAY_TOKEN_COOKIE))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const declared = Number(getHeader(event, 'content-length') ?? 0)
  if (declared > MAX_CHUNK_BYTES) throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
  const body = await readRawBody(event, false).catch(() => undefined)
  if (!body || body.length === 0) throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  if (body.length > MAX_CHUNK_BYTES) throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })

  const db = getDb(event)
  const bucket = getReplayBucket(event)
  const key = replayKey(sid, rid, seq, gz)
  const [gzKey, plainKey] = replayKeyPair(sid, rid, seq)
  const twin = gz ? plainKey : gzKey

  // One atomic batch: session / bot check, the previous row (for the twin
  // rule), and the pending accounting row gated by the 15 MB per-sid cap —
  // evaluated inside the transaction so concurrent uploads cannot race past it.
  let session: { is_bot: number } | null
  let previous: { compressed: number } | null
  let inserted: number
  try {
    const [s, prev, ins] = await db.batch([
      db.prepare('SELECT is_bot FROM sessions WHERE sid = ?').bind(sid),
      db.prepare('SELECT compressed FROM replay_chunks_v2 WHERE sid = ? AND rid = ? AND seq = ?').bind(sid, rid, seq),
      db
        .prepare(
          `INSERT OR REPLACE INTO replay_chunks_v2 (sid, rid, seq, bytes, compressed, pending, created_at, page_started_at)
           SELECT ?, ?, ?, ?, ?, 1, ?, ?
           WHERE EXISTS (SELECT 1 FROM sessions WHERE sid = ? AND is_bot = 0)
             AND (SELECT COALESCE(SUM(bytes), 0) FROM replay_chunks_v2 WHERE sid = ? AND NOT (rid = ? AND seq = ?)) + ? <= ?`,
        )
        .bind(sid, rid, seq, body.length, gz ? 1 : 0, now, pageStartedAt, sid, sid, rid, seq, body.length, MAX_SESSION_BYTES),
    ])
    session = (s?.results?.[0] as { is_bot: number } | undefined) ?? null
    previous = (prev?.results?.[0] as { compressed: number } | undefined) ?? null
    inserted = ins?.meta?.changes ?? 0
  } catch (err) {
    console.error('[replay] ledger failed:', err)
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error' })
  }

  if (!session || session.is_bot !== 0) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  if (inserted === 0) {
    throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
  }

  try {
    await bucket.put(key, body)
  } catch (err) {
    console.error('[replay] put failed:', err)
    // Best effort: drop the pending row so the ledger does not claim bytes
    // that never landed; the orphan sweep would catch it otherwise.
    await db
      .prepare('DELETE FROM replay_chunks_v2 WHERE sid = ? AND rid = ? AND seq = ? AND pending = 1')
      .bind(sid, rid, seq)
      .run()
      .catch(() => undefined)
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error' })
  }

  // A re-sent seq may have flipped compression — drop the stale twin, but only
  // when a previous row says one exists (A21: no blind deletes).
  if (previous && Boolean(previous.compressed) !== gz) {
    await bucket.delete(twin).catch((err: unknown) => console.warn('[replay] twin delete failed:', err))
  }

  try {
    await db.batch([
      db.prepare('UPDATE replay_chunks_v2 SET pending = 0 WHERE sid = ? AND rid = ? AND seq = ?').bind(sid, rid, seq),
      // has_replay only once a FullSnapshot chunk (seq 0) for this rid is on
      // disk — this upload or an earlier one (A14).
      db
        .prepare(
          `UPDATE sessions SET has_replay = 1
           WHERE sid = ? AND has_replay = 0
             AND EXISTS (SELECT 1 FROM replay_chunks_v2 WHERE sid = ? AND rid = ? AND seq = 0 AND pending = 0)`,
        )
        .bind(sid, sid, rid),
    ])
  } catch (err) {
    console.error('[replay] flip failed:', err)
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error' })
  }

  setResponseStatus(event, 204)
  return null
})
