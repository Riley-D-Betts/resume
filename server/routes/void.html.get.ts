/**
 * Bot honeypot. Nothing on the site links here visibly (NsFooter plants a
 * `visibility:hidden` link for crawlers; robots.txt disallows it). A hit
 * flags the (ip, ua) pair as a bot for 24 h and retro-flags its sessions.
 *
 * Only a top-level navigation from this site (or a client that sends no
 * Sec-Fetch-* at all — crawlers) can flag (plan delta A18): an embedded
 * cross-site `<img src="/void.html">` used to be able to mark any bystander.
 */
export default defineEventHandler(async (event) => {
  const dest = getHeader(event, 'sec-fetch-dest')
  const site = getHeader(event, 'sec-fetch-site')
  const navigationLike = (dest === undefined || dest === 'document') && site !== 'cross-site'
  if (navigationLike && rateLimit('honeypot', getClientIp(event), 5, 60_000)) {
    await flagHoneypot(event, getStorageIp(event), getHeader(event, 'user-agent') ?? '')
  }
  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>void</title></head><body><p>nothing here</p></body></html>'
})
