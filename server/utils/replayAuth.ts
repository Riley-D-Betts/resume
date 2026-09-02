import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'

/**
 * server/utils/replayAuth.ts — the replay upload token (plan delta A7 / A53).
 *
 * /api/collect answers every accepted envelope with an `rb_rt` cookie whose
 * value only the server can compute for that sid; /api/replay requires it to
 * match `x-rb-sid`. A stranger who knows (or guesses) a sid can no longer
 * write chunks into it. Same key derivation idea as auth.ts: the session
 * password, else the (secret) admin password, else a dev constant.
 */

export const REPLAY_TOKEN_COOKIE = 'rb_rt'
/** Matches the client's rb_sid lifetime (30 min, refreshed on every flush). */
export const REPLAY_TOKEN_MAX_AGE_S = 1800

function replaySecret(event: H3Event): string {
  const cfg = useRuntimeConfig(event)
  return (cfg.sessionPassword as string) || (cfg.adminPassword as string) || 'dev'
}

/** hex sha256("rb-replay:" + secret + ":" + sid). */
export function replayToken(event: H3Event, sid: string): string {
  return createHash('sha256').update(`rb-replay:${replaySecret(event)}:${sid}`).digest('hex')
}

/** Length-independent, constant-time string comparison (no early exit on the first differing char). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Constant-time comparison of a presented cookie against the expected token. */
export function replayTokenMatches(event: H3Event, sid: string, presented: string | null | undefined): boolean {
  if (typeof presented !== 'string' || !/^[0-9a-f]{64}$/.test(presented)) return false
  return constantTimeEqual(replayToken(event, sid), presented)
}

/** True when the request arrived over https (Secure cookies are unusable on plain http in dev). */
export function isSecureRequest(event: H3Event): boolean {
  try {
    if (getRequestURL(event).protocol === 'https:') return true
  } catch {
    /* fall through */
  }
  try {
    return getRequestProtocol(event) === 'https'
  } catch {
    return false
  }
}

/** Set / refresh the rb_rt cookie on a collect response. */
export function setReplayTokenCookie(event: H3Event, sid: string): void {
  setCookie(event, REPLAY_TOKEN_COOKIE, replayToken(event, sid), {
    path: '/',
    maxAge: REPLAY_TOKEN_MAX_AGE_S,
    sameSite: 'lax',
    httpOnly: true,
    secure: isSecureRequest(event),
  })
}
