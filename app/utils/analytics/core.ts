// Analytics core (contract §B.1): identity, the event queue, flush, caps,
// cookies, the early performance observers and the hand-off points the
// deferred chunk (perf.ts + env.ts) fills in later. Every public function
// is fail-open — analytics must never break the page.
import {
  ESSENTIAL_TYPES,
  EVENT_TYPES,
  PAGE_CAPS,
  SESSION_EVENT_CAP,
  WIRE_VERSION,
} from '#shared/analytics/events'
import type { EventType, WireEnvelope, WireEvent, WirePayload } from '#shared/analytics/events'

/** Payload-less types take no third argument; every other type requires its exact payload. */
export type TrackArgs<T extends EventType> = undefined extends WirePayload<T> ? [p?: undefined] : [p: WirePayload<T>]
export type Track = <T extends EventType>(type: T, name: string | null, ...rest: TrackArgs<T>) => void
/** Loosely-typed twin used by the `window.__rbTrack` bridge after runtime validation. */
export type LooseTrack = (type: EventType, name: string | null, p?: unknown) => void

const COLLECT_URL = '/api/collect'
const FLUSH_MAX_QUEUE = 20
const FLUSH_INTERVAL_MS = 5_000
/** Server-side envelope limit (collect.post.ts MAX_EVENTS). */
const ENVELOPE_MAX = 100
/** Non-lifecycle flushes that fail are re-queued once, up to this many events per document load (A15). */
const REQUEUE_MAX = 100
const SID_MAX_AGE_S = 1800
const ID_RE = /^[0-9a-fA-F-]{16,64}$/
const ESSENTIAL = new Set<string>(ESSENTIAL_TYPES)
const TYPES = new Set<string>(EVENT_TYPES)

/** Wrap a listener so an analytics bug can never surface to the page. */
export function safe<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args)
    } catch {
      /* analytics must never break the page */
    }
  }
}

export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode etc. */
  }
}

function ssGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function ssSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function readCookie(name: string): string | null {
  try {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
    return match?.[1] ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

/** `path=/; max-age=1800; SameSite=Lax` plus `Secure` on https (B7 / A53). */
export function writeCookie(name: string, value: string, maxAgeS = SID_MAX_AGE_S): void {
  try {
    const secure = location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `${name}=${value}; path=/; max-age=${maxAgeS}; SameSite=Lax${secure}`
  } catch {
    /* ignore */
  }
}

export function isEventType(v: unknown): v is EventType {
  return typeof v === 'string' && TYPES.has(v)
}

export function idle(cb: () => void, timeoutMs: number): void {
  try {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => cb(), { timeout: timeoutMs })
      return
    }
  } catch {
    /* fall through */
  }
  setTimeout(cb, timeoutMs)
}

/** Run once the document has loaded (immediately when it already has). */
export function afterLoad(cb: () => void): void {
  if (document.readyState === 'complete') cb()
  else addEventListener('load', () => cb(), { once: true })
}

export interface Accum {
  count: number
  totalMs: number
  longestMs: number
}

/** Long tasks / LoAF are not buffered by the browser, so core.ts accumulates them from init. */
export interface EarlyPerf {
  longTasks: Accum
  loaf: Accum
  loafScript: string | undefined
  loafSupported: boolean
}

interface LoafScript {
  sourceURL?: string
  invoker?: string
  sourceFunctionName?: string
}

interface LoafEntry extends PerformanceEntry {
  scripts?: LoafScript[]
}

function accum(): Accum {
  return { count: 0, totalMs: 0, longestMs: 0 }
}

/** Returns true when this entry is the new longest. */
function addTo(a: Accum, ms: number): boolean {
  a.count++
  a.totalMs += ms
  if (ms > a.longestMs) {
    a.longestMs = ms
    return true
  }
  return false
}

function startEarlyObservers(): EarlyPerf {
  const early: EarlyPerf = { longTasks: accum(), loaf: accum(), loafScript: undefined, loafSupported: false }
  let supported: readonly string[] = []
  try {
    supported = PerformanceObserver.supportedEntryTypes ?? []
  } catch {
    /* ignore */
  }
  try {
    if (supported.includes('longtask')) {
      new PerformanceObserver(
        safe((list: PerformanceObserverEntryList) => {
          for (const e of list.getEntries()) addTo(early.longTasks, e.duration)
        }),
      ).observe({ type: 'longtask', buffered: true })
    }
  } catch {
    /* ignore */
  }
  try {
    if (supported.includes('long-animation-frame')) {
      early.loafSupported = true
      new PerformanceObserver(
        safe((list: PerformanceObserverEntryList) => {
          for (const e of list.getEntries() as LoafEntry[]) {
            if (addTo(early.loaf, e.duration)) {
              const s = e.scripts?.[0]
              early.loafScript = (s?.sourceURL || s?.invoker || s?.sourceFunctionName || '').slice(0, 200) || undefined
            }
          }
        }),
      ).observe({ type: 'long-animation-frame', buffered: true })
    }
  } catch {
    /* ignore */
  }
  try {
    performance.setResourceTimingBufferSize(500)
  } catch {
    /* ignore */
  }
  return early
}

/** Filled in by perf.ts once the deferred chunk has loaded; until then the calls only raise the flags. */
export interface DeferredHooks {
  vitalsWanted: boolean
  perfWanted: boolean
  queueVitals: () => void
  queuePerf: () => void
}

export type FlushMode = 'timer' | 'keepalive' | 'beacon'

export interface Core {
  readonly vid: string
  /** Mutable: re-read from the `rb_sid` cookie before every flush / heartbeat and on `visible` (A5). */
  readonly sid: string
  readonly returning: boolean
  /** True while the router is on /ops (B17); every emit is dropped. */
  paused: boolean
  /** Pathname events attribute to (`u`); pages.ts moves it on navigation. */
  path: string
  track: Track
  /**
   * `'timer'` (default): plain fetch, re-queued once on rejection, sid re-read
   * first (A5). `'keepalive'`: keepalive fetch — an outbound click may unload
   * the page but the response can still ack. `'beacon'`: sendBeacon first,
   * keepalive fetch as fallback (hidden / pagehide). Lifecycle modes never
   * rotate the sid: their events belong to the session that produced them.
   */
  flush: (mode?: FlushMode) => void
  /**
   * Re-read the sid cookie. Gone or different → adopt / mint, `returning = true`,
   * reset the per-session budget and (unless `startVisit === false`) run the
   * rotation callbacks so pages.ts opens a new visit. Always refreshes the cookies.
   */
  ensureSid: (startVisit?: boolean) => boolean
  onRotate: (cb: () => void) => void
  /** Per-visit PAGE_CAPS counters start over (called by pages.ts for every visit). */
  resetPageCaps: () => void
  /** Resolves once a /api/collect flush for the current sid completed 2xx (the replay token cookie exists then). */
  whenAcked: () => Promise<void>
  isAcked: () => boolean
  /** Replay sampling decision persisted per sid in `rb_rr` (A0). */
  replayDecision: () => '1' | '0' | null
  setReplayDecision: (v: '1' | '0') => void
  early: EarlyPerf
  deferred: DeferredHooks
}

export function createCore(): Core {
  // -- identity ---------------------------------------------------------
  const hadVid = lsGet('rb_vid') !== null
  const vid = lsGet('rb_vid') ?? crypto.randomUUID()
  if (!hadVid) lsSet('rb_vid', vid)

  const cookieSid = readCookie('rb_sid')
  let sid = cookieSid !== null && ID_RE.test(cookieSid) ? cookieSid : crypto.randomUUID()
  let returning = hadVid && cookieSid === null
  let replayRoll: '1' | '0' | null = ((): '1' | '0' | null => {
    const v = readCookie('rb_rr')
    return v === '1' || v === '0' ? v : null
  })()

  const refreshCookies = (): void => {
    writeCookie('rb_sid', sid)
    if (replayRoll !== null) writeCookie('rb_rr', replayRoll)
  }
  refreshCookies()

  // -- ack (collect → replay ordering) -----------------------------------
  let acked = false
  let ackResolve: (() => void) | null = null
  let ackPromise: Promise<void> = new Promise<void>((r) => {
    ackResolve = r
  })
  const resetAck = (): void => {
    acked = false
    ackPromise = new Promise<void>((r) => {
      ackResolve = r
    })
  }
  const ack = (forSid: string): void => {
    if (forSid !== sid || acked) return
    acked = true
    ackResolve?.()
    ackResolve = null
  }

  // -- session rotation ----------------------------------------------------
  const rotateCbs: Array<() => void> = []
  let evN = Number(ssGet('rb_ev_n')) || 0

  const ensureSid = (startVisit = true): boolean => {
    let rotated = false
    try {
      const c = readCookie('rb_sid')
      if (c === null || c !== sid) {
        sid = c !== null && ID_RE.test(c) ? c : crypto.randomUUID()
        returning = true
        rotated = true
        evN = 0
        ssSet('rb_ev_n', '0')
        resetAck()
      }
      refreshCookies()
    } catch {
      /* ignore */
    }
    if (rotated && startVisit) for (const cb of rotateCbs) safe(cb)()
    return rotated
  }

  // -- queue + flush -------------------------------------------------------
  const queue: WireEvent[] = []
  const retried = new WeakSet<WireEvent>()
  let requeued = 0
  let pageCounts: Partial<Record<EventType, number>> = {}
  let paused = false
  let path = location.pathname

  const post = (body: string, keepalive: boolean): Promise<Response> =>
    fetch(COLLECT_URL, { method: 'POST', keepalive, headers: { 'content-type': 'application/json' }, body })

  const requeue = (events: WireEvent[]): void => {
    const fresh = events.filter((e) => !retried.has(e))
    if (fresh.length === 0 || requeued + fresh.length > REQUEUE_MAX) return
    requeued += fresh.length
    for (const e of fresh) retried.add(e)
    queue.unshift(...fresh)
  }

  const flush = (mode: FlushMode = 'timer'): void => {
    try {
      if (queue.length === 0) return
      if (mode === 'timer') ensureSid()
      ssSet('rb_ev_n', String(evN))
      while (queue.length > 0) {
        const events = queue.splice(0, ENVELOPE_MAX)
        const envSid = sid
        const envelope: WireEnvelope = {
          v: WIRE_VERSION,
          vid,
          sid,
          returning,
          url: location.pathname.slice(0, 200),
          events,
        }
        const body = JSON.stringify(envelope)
        if (mode !== 'timer') {
          let delivered = false
          if (mode === 'beacon') {
            try {
              delivered =
                typeof navigator.sendBeacon === 'function' &&
                navigator.sendBeacon(COLLECT_URL, new Blob([body], { type: 'application/json' }))
            } catch {
              delivered = false
            }
          }
          if (!delivered) {
            void post(body, true)
              .then((r) => {
                if (r.ok) ack(envSid)
              })
              .catch(() => {})
          }
        } else {
          void post(body, false)
            .then((r) => {
              if (r.ok) ack(envSid)
            })
            .catch(() => requeue(events))
        }
      }
    } catch {
      /* never surface */
    }
  }

  const track: Track = (type, name, ...rest) => {
    try {
      if (paused) return
      const cap = PAGE_CAPS[type]
      if (cap !== undefined) {
        const n = (pageCounts[type] ?? 0) + 1
        if (n > cap) return
        pageCounts[type] = n
      }
      if (evN >= SESSION_EVENT_CAP && !ESSENTIAL.has(type)) return
      evN++
      const p = rest[0]
      const ev = {
        t: Date.now(),
        type,
        name: typeof name === 'string' ? name.slice(0, 120) : null,
        u: path.slice(0, 200),
        ...(p !== undefined ? { p } : {}),
      } as WireEvent
      queue.push(ev)
      if (queue.length >= FLUSH_MAX_QUEUE) flush('timer')
    } catch {
      /* never surface */
    }
  }

  setInterval(() => flush('timer'), FLUSH_INTERVAL_MS)

  const deferred: DeferredHooks = {
    vitalsWanted: false,
    perfWanted: false,
    queueVitals() {
      deferred.vitalsWanted = true
    },
    queuePerf() {
      deferred.perfWanted = true
    },
  }

  return {
    vid,
    get sid() {
      return sid
    },
    get returning() {
      return returning
    },
    get paused() {
      return paused
    },
    set paused(v: boolean) {
      paused = v
    },
    get path() {
      return path
    },
    set path(v: string) {
      path = v
    },
    track,
    flush,
    ensureSid,
    onRotate(cb) {
      rotateCbs.push(cb)
    },
    resetPageCaps() {
      pageCounts = {}
    },
    whenAcked: () => ackPromise,
    isAcked: () => acked,
    replayDecision: () => replayRoll,
    setReplayDecision(v) {
      replayRoll = v
      writeCookie('rb_rr', v)
    },
    early: startEarlyObservers(),
    deferred,
  }
}
