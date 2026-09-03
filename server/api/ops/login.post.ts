import { createHash, timingSafeEqual } from 'node:crypto'
import type { D1Database } from '@cloudflare/workers-types'
import { getOpsSession } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { getClientIp } from '../../utils/ip'
import { BUMP_ATTEMPT_SQL, LOGIN_WINDOW_MS, lockMinutes, throttleKey } from '../../utils/loginThrottle'
import { rateLimit } from '../../utils/ratelimit'

interface AttemptRow {
  window_start: number
  n: number
  locked_until: number
}

/**
 * POST /api/ops/login — { password } → seals { admin: true } into the rbops
 * session cookie. Throttled per client IP twice: the in-memory limiter
 * (5/min, per isolate, on the same /64-truncated key) and the durable D1
 * `login_attempts` row (≥ 10 failures per 15-minute window → 429 with
 * Retry-After and exponential backoff, deleted on success).
 *
 * The durable counter is bumped ATOMICALLY and BEFORE the password is
 * compared, so a burst of parallel guesses cannot each read the same `n`.
 * Timing-safe compare.
 */
export default defineEventHandler(async (event) => {
  const ip = getClientIp(event)
  const key = throttleKey(ip)
  if (!rateLimit('ops-login', key, 5, 60_000)) {
    setHeader(event, 'Retry-After', 60)
    throw createError({ statusCode: 429, statusMessage: 'too many attempts' })
  }

  let expected = useRuntimeConfig(event).adminPassword
  if (!expected) {
    if (!import.meta.dev) {
      throw createError({ statusCode: 503, statusMessage: 'admin disabled' })
    }
    expected = 'dev'
  }

  // Durable throttle (audit A23 / S1). D1 unavailable → log and fall back to
  // the in-memory limiter alone.
  const now = Date.now()
  let db: D1Database | null = null
  let row: AttemptRow | null = null
  try {
    db = getDb(event)
    row = await db
      .prepare(BUMP_ATTEMPT_SQL)
      .bind(key, now, now, LOGIN_WINDOW_MS, now, LOGIN_WINDOW_MS, now)
      .first<AttemptRow>()
  } catch (err) {
    console.error('[ops-login] login_attempts bump failed:', err)
    db = null
  }
  // `locked_until` is whatever the LAST failure wrote — this attempt only
  // reads it, so hammering a locked key never extends the lock.
  if (row && Number(row.locked_until) > now) {
    const retry = Math.max(1, Math.ceil((Number(row.locked_until) - now) / 1000))
    setHeader(event, 'Retry-After', retry)
    console.warn('[ops-login] locked', { ip: key, retryAfterS: retry })
    throw createError({ statusCode: 429, statusMessage: 'locked — try again later' })
  }

  const body = await readBody<{ password?: unknown }>(event).catch(() => null)
  const supplied = typeof body?.password === 'string' ? body.password : ''

  // Hash both sides to fixed length so timingSafeEqual never throws on
  // length mismatch (and never leaks length via an early return).
  const a = createHash('sha256').update(supplied).digest()
  const b = createHash('sha256').update(expected).digest()
  if (!timingSafeEqual(a, b)) {
    // n comes from the row SQLite just wrote, not from a value this isolate computed.
    const n = Number(row?.n ?? 1)
    const lockedUntil = lockMinutes(n) > 0 ? now + lockMinutes(n) * 60_000 : 0
    console.warn('[ops-login] failed attempt', { ip: key, n, lockedUntil })
    if (db && lockedUntil > 0) {
      try {
        await db.prepare('UPDATE login_attempts SET locked_until = ? WHERE ip = ?').bind(lockedUntil, key).run()
      } catch (err) {
        console.error('[ops-login] login_attempts lock write failed:', err)
      }
    }
    if (lockedUntil > 0) {
      setHeader(event, 'Retry-After', Math.ceil((lockedUntil - now) / 1000))
      throw createError({ statusCode: 429, statusMessage: 'locked — try again later' })
    }
    throw createError({ statusCode: 401, statusMessage: 'access denied' })
  }

  if (db) {
    try {
      await db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(key).run()
    } catch (err) {
      console.error('[ops-login] login_attempts delete failed:', err)
    }
  }
  const session = await getOpsSession(event)
  await session.update({ admin: true })
  return { ok: true }
})
