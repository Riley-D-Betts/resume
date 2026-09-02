// The deferred chunk (contract §B.4 / §B.5 budgets): web vitals, the `perf`
// document-load report and the `env` probe. Loaded by the plugin through a
// dynamic import after `app:mounted`; long tasks / LoAF come from the early
// accumulators in core.ts because the browser does not buffer them.
import { selectorPath } from '~/utils/selectorPath'
import type { PerfP, PerfResource, PerfResources, VitalsP } from '#shared/analytics/events'
import type { Accum, Core } from './core'
import { afterLoad, idle, safe } from './core'
import { probeEnv } from './env'

const PERF_AFTER_LOAD_MS = 3_000
const ENV_IDLE_TIMEOUT_MS = 3_000
const INP_THRESHOLD_MS = 40
/** CLS session window: ≤ 1 s gap between shifts, ≤ 5 s span (A29). */
const CLS_GAP_MS = 1_000
const CLS_SPAN_MS = 5_000

interface LayoutShiftEntry extends PerformanceEntry {
  value: number
  hadRecentInput: boolean
}
interface LcpEntry extends PerformanceEntry {
  element?: Element | null
  size?: number
}
interface EventTimingEntry extends PerformanceEntry {
  interactionId?: number
}
interface ResourceEntry extends PerformanceResourceTiming {
  deliveryType?: string
}

const r = (n: number): number => Math.round(n)
const r3 = (n: number): number => Math.round(n * 1000) / 1000

function observe(
  type: string,
  cb: (entries: PerformanceEntry[]) => void,
  extra: Record<string, unknown> = {},
): PerformanceObserver | undefined {
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return undefined
    const handler = safe((list: PerformanceObserverEntryList) => cb(list.getEntries()))
    const po = new PerformanceObserver(handler)
    po.observe({ type, buffered: true, ...extra } as PerformanceObserverInit)
    return po
  } catch {
    return undefined
  }
}

interface Vitals {
  payload: (pvid: string) => VitalsP
  disconnect: () => void
}

function startVitals(): Vitals {
  let ttfb: number | undefined
  let fcp: number | undefined
  let lcp: number | undefined
  let lcpSel: string | undefined
  let lcpSize: number | undefined
  let inp: number | undefined
  // CLS session windows
  let clsMax = 0
  let win = 0
  let winFirst = 0
  let winLast = 0
  // INP: worst duration per interaction, p98-style pick over the longest ten
  const perInteraction = new Map<number, number>()
  let longest: number[] = []

  try {
    const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (navEntry && navEntry.responseStart > 0) ttfb = r(navEntry.responseStart)
  } catch {
    /* ignore */
  }

  const onPaint = (entries: PerformanceEntry[]): void => {
    for (const e of entries) if (e.name === 'first-contentful-paint') fcp = r(e.startTime)
  }
  const onLcp = (entries: PerformanceEntry[]): void => {
    const last = entries[entries.length - 1] as LcpEntry | undefined
    if (!last) return
    lcp = r(last.startTime)
    lcpSize = typeof last.size === 'number' ? last.size : undefined
    try {
      lcpSel = last.element ? selectorPath(last.element) : undefined
    } catch {
      lcpSel = undefined
    }
  }
  const onShift = (entries: PerformanceEntry[]): void => {
    for (const e of entries as LayoutShiftEntry[]) {
      if (e.hadRecentInput) continue
      if (win > 0 && e.startTime - winLast < CLS_GAP_MS && e.startTime - winFirst < CLS_SPAN_MS) {
        win += e.value
      } else {
        win = e.value
        winFirst = e.startTime
      }
      winLast = e.startTime
      if (win > clsMax) clsMax = win
    }
  }
  const onEvent = (entries: PerformanceEntry[]): void => {
    for (const e of entries as EventTimingEntry[]) {
      const id = e.interactionId ?? 0
      if (id <= 0) continue
      const d = r(e.duration)
      if (d > (perInteraction.get(id) ?? 0)) perInteraction.set(id, d)
    }
    longest = [...perInteraction.values()].sort((a, b) => b - a).slice(0, 10)
    const idx = Math.min(longest.length - 1, Math.floor(perInteraction.size / 50))
    inp = longest.length ? longest[idx] : undefined
  }

  const observers = [
    observe('paint', onPaint),
    observe('largest-contentful-paint', onLcp),
    observe('layout-shift', onShift),
    observe('event', onEvent, { durationThreshold: INP_THRESHOLD_MS }),
    observe('first-input', onEvent),
  ]
  const handlers = [onPaint, onLcp, onShift, onEvent, onEvent]

  return {
    payload(pvid) {
      // Buffered entries queued at observe() may not have been delivered yet.
      observers.forEach((po, i) => {
        try {
          if (po) handlers[i]!(po.takeRecords())
        } catch {
          /* ignore */
        }
      })
      const p: VitalsP = { pvid, cls: r3(clsMax) }
      if (ttfb !== undefined) p.ttfb = ttfb
      if (fcp !== undefined) p.fcp = fcp
      if (lcp !== undefined) p.lcp = lcp
      if (lcpSel !== undefined) p.lcpSel = lcpSel.slice(0, 120)
      if (lcpSize !== undefined) p.lcpSize = lcpSize
      if (inp !== undefined) p.inp = inp
      return p
    },
    disconnect() {
      for (const po of observers) {
        try {
          po?.disconnect()
        } catch {
          /* ignore */
        }
      }
    },
  }
}

function resourceType(e: ResourceEntry): keyof PerfResources['byType'] {
  const init = e.initiatorType
  if (init === 'script') return 'script'
  if (init === 'fetch' || init === 'xmlhttprequest' || init === 'beacon') return 'fetch'
  if (init === 'img' || init === 'image' || init === 'video' || init === 'audio') return 'img'
  const path = e.name.split(/[?#]/)[0] ?? ''
  if (/\.(?:woff2?|ttf|otf|eot)$/i.test(path)) return 'font'
  if (init === 'css' || init === 'link' || /\.css$/i.test(path)) return 'css'
  return 'other'
}

/** Same-origin `/path`, cross-origin `host/path`; ≤ 120 chars. */
function resourceName(name: string): string {
  try {
    const u = new URL(name, location.href)
    const s = u.origin === location.origin ? u.pathname : `${u.host}${u.pathname}`
    return s.slice(0, 120)
  } catch {
    return name.slice(0, 120)
  }
}

function resources(): PerfResources {
  const out: PerfResources = {
    count: 0,
    bytes: 0,
    cached: 0,
    byType: { script: 0, css: 0, font: 0, img: 0, fetch: 0, other: 0 },
    slowest: [],
  }
  const all = performance.getEntriesByType('resource') as ResourceEntry[]
  const ranked: PerfResource[] = []
  for (const e of all) {
    // Our own analytics traffic is not part of the page's load story.
    if (/\/api\/(?:collect|replay)(?:[?#]|$)/.test(e.name)) continue
    out.count++
    const size = e.transferSize || 0
    out.bytes += size
    if (e.deliveryType === 'cache' || (size === 0 && (e.decodedBodySize || 0) > 0)) out.cached++
    const type = resourceType(e)
    out.byType[type]++
    ranked.push({ name: resourceName(e.name), dur: r(e.duration), size, type })
  }
  ranked.sort((a, b) => b.dur - a.dur)
  out.slowest = ranked.slice(0, 5)
  return out
}

function tasks(a: Accum): { count: number; totalMs: number; longestMs: number } {
  return { count: a.count, totalMs: r(a.totalMs), longestMs: r(a.longestMs) }
}

function perfPayload(core: Core, pvid: string): PerfP | null {
  const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (!n) return null
  const tls = n.secureConnectionStart > 0 ? n.connectEnd - n.secureConnectionStart : 0
  const p: PerfP = {
    pvid,
    nav: {
      dns: r(n.domainLookupEnd - n.domainLookupStart),
      connect: r(n.connectEnd - n.connectStart),
      tls: r(tls),
      request: r(n.responseStart - n.requestStart),
      response: r(n.responseEnd - n.responseStart),
      domInteractive: r(n.domInteractive),
      dcl: r(n.domContentLoadedEventEnd),
      load: r(n.loadEventEnd || n.loadEventStart || 0),
      transfer: n.transferSize || 0,
      encoded: n.encodedBodySize || 0,
      decoded: n.decodedBodySize || 0,
      redirects: n.redirectCount || 0,
      protocol: (n.nextHopProtocol || '').slice(0, 20),
      type: n.type,
    },
    resources: resources(),
    longTasks: tasks(core.early.longTasks),
  }
  if (core.early.loafSupported) {
    p.loaf = { ...tasks(core.early.loaf), ...(core.early.loafScript ? { script: core.early.loafScript } : {}) }
  }
  return p
}

/**
 * Wire the deferred pieces into the running tracker: vitals observers, the
 * `perf` report (load + 3 s or first hidden) and the `env` probe (idle after
 * load, 3 s fallback). `docPvid` is the document that actually loaded.
 */
export function setupDeferred(core: Core, docPvid: string): void {
  const vitals = startVitals()
  let vitalsSent = false
  let perfSent = false

  const emitVitals = safe((): void => {
    if (vitalsSent) return
    vitalsSent = true
    const p = vitals.payload(docPvid)
    vitals.disconnect()
    core.track('vitals', null, p)
  })
  const emitPerf = safe((): void => {
    if (perfSent) return
    perfSent = true
    const p = perfPayload(core, docPvid)
    if (p) core.track('perf', null, p)
  })

  core.deferred.queueVitals = emitVitals
  core.deferred.queuePerf = emitPerf
  if (core.deferred.vitalsWanted) emitVitals()
  if (core.deferred.perfWanted) emitPerf()

  afterLoad(() => {
    setTimeout(emitPerf, PERF_AFTER_LOAD_MS)
    idle(() => {
      void probeEnv()
        .then((p) => core.track('env', null, p))
        .catch(() => {})
    }, ENV_IDLE_TIMEOUT_MS)
  })
}
