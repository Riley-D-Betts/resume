import { resume } from '~/data/resume'

declare global {
  interface Window {
    __rbTrack?: (type: string, name?: string, p?: Record<string, unknown>) => void
    ops?: Record<string, unknown>
  }
}

/**
 * Easter eggs: the console banner + maintenance interface, and the
 * Konami-code ANDON DRILL. Finding either fires an easter_egg analytics
 * event — Riley gets to see who looked under the hood.
 */
export default defineNuxtPlugin(() => {
  if (location.pathname.startsWith('/ops')) return

  // -- console banner --------------------------------------
  const art = resume.eggs.consoleBanner.join('\n')
  // eslint-disable-next-line no-console
  console.log(`%c${art}`, 'color:#00b4c8; font-family:monospace;')
  // eslint-disable-next-line no-console
  console.log(`%c${resume.eggs.consoleHint}`, 'color:#5c6b6e; font-family:monospace;')

  const epoch = new Date(`${resume.identity.hiredISO}T08:00:00-07:00`).getTime()
  window.ops = {
    help() {
      return ['ops.uptime()  — career uptime', 'ops.hire()    — open a channel', 'ops.andon()   — run the drill']
    },
    uptime() {
      const days = ((Date.now() - epoch) / 86400000).toFixed(2)
      window.__rbTrack?.('easter_egg', 'console')
      return `${days} days without a lost weekend. (mostly)`
    },
    hire() {
      window.__rbTrack?.('easter_egg', 'console')
      location.href = `mailto:${resume.identity.email}`
      return 'opening channel…'
    },
    andon() {
      runDrill()
      return 'DRILL INITIATED'
    },
  }

  // -- konami → ANDON DRILL --------------------------------
  const CODE = [
    'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
  ]
  let pos = 0

  async function runDrill() {
    window.__rbTrack?.('easter_egg', 'konami')
    const { gsap } = await import('gsap')
    const lamps = gsap.utils.toArray<HTMLElement>('.lamp')
    if (!lamps.length) return
    const tl = gsap.timeline()
    for (const color of ['var(--red)', 'var(--amber)', 'var(--green)']) {
      tl.to(lamps, { backgroundColor: color, duration: 0.12, stagger: { each: 0.015, from: 'start' } }, '>')
    }
    tl.set(lamps, { clearProps: 'backgroundColor' }, '+=0.6')
    window.dispatchEvent(new CustomEvent('rb:drill', { detail: resume.eggs.konamiMessage }))
  }

  window.addEventListener('keydown', (e) => {
    pos = e.key === CODE[pos] ? pos + 1 : e.key === CODE[0] ? 1 : 0
    if (pos === CODE.length) {
      pos = 0
      void runDrill()
    }
  })
})
