/**
 * Bot honeypot. Nothing on the site links here visibly (a hidden link is
 * planted for crawlers); any visitor is flagged as a bot for 24h.
 */
export default defineEventHandler((event) => {
  flagHoneypot(getStorageIp(event))
  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>void</title></head><body><p>nothing here</p></body></html>'
})
