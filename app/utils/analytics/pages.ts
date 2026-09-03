// Page lifecycle (contract §B.3, K1–K3, A5/A6/A13/A26/A31): one visit object
// per page, `pageview` / `page_leave`, scroll statistics and milestones,
// active / hidden time, the heartbeat payload, `visibility` snapshots and the
// `form abandon` rule. `docPvid` is pinned for the whole document load and is
// what vitals / perf carry.
import { START_LOCATION } from 'vue-router'
import type { Router } from 'vue-router'
import type { NuxtApp } from 'nuxt/app'
import { SCROLL_MILESTONES } from '#shared/analytics/events'
import type { DocFacts, FormP, NavKind, PageviewP } from '#shared/analytics/events'
import type { Core } from './core'
import { idle, safe } from './core'
import type { Sections } from './sections'

const HEARTBEAT_MS = 15_000
const INPUT_IDLE_MS = 30_000
const NAV_FALLBACK_MS = 3_000
const RESIZE_DEBOUNCE_MS = 400
/** A `pageshow` this close behind a rotation is the same restore (L6). */
const RESTORE_DEDUPE_MS = 50
/** Kinds that describe a real document load and therefore carry the document facts. */
const DOC_KINDS = new Set<NavKind>(['initial', 'reload', 'back_forward', 'prerender'])

/** The admin console is never part of the public dataset (B17 / L5). */
const isOps = (path: string): boolean => path.startsWith('/ops')

export interface Visit {
  pvid: string
  path: string
  enteredAt: number
  activeMs: number
  hiddenMs: number
  blurs: number
  maxScrollPct: number
  scrollPx: number
  scrollReversals: number
  maxScrollVel: number
  seen: Set<string>
  clicks: number
  ptr: number
  touch: number
  key: number
  consoleErrors: number
  textLen: number | null
  milestones: Set<number>
  formStarted: boolean
  formSubmitted: boolean
  formFocusAt: number
  leaveSent: boolean
}

export interface Pages {
  docPvid: string
  visit: () => Visit
  /** Called by the `__rbTrack` bridge for every `form` step so `abandon` can be derived on leave. */
  noteForm: (p: unknown) => void
  /** Runs when a visit ends (navigation, pagehide, rotation) — interactions.ts closes an open hover (L3). */
  onVisitEnd: (cb: () => void) => void
}

/** One `pageview` / visit opening. */
interface StartVisitOpts {
  path: string
  kind: NavKind
  pvid: string
  from: string | null
  softNavMs?: number
  /** SSR document-request facts (§B.8); only carried by a document-load pageview. */
  nav?: DocFacts | null
  /** Carry the document facts on a kind that normally omits them (M3: a bfcache restore that minted a sid). */
  facts?: boolean
  /** A rotation: device facts, but no referrer / campaign — that attribution closed with the old session (L8). */
  fresh?: boolean
}

export interface PagesDeps {
  core: Core
  nuxtApp: NuxtApp
  router: Router
  sections: Sections
  /** `useState('rbNav').value` — the SSR-captured document-request facts (§B.8). */
  nav: DocFacts | null
}

function navType(): NavKind {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    switch (entry?.type) {
      case 'reload':
        return 'reload'
      case 'back_forward':
        return 'back_forward'
      case 'prerender':
        return 'prerender'
      default:
        return 'initial'
    }
  } catch {
    return 'initial'
  }
}

function makeVisit(path: string, pvid: string): Visit {
  return {
    pvid,
    path,
    enteredAt: Date.now(),
    activeMs: 0,
    hiddenMs: 0,
    blurs: 0,
    maxScrollPct: 0,
    scrollPx: 0,
    scrollReversals: 0,
    maxScrollVel: 0,
    seen: new Set(),
    clicks: 0,
    ptr: 0,
    touch: 0,
    key: 0,
    consoleErrors: 0,
    textLen: null,
    milestones: new Set(),
    formStarted: false,
    formSubmitted: false,
    formFocusAt: 0,
    leaveSent: false,
  }
}

/**
 * Initial-document fields of a `pageview` (contract PageviewP; A31 = `path`
 * captured at init). `fresh` marks a session rotation: the device facts still
 * describe this browser, but the referrer and the campaign parameters brought
 * the session that just closed — replaying them would credit the new session
 * to an arrival it never had (L8).
 */
function docFacts(nav: DocFacts | null, fresh = false): Partial<PageviewP> {
  const params = new URLSearchParams(location.search)
  const get = (k: string): string | null => (fresh ? null : (params.get(k)?.slice(0, 200) ?? null))
  return {
    referrer: fresh ? '' : document.referrer.slice(0, 300),
    utm: {
      source: get('utm_source'),
      medium: get('utm_medium'),
      campaign: get('utm_campaign'),
      term: get('utm_term'),
      content: get('utm_content'),
    },
    screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
    viewport: { w: innerWidth, h: innerHeight },
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tzOffsetMin: Math.max(-900, Math.min(900, -new Date().getTimezoneOffset())),
    lang: navigator.language,
    nav,
  }
}

export function setupPages(deps: PagesDeps): Pages {
  const { core, nuxtApp, router, sections } = deps
  const { track } = core
  const docPvid = crypto.randomUUID()

  // -- time accounting (A26: exact residuals, not 15 s quanta) -----------
  let visible = document.visibilityState !== 'hidden'
  let lastInputAt = Date.now()
  let lastAccrueAt = lastInputAt
  let stateSince = lastInputAt
  let current = makeVisit(location.pathname, docPvid)

  const accrue = (now = Date.now()): void => {
    const dt = now - lastAccrueAt
    if (dt > 0) {
      if (visible) {
        const active = Math.min(now, lastInputAt + INPUT_IDLE_MS) - lastAccrueAt
        if (active > 0) current.activeMs += active
      } else {
        current.hiddenMs += dt
      }
    }
    lastAccrueAt = now
  }

  const noteInput = (): void => {
    const now = Date.now()
    accrue(now)
    lastInputAt = now
  }
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart']) {
    addEventListener(type, noteInput, { passive: true })
  }
  addEventListener(
    'blur',
    safe(() => {
      current.blurs++
    }),
  )

  // -- scroll (K3 / A6) ---------------------------------------------------
  let armed = false
  let ticking = false
  let lastY = 0
  let lastT = 0
  let lastDir = 0
  let resizeTimer: number | undefined

  const measureDepth = (): void => {
    const h = document.documentElement.scrollHeight
    const pct = h <= innerHeight + 1 ? 100 : Math.min(100, ((scrollY + innerHeight) / h) * 100)
    const rounded = Math.round(pct)
    if (rounded > current.maxScrollPct) current.maxScrollPct = rounded
    for (const m of SCROLL_MILESTONES) {
      if (pct >= m && !current.milestones.has(m)) {
        current.milestones.add(m)
        track('scroll_depth', null, { pct: m })
      }
    }
  }

  const onScrollFrame = safe((): void => {
    ticking = false
    if (!armed) return
    const now = performance.now()
    const y = scrollY
    const dy = y - lastY
    const dt = now - lastT
    if (dy !== 0) {
      current.scrollPx += Math.abs(dy)
      const dir = dy > 0 ? 1 : -1
      if (lastDir !== 0 && dir !== lastDir) current.scrollReversals++
      lastDir = dir
      if (dt > 0) current.maxScrollVel = Math.max(current.maxScrollVel, (Math.abs(dy) / dt) * 1000)
    }
    lastY = y
    lastT = now
    measureDepth()
  })

  addEventListener(
    'scroll',
    () => {
      if (!armed || ticking) return
      ticking = true
      requestAnimationFrame(onScrollFrame)
    },
    { passive: true },
  )
  addEventListener(
    'resize',
    () => {
      clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(
        safe(() => {
          if (armed) measureDepth()
        }),
        RESIZE_DEBOUNCE_MS,
      )
    },
    { passive: true },
  )

  /**
   * Arm milestone measuring only after the router's scroll restore (K3).
   * The site scrolls smoothly (`html { scroll-behavior: smooth }`), so the
   * router's scroll-to-top is a ~400 ms animation: measuring on the next
   * frame would read the OLD page's position against the NEW document and
   * fire every milestone. Wait until scrollY holds still for two frames
   * (capped at 700 ms), then arm.
   */
  const armScroll = (): void => {
    armed = false
    const startedAt = performance.now()
    let prevY = -1
    let stable = 0
    const tick = safe((): void => {
      const y = scrollY
      if (y === prevY) stable++
      else {
        stable = 0
        prevY = y
      }
      if (stable >= 2 || performance.now() - startedAt > 700) {
        armed = true
        lastY = scrollY
        lastT = performance.now()
        lastDir = 0
        measureDepth()
        return
      }
      requestAnimationFrame(tick)
    })
    requestAnimationFrame(() => requestAnimationFrame(tick))
  }

  const measureText = (): void => {
    const v = current
    idle(
      safe(() => {
        if (v !== current) return
        const main = document.querySelector<HTMLElement>('main')
        v.textLen = main ? main.innerText.length : null
      }),
      3_000,
    )
  }

  /** DOM-dependent work after a page settles: sections, scroll arming, text length. */
  const settle = (): void => {
    sections.rearm()
    armScroll()
    measureText()
  }

  // -- visits --------------------------------------------------------------
  const visitEndCbs: Array<() => void> = []

  const startVisit = (o: StartVisitOpts): void => {
    current = makeVisit(o.path, o.pvid)
    core.resetPageCaps()
    core.path = o.path
    lastAccrueAt = Date.now()
    armed = false
    const p: PageviewP = { pvid: o.pvid, path: o.path, from: o.from, kind: o.kind }
    if (o.softNavMs !== undefined) p.softNavMs = o.softNavMs
    if (o.facts === true || DOC_KINDS.has(o.kind)) Object.assign(p, docFacts(o.nav ?? null, o.fresh === true))
    track('pageview', null, p)
  }

  const emitLeave = (v: Visit, reason: 'spa' | 'unload'): void => {
    if (v.leaveSent) return
    v.leaveSent = true
    accrue()
    for (const cb of visitEndCbs) safe(cb)()
    // L5: a visit opened while the router sat on /ops is admin traffic and
    // never reaches the public dataset (its events are dropped while paused,
    // but this one would be emitted after the router left /ops again).
    if (isOps(v.path)) return
    if (v.formStarted && !v.formSubmitted) {
      track('form', null, { step: 'abandon', msSinceFocus: Math.max(0, Math.round(Date.now() - v.formFocusAt)) })
    }
    track('page_leave', null, {
      pvid: v.pvid,
      path: v.path,
      enteredAt: v.enteredAt,
      activeMs: Math.round(v.activeMs),
      hiddenMs: Math.round(v.hiddenMs),
      blurs: v.blurs,
      maxScrollPct: v.maxScrollPct,
      scrollPx: Math.round(v.scrollPx),
      scrollReversals: v.scrollReversals,
      maxScrollVel: Math.round(v.maxScrollVel),
      sectionsSeen: v.seen.size,
      clicks: v.clicks,
      ptr: v.ptr,
      touch: v.touch,
      key: v.key,
      consoleErrors: v.consoleErrors,
      textLen: v.textLen,
      reason,
    })
  }

  // Initial pageview: queued immediately so a bounce before mount still lands (A31).
  startVisit({ path: location.pathname, kind: navType(), pvid: docPvid, from: null, nav: deps.nav })

  // A5: the sid cookie expired or another tab holds a different sid → new
  // session, new visit. M1: the visit that is being closed still belongs to the
  // old session, so its exits and its page_leave are emitted first — core then
  // drains the queue under the old sid before adopting the new one.
  let rotatedAt = -Infinity
  core.onBeforeRotate(() => {
    sections.forceExit()
    emitLeave(current, 'unload')
  })
  core.onRotate(() => {
    rotatedAt = Date.now()
    sections.reset()
    startVisit({ path: location.pathname, kind: 'reload', pvid: crypto.randomUUID(), from: null, fresh: true })
    settle()
  })

  // -- router (K1) -----------------------------------------------------------
  let pendingNav: { from: string | null; to: string; startedAt: number; kind: 'spa' | 'spa_back' } | null = null
  let popstateFlag = false
  let navStartAt = 0
  let fallbackTimer: number | undefined

  const finishNav = safe((): void => {
    clearTimeout(fallbackTimer)
    const n = pendingNav
    pendingNav = null
    // M1: a rotation that came due during the navigation is applied here, on
    // the settled path — the rotation callback opens the visit for the new
    // page, so the SPA pageview would be a duplicate.
    if (core.ensureSid()) return
    if (n) {
      startVisit({
        path: n.to,
        kind: n.kind,
        pvid: crypto.randomUUID(),
        from: n.from,
        softNavMs: Math.max(0, Math.round(performance.now() - n.startedAt)),
      })
    }
    settle()
  })

  router.beforeEach((to, from) => {
    try {
      core.paused = isOps(to.path)
      if (to.path !== from.path) navStartAt = performance.now()
    } catch {
      /* ignore */
    }
  })

  router.afterEach((to, from, failure) => {
    try {
      // L1: the popstate flag describes THIS navigation; a navigation that
      // never reaches the body below must not hand it to the next one.
      const back = popstateFlag
      popstateFlag = false
      // Nuxt runs the initial router.replace after user plugins register guards.
      if (failure || from === START_LOCATION || from.matched.length === 0 || to.path === from.path) return
      // L2: the old document is still on screen until the new page settles —
      // a scroll in between would measure it against the new path.
      armed = false
      const toPaused = core.paused
      core.paused = false
      sections.forceExit()
      emitLeave(current, 'spa')
      // M1: `rotate: false` — a rotation here would emit a second pageview for
      // the page finishNav is about to open. finishNav applies it instead.
      core.flush('timer', { rotate: false })
      core.paused = toPaused
      if (toPaused) return
      pendingNav = {
        // L5: /ops is not a public referrer.
        from: isOps(from.path) ? null : from.path,
        to: to.path,
        startedAt: navStartAt || performance.now(),
        kind: back ? 'spa_back' : 'spa',
      }
      core.path = to.path
      clearTimeout(fallbackTimer)
      fallbackTimer = window.setTimeout(finishNav, NAV_FALLBACK_MS)
    } catch {
      /* ignore */
    }
  })

  nuxtApp.hook('page:finish', () => {
    if (nuxtApp.isHydrating) return
    finishNav()
  })
  nuxtApp.hook('app:mounted', () => {
    safe(settle)()
  })

  addEventListener('popstate', () => {
    popstateFlag = true
  })

  // -- document lifecycle -----------------------------------------------------
  addEventListener(
    'pageshow',
    safe((e: PageTransitionEvent) => {
      if (!e.persisted) return
      const now = Date.now()
      visible = document.visibilityState !== 'hidden'
      lastInputAt = now
      lastAccrueAt = now
      stateSince = now
      // M3: a restore after the cookie expired mints a new sid — that session
      // has no document load of its own, so this pageview carries the facts.
      const rotated = core.ensureSid(false)
      // L6: a visibility change on the same restore may already have rotated
      // and opened this visit; do not open a second one for it.
      if (!rotated && Date.now() - rotatedAt < RESTORE_DEDUPE_MS && current.path === location.pathname) return
      sections.reset()
      startVisit({
        path: location.pathname,
        kind: 'bfcache',
        pvid: crypto.randomUUID(),
        from: null,
        nav: rotated ? deps.nav : null,
        facts: rotated,
      })
      settle()
    }),
  )

  addEventListener(
    'pagehide',
    safe(() => {
      accrue()
      sections.forceExit()
      emitLeave(current, 'unload')
      core.deferred.queueVitals()
      core.deferred.queuePerf()
      core.flush('beacon')
    }),
  )

  document.addEventListener(
    'visibilitychange',
    safe(() => {
      const hidden = document.visibilityState === 'hidden'
      if (hidden !== visible) return
      const now = Date.now()
      accrue(now)
      const ms = now - stateSince
      stateSince = now
      visible = !hidden
      if (hidden) {
        sections.forceExit()
        core.deferred.queueVitals()
        core.deferred.queuePerf()
        track('visibility', null, {
          state: 'hidden',
          ms,
          pvid: current.pvid,
          activeMs: Math.round(current.activeMs),
          maxScrollPct: current.maxScrollPct,
        })
        core.flush('beacon')
      } else {
        lastInputAt = now
        core.ensureSid()
        track('visibility', null, { state: 'visible', ms })
        sections.rearm()
      }
    }),
  )

  // -- heartbeat ------------------------------------------------------------------
  setInterval(
    safe(() => {
      if (!visible || Date.now() - lastInputAt > INPUT_IDLE_MS) return
      core.ensureSid()
      accrue()
      track('heartbeat', null, {
        pvid: current.pvid,
        activeMs: Math.round(current.activeMs),
        maxScrollPct: current.maxScrollPct,
      })
    }),
    HEARTBEAT_MS,
  )

  return {
    docPvid,
    visit: () => current,
    onVisitEnd(cb) {
      visitEndCbs.push(cb)
    },
    noteForm(p) {
      const step = (p as Partial<FormP> | undefined)?.step
      if (step === 'focus' && !current.formStarted) {
        current.formStarted = true
        current.formFocusAt = Date.now()
      } else if (step === 'submit') {
        current.formSubmitted = true
      }
    },
  }
}
