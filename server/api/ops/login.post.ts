import { createHash, timingSafeEqual } from 'node:crypto'
import type { D1Database } from '@cloudflare/workers-types'
import { getOpsSession } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { getClientIp } from '../../utils/ip'
import { rateLimit } from '../../utils/ratelimit'

const WINDOW_MS = 15 * 60_000
const LOCK_AFTER = 10
const MAX_LOCK_MIN = 60

/** Throttle key: IPv4 as-is, IPv6 truncated to its /64 (plan delta A23). */
function loginThrottleKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const head = ip.split('%')[0] ?? ip
  const left = head.split('::')[0] ?? ''
  const groups = left.split(':').filter((g) => g.length > 0)
  return `${[...groups, '0', '0', '0', '0'].slice(0, 4).join(':')}::/64`
}

/** Lock length after the n-th failure in a window: min(2^(n−10), 60) minutes. */
function lockMinutes(n: number): number {
  if (n < LOCK_AFTER) return 0
  return Math.min(MAX_LOCK_MIN, 2 ** (n - LOCK_AFTER))
}

interface AttemptRow {
  window_start: number
  n: number
  locked_until: number
}

/**
 * POST /api/ops/login — { password } → seals { admin: true } into the rbops
 * session cookie. Throttled per client IP twice: the in-memory limiter
 * (5/min, per isolate) and the durable D1 `login_attempts` row (≥ 10
 * failures per 15-minute window → 429 with Retry-After and exponential
 * backoff, deleted on success). Timing-safe compare.
 */
export default defineEventHandler(async (event) => {
  const ip = getClientIp(event)
  if (!rateLimit('ops-login', ip, 5, 60_000)) {
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

  // Durable throttle (audit A23). D1 unavailable → log and fall back to the in-memory limiter alone.
  const key = loginThrottleKey(ip)
  const now = Date.now()
  let db: D1Database | null = null
  let row: AttemptRow | null = null
  try {
    db = getDb(event)
    row = await db.prepare('SELECT window_start, n, locked_until FROM login_attempts WHERE ip = ?').bind(key).first<AttemptRow>()
  } catch (err) {
    console.error('[ops-login] login_attempts read failed:', err)
    db = null
  }
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
    const inWindow = row !== null && now - Number(row.window_start) < WINDOW_MS
    const n = inWindow ? Number(row?.n ?? 0) + 1 : 1
    const windowStart = inWindow ? Number(row?.window_start) : now
    const lockedUntil = lockMinutes(n) > 0 ? now + lockMinutes(n) * 60_000 : 0
    console.warn('[ops-login] failed attempt', { ip: key, n, lockedUntil })
    if (db) {
      try {
        await db
          .prepare(
            'INSERT INTO login_attempts (ip, window_start, n, locked_until) VALUES (?, ?, ?, ?) '
              + 'ON CONFLICT(ip) DO UPDATE SET window_start = excluded.window_start, n = excluded.n, locked_until = excluded.locked_until',
          )
          .bind(key, windowStart, n, lockedUntil)
          .run()
      } catch (err) {
        console.error('[ops-login] login_attempts write failed:', err)
      }
    }
    throw createError({ statusCode: 401, statusMessage: 'access denied' })
  }

  if (db && row) {
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
