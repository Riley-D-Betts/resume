// Section dwell (contract §B.6, K2/K7, A1): an IntersectionObserver over every
// `[data-section]`, re-armed per page and on `visible`. A section counts as in
// view when `ratio ≥ .5` or its visible slice fills ≥ 60 % of the viewport;
// `section_enter` is deferred 500 ms so enter/exit are only ever emitted as a
// pair with `dwellMs ≥ 500` (no orphan enters).
import type { Core } from './core'
import { safe } from './core'
import type { Visit } from './pages'

const THRESHOLDS = [0, 0.1, 0.25, 0.5, 0.75, 1]
const ENTER_MS = 500
const NAME_RE = /^[a-z0-9._:-]{1,40}$/i

interface SectionState {
  name: string
  timer?: number
  candidateAt?: number
  enteredAt?: number
}

export interface Sections {
  /** Re-query `[data-section]` and observe again (app:mounted, page:finish, visible). */
  rearm: () => void
  /** Emit exits for every open section (hidden, pagehide, SPA leave). */
  forceExit: () => void
  /** Close every open section (as a pair) and drop pending candidates (session rotation, bfcache restore). */
  reset: () => void
}

export function createSections(core: Core, visit: () => Visit): Sections {
  const state = new Map<Element, SectionState>()
  let io: IntersectionObserver | undefined

  const inView = (e: IntersectionObserverEntry): boolean =>
    e.isIntersecting && (e.intersectionRatio >= 0.5 || e.intersectionRect.height >= 0.6 * innerHeight)

  const cancel = (s: SectionState): void => {
    if (s.timer !== undefined) {
      clearTimeout(s.timer)
      s.timer = undefined
    }
    s.candidateAt = undefined
  }

  const exit = (s: SectionState): void => {
    cancel(s)
    if (s.enteredAt === undefined) return
    const dwellMs = Math.max(ENTER_MS, Date.now() - s.enteredAt)
    s.enteredAt = undefined
    const v = visit()
    v.seen.add(s.name)
    core.track('section_exit', s.name, { dwellMs, pvid: v.pvid })
  }

  const enter = (el: Element, s: SectionState): void => {
    if (s.enteredAt !== undefined || s.timer !== undefined) return
    const at = Date.now()
    s.candidateAt = at
    s.timer = window.setTimeout(
      safe(() => {
        s.timer = undefined
        if (!el.isConnected || s.candidateAt === undefined) return
        s.enteredAt = at
        core.track('section_enter', s.name)
      }),
      ENTER_MS,
    )
  }

  const onEntries = safe((entries: IntersectionObserverEntry[]): void => {
    for (const e of entries) {
      const s = state.get(e.target)
      if (!s) continue
      if (inView(e)) enter(e.target, s)
      else exit(s)
    }
  })

  const rearm = (): void => {
    try {
      io?.disconnect()
      io = new IntersectionObserver(onEntries, { threshold: THRESHOLDS })
      const present = new Set<Element>()
      for (const el of document.querySelectorAll<HTMLElement>('[data-section]')) {
        const name = el.dataset.section ?? ''
        if (!NAME_RE.test(name)) continue
        present.add(el)
        if (!state.has(el)) state.set(el, { name })
        io.observe(el)
      }
      for (const [el, s] of state) {
        if (present.has(el)) continue
        exit(s)
        state.delete(el)
      }
    } catch {
      /* ignore */
    }
  }

  return {
    rearm,
    forceExit() {
      for (const s of state.values()) exit(s)
    },
    reset() {
      // L7: an open section still owes its exit — dropping `enteredAt` here
      // left an orphan `section_enter` with no dwell. `exit()` cancels the
      // pending candidate and honours the 500 ms pair rule.
      for (const s of state.values()) exit(s)
    },
  }
}
