import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'

/**
 * server/utils/replayAuth.ts — the replay upload token (plan delta A7 / A53).
 *
 * /api/collect answers every accepted NON-BOT envelope — after the batch that
 * wrote the `sessions` row — with an `rb_rt` cookie whose value only the server
 * can compute for that sid; /api/replay requires it to match `x-rb-sid`. A
 * stranger who knows (or guesses) a sid can no longer write chunks into it.
 *
 * Key derivation follows auth.ts and FAILS CLOSED (audit S2): the session
 * password, else the (secret) admin password, else — in dev only — a constant.
 * In production with neither configured there is no key, so nothing is minted
 * and nothing verifies: /api/replay answers 401 instead of accepting uploads
 * signed with a guessable literal.
 */

export const REPLAY_TOKEN_COOKIE = 'rb_rt'
/** Matches the client's rb_sid lifetime (30 min, refreshed on every flush). */
export const REPLAY_TOKEN_MAX_AGE_S = 1800

/** Dev-only constant so replay works out of the box with zero env config. */
const DEV_REPLAY_SECRET = 'dev'

/** The signing key, or null when this deployment has none (production, no secrets). */
function replaySecret(event: H3Event): string | null {
  const cfg = useRuntimeConfig(event)
  const configured = (cfg.sessionPassword as string) || (cfg.adminPassword as string) || ''
  if (configured) return configured
  return import.meta.dev ? DEV_REPLAY_SECRET : null
}

/** hex sha256("rb-replay:" + secret + ":" + sid), or null when no secret is configured. */
export function replayToken(event: H3Event, sid: string): string | null {
  const secret = replaySecret(event)
  if (secret === null) return null
  return createHash('sha256').update(`rb-replay:${secret}:${sid}`).digest('hex')
}

/** Can this deployment mint / verify replay tokens at all? */
export function replayAuthAvailable(event: H3Event): boolean {
  return replaySecret(event) !== null
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
  const expected = replayToken(event, sid)
  if (expected === null) return false // no key configured → nothing can match
  return constantTimeEqual(expected, presented)
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

/**
 * Set / refresh the rb_rt cookie on a collect response. Returns false (and
 * sets nothing) when the deployment has no signing key.
 */
export function setReplayTokenCookie(event: H3Event, sid: string): boolean {
  const token = replayToken(event, sid)
  if (token === null) return false
  setCookie(event, REPLAY_TOKEN_COOKIE, token, {
    path: '/',
    maxAge: REPLAY_TOKEN_MAX_AGE_S,
    sameSite: 'lax',
    httpOnly: true,
    secure: isSecureRequest(event),
  })
  return true
}
