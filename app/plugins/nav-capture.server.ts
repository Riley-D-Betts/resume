// SSR hand-off of the document-request facts (contract §B.8): the Nitro
// middleware `server/middleware/nav-capture.ts` stores a DocFacts-shaped
// object on `event.context.navCapture`; this plugin copies it into the
// `rbNav` state so the client attaches it to the initial `pageview.nav`.
// Optional end to end — absent middleware simply yields null.
import type { DocFacts } from '#shared/analytics/events'

const SITES = new Set(['none', 'same-origin', 'same-site', 'cross-site'])

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null)

function toDocFacts(raw: unknown): DocFacts | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const site = str(o.site, 20)
  return {
    site: site !== null && SITES.has(site) ? (site as DocFacts['site']) : null,
    mode: str(o.mode, 20),
    dest: str(o.dest, 20),
    user: o.user === true,
    referer: str(o.referer, 300),
    ray: str(o.ray, 40),
    earlyData: o.earlyData === true,
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  const nav = useState<DocFacts | null>('rbNav', () => null)
  try {
    const context = nuxtApp.ssrContext?.event?.context as Record<string, unknown> | undefined
    nav.value = toDocFacts(context?.navCapture)
  } catch {
    nav.value = null
  }
})
