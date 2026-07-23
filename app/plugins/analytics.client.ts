import { selectorPath } from '~/utils/selectorPath'
import { setupReplay } from '~/utils/analytics/replay'

/** One queued event, matching the POST /api/collect wire contract. */
interface QueuedEvent {
  t: number
  type: string
  name: string | null
  p?: Record<string, unknown>
}

interface LayoutShiftEntry extends PerformanceEntry {
  value: number
  hadRecentInput: boolean
}

declare global {
  interface Window {
    /** Page components report boot_done / boot_skipped / easter_egg here. */
    __rbTrack?: (type: string, name?: string | null, p?: Record<string, unknown>) => void
  }
}

const FLUSH_MAX_QUEUE = 20
const FLUSH_INTERVAL_MS = 5_000
const HEARTBEAT_MS = 15_000
const INPUT_IDLE_MS = 30_000
const MAX_JS_ERRORS = 10
const SCROLL_MILESTONES = [25, 50, 75, 90, 100]
const SECTION_RATIO = 0.4

/** Wrap a listener so an analytics bug can never surface to the page. */
function safe<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args)
    } catch {
      /* analytics must never break the page */
    }
  }
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode etc. */
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

/**
 * First-party analytics pipeline: pageview, section dwell, scroll depth,
 * clicks, outbound links, heartbeats, web vitals, JS errors and sampled
 * rrweb replay — all batched to POST /api/collect. Public pages only;
 * every path is wrapped so a bug here can never break the site.
 */
export default defineNuxtPlugin((nuxtApp) => {
  try {
    // -- guards ---------------------------------------------------------
    if (location.pathname.startsWith('/ops')) return
    if (new URLSearchParams(location.search).get('optout') === '1') {
      lsSet('rb_optout', '1')
      console.info('[rb] analytics opt-out saved — this browser will not be tracked')
    }
    if (lsGet('rb_optout')) return

    // -- identity -------------------------------------------------------
    const hadVid = lsGet('rb_vid') !== null
    const vid = lsGet('rb_vid') ?? crypto.randomUUID()
    if (!hadVid) lsSet('rb_vid', vid)

    const cookieSid = readCookie('rb_sid')
    const sid = cookieSid ?? crypto.randomUUID()
    const returning = hadVid && cookieSid === null

    const refreshSidCookie = (): void => {
      document.cookie = `rb_sid=${sid}; path=/; max-age=1800; SameSite=Lax`
    }
    refreshSidCookie()

    // -- queue + flush --------------------------------------------------
    const queue: QueuedEvent[] = []

    const flush = (preferBeacon: boolean): void => {
      try {
        if (queue.length === 0) return
        const events = queue.splice(0, queue.length)
        const body = JSON.stringify({ v: 1, vid, sid, returning, url: location.pathname, events })
        refreshSidCookie()
        let delivered = false
        if (preferBeacon && typeof navigator.sendBeacon === 'function') {
          try {
            delivered = navigator.sendBeacon('/api/collect', new Blob([body], { type: 'application/json' }))
          } catch {
            delivered = false
          }
        }
        if (!delivered) {
          void fetch('/api/collect', {
            method: 'POST',
            keepalive: true,
            headers: { 'content-type': 'application/json' },
            body,
          }).catch(() => {})
        }
      } catch {
        /* never surface */
      }
    }

    const track = (type: string, name?: string | null, p?: Record<string, unknown>): void => {
      queue.push({ t: Date.now(), type, name: name ?? null, ...(p !== undefined ? { p } : {}) })
      if (queue.length >= FLUSH_MAX_QUEUE) flush(false)
    }

    window.__rbTrack = safe(track)
    window.setInterval(safe(() => flush(false)), FLUSH_INTERVAL_MS)

    // -- session replay (sampled, lazy) ---------------------------------
    const rawRate = Number(useRuntimeConfig().public.replaySampleRate)
    const replay = setupReplay({
      sid,
      sampleRate: Number.isFinite(rawRate) ? rawRate : 0,
      track,
    })

    // -- pageview -------------------------------------------------------
    const params = new URLSearchParams(location.search)
    const nav = navigator as Navigator & {
      deviceMemory?: number
      connection?: { effectiveType?: string }
    }
    track('pageview', null, {
      referrer: document.referrer,
      utm: {
        source: params.get('utm_source'),
        medium: params.get('utm_medium'),
        campaign: params.get('utm_campaign'),
        term: params.get('utm_term'),
        content: params.get('utm_content'),
      },
      screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
      viewport: { w: innerWidth, h: innerHeight },
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lang: navigator.language,
      platform: navigator.platform,
      touch: matchMedia('(pointer: coarse)').matches,
      deviceMemory: nav.deviceMemory,
      cores: navigator.hardwareConcurrency,
      connection: nav.connection?.effectiveType,
    })

    // -- section dwell --------------------------------------------------
    const openSections = new Map<string, number>()

    const forceExitSections = (): void => {
      for (const [name, enteredAt] of openSections) {
        track('section_exit', name, { dwellMs: Date.now() - enteredAt })
      }
      openSections.clear()
    }

    const observeSections = (): void => {
      const io = new IntersectionObserver(
        safe((entries: IntersectionObserverEntry[]) => {
          for (const entry of entries) {
            const name = (entry.target as HTMLElement).dataset.section
            if (!name) continue
            if (entry.intersectionRatio >= SECTION_RATIO) {
              if (!openSections.has(name)) {
                openSections.set(name, Date.now())
                track('section_enter', name)
              }
            } else if (openSections.has(name)) {
              const enteredAt = openSections.get(name)!
              openSections.delete(name)
              track('section_exit', name, { dwellMs: Date.now() - enteredAt })
            }
          }
        }),
        // 0 alongside 0.4 guarantees a callback when a section fully
        // leaves the viewport, so fast scrolls never miss an exit.
        { threshold: [0, SECTION_RATIO] },
      )
      for (const el of document.querySelectorAll('[data-section]')) io.observe(el)
    }

    // -- scroll depth ---------------------------------------------------
    const firedMilestones = new Set<number>()
    let scrollTickScheduled = false
    const measureDepth = safe((): void => {
      scrollTickScheduled = false
      const height = document.documentElement.scrollHeight || 1
      const pct = ((scrollY + innerHeight) / height) * 100
      for (const m of SCROLL_MILESTONES) {
        if (pct >= m && !firedMilestones.has(m)) {
          firedMilestones.add(m)
          track('scroll_depth', null, { pct: m })
        }
      }
    })
    addEventListener(
      'scroll',
      () => {
        if (scrollTickScheduled) return
        scrollTickScheduled = true
        requestAnimationFrame(measureDepth)
      },
      { passive: true },
    )

    // -- clicks + outbound ----------------------------------------------
    const sectionOf = (el: Element): string | undefined =>
      (el.closest('[data-section]') as HTMLElement | null)?.dataset.section

    document.addEventListener(
      'pointerdown',
      safe((ev: PointerEvent) => {
        const target = ev.target
        if (!(target instanceof Element)) return

        track('click', null, {
          sel: selectorPath(target),
          text: (target.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
          x: Math.round(ev.clientX),
          y: Math.round(ev.clientY),
          section: sectionOf(target),
        })

        const anchor = target.closest<HTMLAnchorElement>('a[href]')
        if (!anchor) return
        let url: URL
        try {
          url = new URL(anchor.href, location.href)
        } catch {
          return
        }
        if (url.origin === location.origin) return
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return
        track('outbound', url.host, {
          href: url.href.slice(0, 300),
          label: (anchor.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
          section: sectionOf(anchor),
        })
        flush(true) // the navigation may unload the page before the next tick
      }),
      { capture: true, passive: true },
    )

    // -- heartbeat (active visible time) --------------------------------
    let lastInputAt = Date.now()
    const noteInput = (): void => {
      lastInputAt = Date.now()
    }
    for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart']) {
      addEventListener(type, noteInput, { passive: true })
    }
    window.setInterval(
      safe(() => {
        if (document.visibilityState === 'visible' && Date.now() - lastInputAt <= INPUT_IDLE_MS) {
          track('heartbeat', null, {})
        }
      }),
      HEARTBEAT_MS,
    )

    // -- web vitals (hand-rolled) ---------------------------------------
    let ttfb: number | undefined
    let lcp: number | undefined
    let cls = 0
    let inp: number | undefined
    let vitalsQueued = false
    const observers: PerformanceObserver[] = []

    try {
      const navEntry = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined
      if (navEntry) ttfb = Math.round(navEntry.responseStart)
    } catch {
      /* ignore */
    }

    const observe = (init: PerformanceObserverInit, cb: (entries: PerformanceEntry[]) => void): void => {
      try {
        const po = new PerformanceObserver(safe((list: PerformanceObserverEntryList) => cb(list.getEntries())))
        po.observe(init)
        observers.push(po)
      } catch {
        /* entry type unsupported */
      }
    }

    observe({ type: 'largest-contentful-paint', buffered: true }, (entries) => {
      const last = entries[entries.length - 1]
      if (last) lcp = Math.round(last.startTime)
    })
    observe({ type: 'layout-shift', buffered: true }, (entries) => {
      for (const entry of entries as LayoutShiftEntry[]) {
        if (!entry.hadRecentInput) cls += entry.value
      }
    })
    observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit, (entries) => {
      for (const entry of entries) inp = Math.max(inp ?? 0, Math.round(entry.duration))
    })

    const queueVitals = (): void => {
      if (vitalsQueued) return
      vitalsQueued = true
      for (const po of observers) {
        try {
          po.disconnect()
        } catch {
          /* ignore */
        }
      }
      const p: Record<string, number> = { cls: Math.round(cls * 1000) / 1000 }
      if (ttfb !== undefined) p.ttfb = ttfb
      if (lcp !== undefined) p.lcp = lcp
      if (inp !== undefined) p.inp = inp
      track('vitals', null, p)
    }

    // -- JS errors ------------------------------------------------------
    let errorCount = 0
    addEventListener(
      'error',
      safe((ev: ErrorEvent) => {
        if (errorCount >= MAX_JS_ERRORS || typeof ev.message !== 'string') return
        errorCount++
        track('js_error', null, {
          msg: ev.message.slice(0, 300),
          src: String(ev.filename ?? '').slice(0, 200),
          line: ev.lineno,
          stack: (ev.error instanceof Error ? (ev.error.stack ?? '') : '').slice(0, 1000),
        })
      }),
    )
    addEventListener(
      'unhandledrejection',
      safe((ev: PromiseRejectionEvent) => {
        if (errorCount >= MAX_JS_ERRORS) return
        errorCount++
        const reason: unknown = ev.reason
        const msg = reason instanceof Error ? reason.message : String(reason)
        track('js_error', null, {
          msg: msg.slice(0, 300),
          src: 'unhandledrejection',
          stack: (reason instanceof Error ? (reason.stack ?? '') : '').slice(0, 1000),
        })
      }),
    )

    // -- lifecycle flushes ----------------------------------------------
    document.addEventListener(
      'visibilitychange',
      safe(() => {
        if (document.visibilityState !== 'hidden') return
        queueVitals()
        flush(true)
      }),
    )
    addEventListener(
      'pagehide',
      safe(() => {
        forceExitSections()
        queueVitals()
        flush(true)
        replay.flushTail()
      }),
    )

    // -- DOM-dependent pieces start once the app has mounted ------------
    nuxtApp.hook('app:mounted', safe(observeSections))
  } catch {
    /* analytics must never break the page */
  }
})
