// server/utils/loginThrottle.ts — the durable /ops login throttle (audit A23,
// security S1). Split out of the handler so the SQL and the backoff curve can
// be exercised directly on node:sqlite. PURE apart from the key helper it
// wraps: no Nitro auto-imports.

import { rateLimitKey } from './ratelimit.ts'

export const LOGIN_WINDOW_MS = 15 * 60_000
export const LOGIN_LOCK_AFTER = 10
export const LOGIN_MAX_LOCK_MIN = 60

/**
 * Create-or-advance one `login_attempts` row in a SINGLE statement, so a wave
 * of parallel guesses cannot each read `n = 9` and each write `n = 10`. The
 * window is restarted (n = 1) once `now - window_start` reaches the window
 * length; `locked_until` is left alone here — only a FAILED attempt writes it,
 * which is what stops hammering from extending an active lock.
 *
 * Binds, in order: ip, now, now, LOGIN_WINDOW_MS, now, LOGIN_WINDOW_MS, now.
 */
export const BUMP_ATTEMPT_SQL
  = 'INSERT INTO login_attempts (ip, window_start, n, locked_until) VALUES (?, ?, 1, 0) '
    + 'ON CONFLICT(ip) DO UPDATE SET '
    + 'n = CASE WHEN ? - login_attempts.window_start >= ? THEN 1 ELSE login_attempts.n + 1 END, '
    + 'window_start = CASE WHEN ? - login_attempts.window_start >= ? THEN ? ELSE login_attempts.window_start END '
    + 'RETURNING n, window_start, locked_until'

/**
 * Throttle key: IPv4 as-is, IPv6 truncated to its /64 (plan delta A23) — a
 * single client must not get a fresh budget for every address in its prefix.
 *
 * The in-memory limiter and the durable `login_attempts` row MUST key on the
 * same string, so every /ops limiter call goes through this. The normalisation
 * itself lives in `server/utils/ratelimit.ts`; this is the thin wrapper the
 * /ops callers and their unit tests import.
 */
export function throttleKey(ip: string): string {
  return rateLimitKey(ip)
}

/** Lock length after the n-th failure in a window: min(2^(n−10), 60) minutes. */
export function lockMinutes(n: number): number {
  if (n < LOGIN_LOCK_AFTER) return 0
  return Math.min(LOGIN_MAX_LOCK_MIN, 2 ** (n - LOGIN_LOCK_AFTER))
}

/** Historical name, kept for the login handler and its unit test. */
export const loginThrottleKey = throttleKey
