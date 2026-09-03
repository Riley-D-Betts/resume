// Interactions (contract §B.4, A12, B2, B5, D18): click / rage / dead clicks,
// outbound (cross-origin + mailto/tel), hover, copy / select, print, find,
// exit intent, viewport changes, first interaction and the input-mode
// counters on the visit. `subtab`, `site_search` and `form` steps arrive
// through `window.__rbTrack` (components) and are only routed here.
import { selectorPath } from '~/utils/selectorPath'
import type { ClickP, ViewportP } from '#shared/analytics/events'
import type { Core } from './core'
import { safe } from './core'
import type { Pages } from './pages'

const RAGE_WINDOW_MS = 700
const RAGE_RADIUS_PX = 30
const DEAD_WAIT_MS = 400
const HOVER_MIN_MS = 300
const SELECT_DEBOUNCE_MS = 800
const SELECT_MIN_LEN = 20
const EXIT_DEBOUNCE_MS = 1_000
const VIEWPORT_DEBOUNCE_MS = 400
const FIND_DEBOUNCE_MS = 1_000

/** Elements whose text names a click (B5). */
const CLICK_TEXT = 'a,button,[role=button],summary,label,input,select,option'
/** A pointerdown without one of these ancestors is a dead-click candidate. */
const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role=button],[contenteditable],[tabindex]'
/** Enter activates these from the keyboard. */
const KEY_ACTIVATABLE =
  'a[href],button,[role=button],summary,input[type=button],input[type=submit],input[type=checkbox],input[type=radio]'
/** Space activates the button-like subset — it scrolls the page on a link (L4). */
const SPACE_ACTIVATABLE =
  'button,[role=button],summary,input[type=button],input[type=submit],input[type=checkbox],input[type=radio]'
/** Copy / select are never captured inside these (D18); `contenteditable="false"` is ordinary text (L10). */
const EXCLUDED = 'input,textarea,[contenteditable]:not([contenteditable="false"])'
const FIELD = 'input,select,textarea'
const HOVER_KEY_RE = /^(email|github|contact-cta|kpi:[a-z0-9-]{1,30})$/
/** Attributes whose change means the page reacted to a click (M4). */
const DEAD_ATTRS = ['class', 'style', 'hidden', 'aria-expanded', 'aria-selected', 'open']
/** A resize this far below the height (and no width change) is a URL bar or a keyboard (M5). */
const VIEWPORT_MIN_H_RATIO = 0.25

const text = (el: Element, max: number): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** A touch waiting for its `pointerup` (H1). */
interface Tap {
  id: number
  target: Element
  button: 0 | 1 | 2
  x: number
  y: number
  mod: boolean
  /** Ctrl / Cmd — the `outbound` new-tab hint. */
  ctrl: boolean
}

/**
 * `click.href` for a link: the same-origin **pathname**, which is all the
 * server's whitelist accepts (`asPath`), so the clicks-per-page view can name
 * the link. Cross-origin, `mailto:` and `tel:` return null — the `outbound`
 * event already carries those, and an absolute URL here only stored a NULL (H2).
 */
export function clickHref(href: string, baseHref: string): string | null {
  try {
    const url = new URL(href, baseHref)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.origin !== new URL(baseHref).origin) return null
    return url.pathname.slice(0, 200)
  } catch {
    return null
  }
}

/**
 * True when a resize is worth an event. Mobile browsers fire `resize` when the
 * URL bar collapses or the keyboard opens — same width, a modest height change
 * — and scrolling a page would otherwise fill the table with junk rows (M5).
 */
export function viewportChanged(prev: { w: number; h: number }, next: { w: number; h: number }): boolean {
  if (next.w !== prev.w) return true
  return Math.abs(next.h - prev.h) >= Math.max(1, prev.h) * VIEWPORT_MIN_H_RATIO
}

const sectionOf = (el: Element): string | undefined =>
  el.closest<HTMLElement>('[data-section]')?.dataset.section || undefined

/** `section` when inside one, otherwise the chrome `zone` (mast / nav / footer / record-actions). */
function place(el: Element): { section?: string; zone?: string } {
  const section = sectionOf(el)
  if (section) return { section }
  const zone = el.closest<HTMLElement>('[data-zone]')?.dataset.zone
  return zone ? { zone } : {}
}

export function setupInteractions(core: Core, pages: Pages): void {
  const { track } = core
  const doc = document

  // -- contact email, discovered in the DOM (hasEmail) ---------------------
  let email: string | null = null
  const contactEmail = (): string | null => {
    if (email) return email
    const a = doc.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')
    if (!a) return null
    try {
      email = decodeURIComponent(a.getAttribute('href')!.slice(7).split('?')[0]!).trim().toLowerCase() || null
    } catch {
      email = null
    }
    return email
  }
  const hasEmail = (s: string): boolean => {
    const e = contactEmail()
    return e !== null && s.toLowerCase().includes(e)
  }

  // -- first interaction -----------------------------------------------------
  let firstDone = false
  const firstInteraction = (kind: 'pointer' | 'touch' | 'keyboard' | 'wheel'): void => {
    if (firstDone) return
    firstDone = true
    track('first_interaction', null, { ms: Math.round(performance.now()), kind })
  }
  addEventListener('wheel', () => firstInteraction('wheel'), { passive: true, once: true })
  addEventListener('touchstart', () => firstInteraction('touch'), { passive: true, once: true })

  // -- dead-click support: a counter-only MutationObserver on <main> ----------
  let mutations = 0
  let mo: MutationObserver | undefined
  const ensureMutationObserver = (): void => {
    if (mo) return
    const root = doc.querySelector('main') ?? doc.body
    if (!root) return
    mo = new MutationObserver(() => {
      mutations++
    })
    // M4: collapsing a portlet only toggles a class — without the attribute
    // filter that reaction looked like nothing happened, i.e. a dead click.
    mo.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: DEAD_ATTRS,
    })
  }

  // -- click / rage / dead / outbound -------------------------------------------
  let burst: { t: number; x: number; y: number; n: number } | null = null

  const emitClick = (
    target: Element,
    button: 0 | 1 | 2,
    kind: ClickP['kind'],
    x: number,
    y: number,
    mod: boolean,
  ): void => {
    const el = target.closest(CLICK_TEXT) ?? target
    const p: ClickP = {
      sel: selectorPath(el),
      text: el.matches(FIELD) ? '' : text(el, 60),
      x,
      y,
      tag: el.tagName.toLowerCase(),
      button,
      kind,
      mod,
      ...place(target),
    }
    const a = target.closest<HTMLAnchorElement>('a[href]')
    const href = a ? clickHref(a.href, location.href) : null
    if (href !== null) p.href = href
    pages.visit().clicks++
    track('click', null, p)
  }

  const rage = (target: Element, x: number, y: number, now: number): void => {
    if (
      burst &&
      now - burst.t <= RAGE_WINDOW_MS &&
      Math.abs(x - burst.x) <= RAGE_RADIUS_PX &&
      Math.abs(y - burst.y) <= RAGE_RADIUS_PX
    ) {
      burst.n++
      burst.t = now
    } else {
      burst = { t: now, x, y, n: 1 }
    }
    if (burst.n >= 3 && burst.n % 3 === 0) {
      track('rage_click', null, { n: burst.n, sel: selectorPath(target), x, y, ...sectionOnly(target) })
    }
  }

  const sectionOnly = (el: Element): { section?: string } => {
    const section = sectionOf(el)
    return section ? { section } : {}
  }

  const dead = (target: Element): void => {
    if (target.closest(INTERACTIVE)) return
    ensureMutationObserver()
    const path = location.pathname
    const before = mutations
    const sel = selectorPath(target)
    const label = text(target, 60)
    const section = sectionOnly(target)
    setTimeout(
      safe(() => {
        if (mutations !== before || location.pathname !== path) return
        if ((getSelection()?.toString() ?? '') !== '') return
        track('dead_click', null, { sel, text: label, ...section })
      }),
      DEAD_WAIT_MS,
    )
  }

  const outbound = (target: Element, button: 0 | 1, mod: boolean): void => {
    const a = target.closest<HTMLAnchorElement>('a[href]')
    if (!a) return
    let url: URL
    try {
      url = new URL(a.href, location.href)
    } catch {
      return
    }
    const label = text(a, 80)
    if (url.protocol === 'mailto:' || url.protocol === 'tel:') {
      const scheme = url.protocol.slice(0, -1)
      track('outbound', scheme, {
        href: `${scheme}:${url.pathname}`.slice(0, 120),
        label,
        button,
        newTab: false,
        ...place(a),
      })
    } else {
      if (url.origin === location.origin) return
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return
      track('outbound', url.host, {
        href: url.href.slice(0, 300),
        label,
        button,
        newTab: a.target === '_blank' || button === 1 || mod,
        ...place(a),
      })
    }
    core.flush('keepalive') // the navigation may unload the page before the next tick
  }

  /** click + rage + dead + outbound for one activation. */
  const commit = (
    target: Element,
    button: 0 | 1 | 2,
    kind: ClickP['kind'],
    x: number,
    y: number,
    mod: boolean,
    ctrl: boolean,
  ): void => {
    emitClick(target, button, kind, x, y, mod)
    if (button === 0) {
      rage(target, x, y, performance.now())
      dead(target)
    }
    if (button !== 2) outbound(target, button, ctrl)
  }

  /**
   * H1: a touch scroll starts with a `pointerdown` on whatever is under the
   * thumb and is then cancelled, so committing on the down event turned
   * thumb-scrolling into clicks, dead clicks and — over the contact page's
   * mailto link — an outbound mail handoff nobody made. A touch is therefore
   * only a tap once its `pointerup` lands on the same target uncancelled.
   * Mouse and pen still commit on `pointerdown` (that is when they act).
   */
  let tap: Tap | null = null

  doc.addEventListener(
    'pointerdown',
    safe((ev: PointerEvent) => {
      if (!ev.isPrimary) return
      const target = ev.target
      if (!(target instanceof Element)) return
      const v = pages.visit()
      const kind: ClickP['kind'] = ev.pointerType === 'touch' ? 'touch' : ev.pointerType === 'pen' ? 'pen' : 'pointer'
      if (kind === 'touch') v.touch++
      else v.ptr++
      firstInteraction(kind === 'touch' ? 'touch' : 'pointer')
      const button = ev.button
      if (button !== 0 && button !== 1 && button !== 2) return
      const x = Math.round(ev.clientX)
      const y = Math.round(ev.clientY)
      const mod = ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey
      const ctrl = ev.ctrlKey || ev.metaKey
      if (kind === 'touch') {
        tap = { id: ev.pointerId, target, button, x, y, mod, ctrl }
        return
      }
      commit(target, button, kind, x, y, mod, ctrl)
    }),
    { capture: true, passive: true },
  )

  doc.addEventListener(
    'pointerup',
    safe((ev: PointerEvent) => {
      const t = tap
      tap = null
      if (!t || ev.pointerId !== t.id || ev.target !== t.target) return
      commit(t.target, t.button, 'touch', t.x, t.y, t.mod, t.ctrl)
    }),
    { capture: true, passive: true },
  )

  // The browser cancels the pointer the moment it starts scrolling.
  const dropTap = safe((ev: PointerEvent) => {
    if (tap && tap.id === ev.pointerId) tap = null
  })
  doc.addEventListener('pointercancel', dropTap, { capture: true, passive: true })

  // -- keyboard: activation clicks + find ------------------------------------------
  let lastFind = -Infinity
  doc.addEventListener(
    'keydown',
    safe((ev: KeyboardEvent) => {
      pages.visit().key++
      firstInteraction('keyboard')
      if (((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'f') || ev.key === 'F3') {
        const now = performance.now()
        if (now - lastFind >= FIND_DEBOUNCE_MS) {
          lastFind = now
          track('find', null)
        }
        return
      }
      if (ev.key !== 'Enter' && ev.key !== ' ') return
      // L4: a held key repeats; only the first press is an activation.
      if (ev.repeat) return
      const target = ev.target
      // L4: Space scrolls a link, it does not follow it.
      if (!(target instanceof Element) || !target.matches(ev.key === ' ' ? SPACE_ACTIVATABLE : KEY_ACTIVATABLE)) return
      const r = target.getBoundingClientRect()
      const mod = ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey
      emitClick(target, 0, 'keyboard', Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), mod)
      outbound(target, 0, ev.ctrlKey || ev.metaKey)
    }),
    { capture: true, passive: true },
  )

  // -- hover on [data-track-hover] (fine pointers only) -------------------------------
  if (matchMedia('(hover: hover)').matches) {
    let hover: { el: Element; key: string; at: number } | null = null
    const endHover = (): void => {
      if (!hover) return
      const ms = Math.round(performance.now() - hover.at)
      const { key } = hover
      hover = null
      if (ms >= HOVER_MIN_MS) track('hover', key, { ms })
    }
    // L3: a navigation (or a re-render) removes the hovered element, and its
    // `mouseout` never arrives — the dwell would then be attributed to the
    // next page, or run until the next hover replaced it.
    pages.onVisitEnd(endHover)
    doc.addEventListener(
      'mouseover',
      safe((ev: MouseEvent) => {
        const t = ev.target
        if (!(t instanceof Element)) return
        const el = t.closest<HTMLElement>('[data-track-hover]')
        if (hover && !hover.el.isConnected) endHover()
        if (hover && hover.el === el) return
        endHover()
        const key = el?.dataset.trackHover ?? ''
        if (el && HOVER_KEY_RE.test(key)) hover = { el, key, at: performance.now() }
      }),
      { passive: true },
    )
    doc.addEventListener(
      'mouseout',
      safe((ev: MouseEvent) => {
        if (!hover) return
        const rel = ev.relatedTarget
        if (rel instanceof Node && hover.el.contains(rel)) return
        endHover()
      }),
      { passive: true },
    )
  }

  // -- copy / cut / select (D18 exclusion zones) --------------------------------------
  const selection = (): { text: string; anchor: Element | null } | null => {
    const sel = getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const active = doc.activeElement
    if (active && active.matches(EXCLUDED)) return null
    const node = sel.anchorNode
    const anchor = node instanceof Element ? node : (node?.parentElement ?? null)
    if (anchor?.closest(EXCLUDED)) return null
    return { text: sel.toString(), anchor }
  }

  const onCopy = safe((): void => {
    const s = selection()
    if (!s || s.text.length === 0) return
    track('copy', null, {
      len: s.text.length,
      snippet: s.text.replace(/\s+/g, ' ').trim().slice(0, 80),
      hasEmail: hasEmail(s.text),
      ...(s.anchor ? sectionOnly(s.anchor) : {}),
      sel: s.anchor ? selectorPath(s.anchor) : '',
    })
  })
  doc.addEventListener('copy', onCopy, { passive: true })
  doc.addEventListener('cut', onCopy, { passive: true })

  let selectTimer: number | undefined
  let lastSelected = ''
  doc.addEventListener(
    'selectionchange',
    () => {
      clearTimeout(selectTimer)
      selectTimer = window.setTimeout(
        safe(() => {
          const s = selection()
          if (!s || s.text.length < SELECT_MIN_LEN || s.text === lastSelected) return
          lastSelected = s.text
          track('select', null, {
            len: s.text.length,
            hasEmail: hasEmail(s.text),
            ...(s.anchor ? sectionOnly(s.anchor) : {}),
          })
        }),
        SELECT_DEBOUNCE_MS,
      )
    },
    { passive: true },
  )

  // -- print -----------------------------------------------------------------------------
  let printAt = 0
  addEventListener(
    'beforeprint',
    safe(() => {
      printAt = performance.now()
      track('print', null, { phase: 'before' })
    }),
  )
  addEventListener(
    'afterprint',
    safe(() => {
      track('print', null, { phase: 'after', ms: Math.max(0, Math.round(performance.now() - printAt)) })
    }),
  )

  // -- exit intent (fine pointers only) -----------------------------------------------------
  if (matchMedia('(pointer: fine)').matches) {
    let lastExit = -Infinity
    doc.addEventListener(
      'mouseout',
      safe((ev: MouseEvent) => {
        if (ev.relatedTarget !== null || ev.clientY > 0) return
        const now = performance.now()
        if (now - lastExit < EXIT_DEBOUNCE_MS) return
        lastExit = now
        track('exit_intent', null, { x: Math.round(ev.clientX), y: Math.round(ev.clientY) })
      }),
      { passive: true },
    )
  }

  // -- viewport: resize / zoom / pinch / orientation -----------------------------------------
  const vv = window.visualViewport
  const orientationType = (): string => {
    try {
      return screen.orientation?.type ?? (innerWidth >= innerHeight ? 'landscape-primary' : 'portrait-primary')
    } catch {
      return innerWidth >= innerHeight ? 'landscape-primary' : 'portrait-primary'
    }
  }
  let lastSize = { w: innerWidth, h: innerHeight }
  const emitViewport = (cause: ViewportP['cause']): void => {
    lastSize = { w: innerWidth, h: innerHeight }
    track('viewport', null, {
      w: innerWidth,
      h: innerHeight,
      scale: Math.round((vv?.scale ?? 1) * 100) / 100,
      dpr: Math.round(devicePixelRatio * 100) / 100,
      orientation: orientationType(),
      cause,
    })
  }
  let lastDpr = devicePixelRatio
  let orientedAt = -Infinity
  let resizeTimer: number | undefined
  addEventListener(
    'resize',
    () => {
      clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(
        safe(() => {
          if (performance.now() - orientedAt < VIEWPORT_DEBOUNCE_MS * 2) return
          const zoomed = devicePixelRatio !== lastDpr
          // M5: a collapsing URL bar / an opening keyboard resizes the height
          // only, and only a little — that is scrolling, not a viewport change.
          if (!zoomed && !viewportChanged(lastSize, { w: innerWidth, h: innerHeight })) return
          lastDpr = devicePixelRatio
          emitViewport(zoomed ? 'zoom' : 'resize')
        }),
        VIEWPORT_DEBOUNCE_MS,
      )
    },
    { passive: true },
  )
  if (vv) {
    let pinchTimer: number | undefined
    vv.addEventListener(
      'resize',
      () => {
        clearTimeout(pinchTimer)
        pinchTimer = window.setTimeout(
          safe(() => {
            if (vv.scale !== 1) emitViewport('pinch')
          }),
          VIEWPORT_DEBOUNCE_MS,
        )
      },
      { passive: true },
    )
  }
  try {
    screen.orientation?.addEventListener(
      'change',
      safe(() => {
        orientedAt = performance.now()
        emitViewport('orientation')
      }),
    )
  } catch {
    /* ignore */
  }
}
