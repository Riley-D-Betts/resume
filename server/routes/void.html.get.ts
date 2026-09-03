import { rateLimitKey } from '../utils/ratelimit'

/**
 * Bot honeypot. Nothing on the site links here visibly (NsFooter plants a
 * `visibility:hidden` link for crawlers; robots.txt disallows it). A hit
 * flags the (ip, ua) pair as a bot for 24 h and retro-flags its sessions.
 *
 * Only a top-level navigation that came FROM this site (or a client that sends
 * no Sec-Fetch-* at all — crawlers) can flag (plan delta A18 / audit S4): the
 * bait link only ever exists on our own pages, so `Sec-Fetch-Site` must be
 * `same-origin` / `same-site` / absent. `cross-site` (an embedded
 * `<img src="…/void.html">` on someone else's page) and `none` (a typed URL,
 * a bookmark, a pasted link) never flag — they cannot distinguish a crawler
 * from a curious human and used to mark bystanders.
 */
const FLAGGING_SITES = new Set(['same-origin', 'same-site'])

export default defineEventHandler(async (event) => {
  const dest = getHeader(event, 'sec-fetch-dest') || undefined
  const site = getHeader(event, 'sec-fetch-site') || undefined
  const navigationLike = (dest === undefined || dest === 'document') && (site === undefined || FLAGGING_SITES.has(site))
  if (navigationLike && rateLimit('honeypot', rateLimitKey(getClientIp(event)), 5, 60_000)) {
    await flagHoneypot(event, getStorageIp(event), getHeader(event, 'user-agent') ?? '')
  }
  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>void</title></head><body><p>nothing here</p></body></html>'
})
