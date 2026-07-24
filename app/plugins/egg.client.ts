import { resume } from '~/data/resume'

declare global {
  interface Window {
    __rbTrack?: (type: string, name?: string, p?: Record<string, unknown>) => void
    ns?: Record<string, unknown>
  }
}

/**
 * Easter eggs: the console banner + a tiny "maintenance interface" on
 * `window.ns`, and the Konami-code Role Center refresh. Finding either
 * fires an easter_egg analytics event — Riley gets to see who looked
 * under the hood.
 */
export default defineNuxtPlugin(() => {
  if (location.pathname.startsWith('/ops')) return

  // -- console banner --------------------------------------
  const art = resume.eggs.consoleBanner.join('\n')
  // eslint-disable-next-line no-console
  console.log(`%c${art}`, 'color:#ef6c3b; font-family:monospace;')
  // eslint-disable-next-line no-console
  console.log(`%c${resume.eggs.consoleHint}`, 'color:#5b6b7b; font-family:monospace;')

  const epoch = new Date(`${resume.identity.hiredISO}T08:00:00-07:00`).getTime()

  function toast(message: string): void {
    window.dispatchEvent(new CustomEvent('ns:toast', { detail: { message, icon: '✓', timeout: 4200 } }))
  }

  window.ns = {
    help() {
      return [
        'ns.uptime()   — career uptime',
        'ns.hire()     — open a channel',
        'ns.refresh()  — refresh the Role Center',
      ]
    },
    uptime() {
      const days = ((Date.now() - epoch) / 86400000).toFixed(2)
      window.__rbTrack?.('easter_egg', 'console')
      return `${days} days on the job without a lost weekend. (mostly)`
    },
    hire() {
      window.__rbTrack?.('easter_egg', 'console')
      location.href = `mailto:${resume.identity.email}`
      return 'opening channel…'
    },
    refresh() {
      refreshRoleCenter()
      return 'REFRESHING'
    },
  }

  // -- konami → Role Center refresh ------------------------
  const CODE = [
    'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
  ]
  let pos = 0

  function refreshRoleCenter(): void {
    window.__rbTrack?.('easter_egg', 'konami')
    toast(resume.eggs.toast)
  }

  window.addEventListener('keydown', (e) => {
    pos = e.key === CODE[pos] ? pos + 1 : e.key === CODE[0] ? 1 : 0
    if (pos === CODE.length) {
      pos = 0
      refreshRoleCenter()
    }
  })
})
