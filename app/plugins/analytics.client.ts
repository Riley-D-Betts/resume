// First-party analytics (contract §B): composes the tracker modules under
// app/utils/analytics/. Public pages only; every path is fail-open so a bug
// here can never break the site. The component bridge is `window.__rbTrack`
// (declared once in app/types/rb-track.d.ts, reached via `useTrack()`).
import type { DocFacts } from '#shared/analytics/events'
import { createCore, isEventType, lsGet, lsSet, safe } from '~/utils/analytics/core'
import type { LooseTrack } from '~/utils/analytics/core'
import { setupErrors } from '~/utils/analytics/errors'
import { setupInteractions } from '~/utils/analytics/interactions'
import { setupPages } from '~/utils/analytics/pages'
import type { Pages } from '~/utils/analytics/pages'
import { setupReplay } from '~/utils/analytics/replay'
import { createSections } from '~/utils/analytics/sections'

export default defineNuxtPlugin((nuxtApp) => {
  try {
    // -- guards (§B.1) ------------------------------------------------------
    if (location.pathname.startsWith('/ops')) return
    if (new URLSearchParams(location.search).get('optout') === '1') {
      lsSet('rb_optout', '1')
      console.info('[rb] analytics opt-out saved — this browser will not be tracked')
    }
    if (lsGet('rb_optout')) return
    const config = useRuntimeConfig().public
    if (config.honorGpc && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true) {
      return
    }

    // -- core + bridge ------------------------------------------------------
    const core = createCore()
    let pages: Pages | undefined
    const loose = core.track as unknown as LooseTrack
    window.__rbTrack = safe((type: string, name?: string | null, p?: Record<string, unknown>) => {
      if (!isEventType(type)) return
      const payload = p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length > 0 ? p : undefined
      if (type === 'form') pages?.noteForm(payload)
      loose(type, typeof name === 'string' ? name : null, payload)
    })

    // -- pages, sections, interactions, errors ------------------------------
    const router = useRouter()
    // L5: the recorder never follows the visitor into the admin console. This
    // guard is registered before the one setupPages installs, so the tracker is
    // still unpaused here and `replay_stopped` is actually reported.
    let stopReplay: ((reason: string) => void) | null = null
    router.beforeEach(
      safe((to: { path: string }) => {
        if (to.path.startsWith('/ops')) stopReplay?.('ops')
      }),
    )
    const sections = createSections(core, () => pages!.visit())
    pages = setupPages({
      core,
      nuxtApp,
      router,
      sections,
      nav: useState<DocFacts | null>('rbNav', () => null).value ?? null,
    })
    setupInteractions(core, pages)
    setupErrors(core, pages)

    // -- session replay (sampled per sid, one recording per document load) --
    const rawRate = Number(config.replaySampleRate)
    const replay = setupReplay({
      getSid: () => core.sid,
      onRotate: core.onRotate,
      keepaliveBytes: core.keepaliveBytes,
      sampleRate: Number.isFinite(rawRate) ? Math.min(1, Math.max(0, rawRate)) : 0,
      decision: core.replayDecision,
      setDecision: core.setReplayDecision,
      whenAcked: core.whenAcked,
      isAcked: core.isAcked,
      track: core.track,
    })
    stopReplay = replay.stop
    addEventListener(
      'pagehide',
      safe(() => replay.flushTail()),
    )

    // -- deferred chunk: vitals + perf + env (kept out of the entry) ---------
    const docPvid = pages.docPvid
    nuxtApp.hook('app:mounted', () => {
      void import('~/utils/analytics/perf')
        .then((m) => m.setupDeferred(core, docPvid))
        .catch(() => {})
    })
  } catch {
    /* analytics must never break the page */
  }
})
