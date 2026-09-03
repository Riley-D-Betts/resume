import type { D1Database } from '@cloudflare/workers-types'
import type { H3Event } from 'h3'
import { readCf } from '../utils/cf'
import { getDb } from '../utils/db'
import { getClientIp } from '../utils/ip'
import { classifyFetch } from '../utils/previewAgents'
import { rateLimit, rateLimitKey } from '../utils/ratelimit'
import { isSecureRequest } from '../utils/replayAuth'
import {
  OPTOUT_COOKIE,
  SHARE_COOKIE,
  SHARE_COOKIE_MAX_AGE_S,
  SHARE_HIT_SQL,
  SHARE_QUERY_KEY,
  isShareToken,
  refererHost,
} from '../utils/share'

/**
 * server/middleware/share-capture.ts — the share-link capture.
 *
 * A link the owner minted for one named recipient looks like
 * `https://rileybetts.dev/?k=7fq2`. Every DOCUMENT request carrying a known
 * `k` writes one `share_hits` row: when, what kind of fetch (a person, a named
 * preview bot, other automation), the platform, the organisation and country
 * from `request.cf`, the referrer host and the path.
 *
 * It has to be middleware, not /api/collect: a Slack or LinkedIn unfurl runs
 * no JavaScript, so the SSR document request is the ONLY trace it leaves.
 * That unfurl is the evidence that a link was pasted somewhere.
 *
 * Stored deliberately: no IP and no raw user agent. Both already carry a
 * retention and scrub policy on `sessions`; duplicating them here would widen
 * the PII surface for no analytical gain. `agent` is a platform NAME from the
 * table in previewAgents.ts, never the header.
 *
 * The same request sets the `rb_k` cookie, which /api/collect reads into
 * `session_net.share_token` — that join is what makes a link worth having:
 * the console can show that Jane's link produced a session that read six
 * pages and copied the email address.
 *
 * Never blocks the response: the row is written after it through `waitUntil`,
 * and a D1 failure is swallowed the way `flagHoneypot` does.
 */

/**
 * Fire-and-forget write after the response — the pattern `scheduleRdns`
 * establishes (server/utils/rdns.ts): Workers `waitUntil` when available, a
 * detached promise locally. Never throws.
 */
function scheduleHit(event: H3Event, write: () => Promise<unknown>): void {
  const ctx = event.context as {
    waitUntil?: (p: Promise<unknown>) => void
    cloudflare?: { context?: { waitUntil?: (p: Promise<unknown>) => void } }
  }
  const waitUntil = ctx.waitUntil ?? ctx.cloudflare?.context?.waitUntil
  const p = write().catch((err) => console.error('[share] hit write failed:', err))
  if (typeof waitUntil === 'function') {
    try {
      waitUntil(p)
    } catch {
      /* detached */
    }
  }
}

/** 60 document requests carrying a token per minute per address (/64 for IPv6). */
const SHARE_RATE_PER_MIN = 60
const PATH_MAX = 200
const HOST_MAX = 120

export default defineEventHandler((event) => {
  if (event.method !== 'GET') return
  const url = getRequestURL(event)
  // The common request — no `?k=` — pays exactly this one URL parse.
  const token = url.searchParams.get(SHARE_QUERY_KEY)
  if (token === null) return

  const p = url.pathname
  if (
    p.startsWith('/api/')
    || p.startsWith('/_nuxt')
    || p.startsWith('/ops')
    || p === '/void.html'
    || p.includes('.') // static assets (favicon.svg, robots.txt, fonts, …)
  ) {
    return
  }
  // A malformed token is not a link: no probe, no row, no cookie.
  if (!isShareToken(token)) return

  // The site promises "?optout=1 to any URL to opt out", so this capture has
  // to honour it too — a share hit is tracking like any other. The flag lives
  // in localStorage for the tracker, which the server cannot read, so the
  // client mirrors it into a cookie (app/plugins/analytics.client.ts) and the
  // query parameter itself covers the request that does the opting out.
  if (url.searchParams.get('optout') === '1') return
  if (getCookie(event, OPTOUT_COOKIE) === '1') return
  // Same gate /api/collect applies: when the owner turns honorGpc on, a
  // browser asking not to be tracked is not recorded here either.
  const cfg = useRuntimeConfig(event)
  if (cfg.honorGpc && (getHeader(event, 'sec-gpc') === '1' || getHeader(event, 'dnt') === '1')) return

  // Rate limit before any I/O, so a flood of `?k=` requests cannot turn into
  // a flood of D1 writes. Un-anonymized address, rate limiting only.
  if (!rateLimit('share', rateLimitKey(getClientIp(event)), SHARE_RATE_PER_MIN, 60_000)) return

  const ua = getHeader(event, 'user-agent')
  const { kind, agent } = classifyFetch(ua)
  const cf = readCf(event)
  const host = refererHost(getHeader(event, 'referer'))

  // The join into /api/collect. Server-set and httpOnly: no client-side
  // JavaScript takes part in this feature at all.
  setCookie(event, SHARE_COOKIE, token, {
    path: '/',
    maxAge: SHARE_COOKIE_MAX_AGE_S,
    sameSite: 'lax',
    httpOnly: true,
    secure: isSecureRequest(event),
  })

  let db: D1Database
  try {
    db = getDb(event)
  } catch (err) {
    console.error('[share] no D1 binding:', (err as Error)?.message ?? err)
    return
  }

  const now = Date.now()
  // One statement, no separate read: the EXISTS makes an unknown token a
  // no-op, so `?k=` cannot be walked to write rows.
  scheduleHit(event, () =>
    db
      .prepare(SHARE_HIT_SQL)
      .bind(
        token,
        now,
        kind,
        agent,
        cf.asOrg,
        cf.country,
        host === null ? null : host.slice(0, HOST_MAX),
        p.slice(0, PATH_MAX),
        token,
      )
      .run(),
  )
})
