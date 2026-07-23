import { resume } from '~/data/resume'

/**
 * Live "career uptime" counter — days:hours:minutes:seconds since the
 * Ida Milk hire date. Renders a deterministic placeholder on the server
 * (hydration-safe) and starts ticking in onMounted.
 */
export function useUptime() {
  const display = ref('---:--:--:--')
  let timer: ReturnType<typeof setInterval> | undefined

  const epoch = new Date(`${resume.identity.hiredISO}T08:00:00-07:00`).getTime()

  function tick() {
    let s = Math.max(0, Math.floor((Date.now() - epoch) / 1000))
    const days = Math.floor(s / 86400)
    s -= days * 86400
    const h = Math.floor(s / 3600)
    s -= h * 3600
    const m = Math.floor(s / 60)
    s -= m * 60
    display.value = `${days}:${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  onMounted(() => {
    tick()
    timer = setInterval(tick, 1000)
  })

  onUnmounted(() => clearInterval(timer))

  return display
}
