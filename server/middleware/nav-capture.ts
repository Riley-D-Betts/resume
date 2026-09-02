import type { DocFacts } from '#shared/analytics/events'

/**
 * server/middleware/nav-capture.ts — document-request header capture
 * (contract B.8 / C.7).
 *
 * `Sec-Fetch-Site/Mode/Dest/User`, the navigation `Referer`, `cf-ray` and
 * `Early-Data` only exist on the HTML document request — on /api/collect they
 * are always `same-origin`. This middleware puts them on
 * `event.context.navCapture` for every SSR page request; WP1's
 * `app/plugins/nav-capture.server.ts` copies that into `useState('rbNav')`,
 * the client sends it back in the initial `pageview.nav`, and /api/collect
 * whitelists it into `session_net.fetch_*` / `doc_referer` / `early_data`.
 *
 * `Sec-Fetch-Site: none` is the only trustworthy "typed / bookmarked" signal.
 */

declare module 'h3' {
  interface H3EventContext {
    navCapture?: DocFacts | null
  }
}

const SITE_VALUES = new Set(['none', 'same-origin', 'same-site', 'cross-site'])
const RAY_RE = /^[0-9a-f]{16}(-[A-Z]{3})?$/

function short(v: string | undefined, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length === 0 ? null : s.slice(0, max)
}

export default defineEventHandler((event) => {
  if (event.method !== 'GET') return
  const p = getRequestURL(event).pathname
  if (
    p.startsWith('/api/')
    || p.startsWith('/_nuxt')
    || p.startsWith('/ops')
    || p === '/void.html'
    || p.includes('.') // static assets (favicon.svg, robots.txt, fonts, …)
  ) {
    return
  }
  const dest = getHeader(event, 'sec-fetch-dest')
  const accept = getHeader(event, 'accept') ?? ''
  if (dest !== 'document' && !accept.includes('text/html')) return

  const siteRaw = getHeader(event, 'sec-fetch-site')
  const site = siteRaw && SITE_VALUES.has(siteRaw) ? (siteRaw as DocFacts['site']) : null
  const ray = short(getHeader(event, 'cf-ray'), 40)

  event.context.navCapture = {
    site,
    mode: short(getHeader(event, 'sec-fetch-mode'), 16),
    dest: short(dest, 16),
    user: getHeader(event, 'sec-fetch-user') === '?1',
    referer: short(getHeader(event, 'referer'), 300),
    ray: ray && RAY_RE.test(ray) ? ray : null,
    earlyData: getHeader(event, 'early-data') === '1',
  } satisfies DocFacts
})
