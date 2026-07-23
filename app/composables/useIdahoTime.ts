import { resume } from '~/data/resume'

/**
 * Local time at the plant (America/Boise), ticking. SSR renders a
 * placeholder so hydration never mismatches.
 */
export function useIdahoTime() {
  const display = ref('--:--:--')
  let timer: ReturnType<typeof setInterval> | undefined

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: resume.identity.timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  function tick() {
    display.value = `${fmt.format(new Date())} MT`
  }

  onMounted(() => {
    tick()
    timer = setInterval(tick, 1000)
  })

  onUnmounted(() => clearInterval(timer))

  return display
}
