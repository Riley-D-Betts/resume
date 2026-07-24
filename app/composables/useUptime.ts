import { resume } from '~/data/resume'

/**
 * Live "career uptime" counter — time since the Ida Milk hire date.
 * Renders a deterministic placeholder on the server (hydration-safe)
 * and starts ticking in onMounted.
 *
 * Hidden feature: clicking the readout cycles the unit — every
 * instance shares the module-level mode.
 */
const MODES = ['dhms', 'hours', 'minutes', 'seconds', 'career'] as const
const mode = ref(0)

export function cycleUptime() {
  mode.value = (mode.value + 1) % MODES.length
}

export function useUptime() {
  const display = ref('---:--:--:--')
  let timer: ReturnType<typeof setInterval> | undefined

  const epoch = new Date(`${resume.identity.hiredISO}T08:00:00-07:00`).getTime()

  function tick() {
    let s = Math.max(0, Math.floor((Date.now() - epoch) / 1000))
    switch (MODES[mode.value]) {
      case 'hours':
        display.value = `${(s / 3600).toFixed(1)} HOURS ON SHIFT`
        return
      case 'minutes':
        display.value = `${Math.floor(s / 60).toLocaleString('en-US')} MINUTES`
        return
      case 'seconds':
        display.value = `${s.toLocaleString('en-US')} SECONDS`
        return
      case 'career':
        display.value = 'ONE (1) CAREER'
        return
    }
    const days = Math.floor(s / 86400)
    s -= days * 86400
    const h = Math.floor(s / 3600)
    s -= h * 3600
    const m = Math.floor(s / 60)
    s -= m * 60
    display.value = `${days}:${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  watch(mode, tick)

  onMounted(() => {
    tick()
    timer = setInterval(tick, 1000)
  })

  onUnmounted(() => clearInterval(timer))

  return display
}
