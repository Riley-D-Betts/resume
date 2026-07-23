<script setup lang="ts">
const SEGMENTS: Record<string, string> = {
  sys: '01 / SYS',
  profile: '02 / OPERATOR PROFILE',
  opslog: '03 / OPERATIONS LOG',
  fobech: '04 / FOBECH',
  bays: '05 / PROJECT BAYS',
  comms: '06 / COMMS',
}

const current = ref('01 / SYS')
const progress = ref(0)
const flash = ref('')
const clock = useIdahoTime()

let observer: IntersectionObserver | undefined
let raf = 0
let flashTimer: ReturnType<typeof setTimeout> | undefined

function onScroll() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    const doc = document.documentElement
    const max = doc.scrollHeight - window.innerHeight
    progress.value = max > 0 ? Math.min(100, Math.round((window.scrollY / max) * 100)) : 0
  })
}

function onDrill(e: Event) {
  flash.value = (e as CustomEvent<string>).detail || ''
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = ''), 4000)
}

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = (entry.target as HTMLElement).dataset.section
          if (id && SEGMENTS[id]) current.value = SEGMENTS[id]
        }
      }
    },
    { rootMargin: '-45% 0px -45% 0px' },
  )
  document.querySelectorAll('[data-section]').forEach((el) => observer!.observe(el))
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('rb:drill', onDrill)
  onScroll()
})

onUnmounted(() => {
  observer?.disconnect()
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('rb:drill', onDrill)
  cancelAnimationFrame(raf)
  clearTimeout(flashTimer)
})

const bar = computed(() => {
  const filled = Math.round(progress.value / 12.5)
  return '▮'.repeat(filled) + '▯'.repeat(8 - filled)
})
</script>

<template>
  <nav class="hud" aria-label="Console status">
    <a class="hud__brand" href="#sys">RILEY.BETTS/OPS <span class="hud__ver">v1.0</span></a>

    <div class="hud__seg" aria-live="polite">
      <template v-if="flash">
        <span class="hud__flash">{{ flash }}</span>
      </template>
      <template v-else>
        <span class="hud__seg-label">SEG</span> {{ current }}
      </template>
    </div>

    <div class="hud__right">
      <span class="hud__clock">{{ clock }}</span>
      <span class="hud__pos" aria-label="Scroll progress">
        <span class="hud__bar">{{ bar }}</span> {{ String(progress).padStart(3, ' ') }}%
      </span>
    </div>
  </nav>
</template>

<style scoped>
.hud {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-hud);
  height: var(--hud-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 0 var(--space-3);
  background: color-mix(in srgb, var(--bg-0) 88%, transparent);
  backdrop-filter: blur(4px);
  border-bottom: 1px solid var(--hairline);
  font-size: var(--fs-micro);
  letter-spacing: 0.1em;
  white-space: nowrap;
}

.hud__brand {
  color: var(--text);
  text-decoration: none;
  font-weight: 700;
}

.hud__brand:hover {
  color: var(--teal-hot);
  text-decoration: none;
}

.hud__ver {
  color: var(--text-faint);
  font-weight: 400;
}

.hud__seg {
  color: var(--teal-hot);
  overflow: hidden;
  text-overflow: ellipsis;
}

.hud__seg-label {
  color: var(--text-faint);
}

.hud__flash {
  color: var(--green);
  animation: crt-flicker 0.3s steps(2) 3;
}

.hud__right {
  display: flex;
  gap: var(--space-3);
  color: var(--text-dim);
}

.hud__clock {
  color: var(--green);
  font-variant-numeric: tabular-nums;
}

.hud__bar {
  color: var(--teal);
  letter-spacing: 0;
}

.hud__pos {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 768px) {
  .hud__pos {
    display: none;
  }
}
</style>
