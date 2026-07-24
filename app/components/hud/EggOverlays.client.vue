<script setup lang="ts">
/**
 * Hidden-feature overlays, coordinated by window events:
 * - rb:egg-lights  → plant power cut; cursor becomes a flashlight
 * - rb:egg-shutter → KidCam takes a photo (spec-accurate 150ms flash,
 *                    IMG_XXXX.JPG counter persisted like the firmware)
 * - rb:egg-degauss → CRT degauss wobble
 * - screensaver    → self-managed: 90s idle → DVD-bounce badge
 * All disabled under reduced motion.
 */
const lightsOn = ref(false)
const flashOn = ref(false)
const saverOn = ref(false)

const lightsEl = ref<HTMLElement | null>(null)
const badgeEl = ref<HTMLElement | null>(null)

let reduced = false
let lightsTimer: ReturnType<typeof setTimeout> | undefined
let lightsArmTime = 0
let saverTracked = false
let idleTimer: ReturnType<typeof setTimeout> | undefined
let saverTicker: (() => void) | undefined

function toast(msg: string) {
  window.dispatchEvent(new CustomEvent('rb:drill', { detail: msg }))
}

// -- lights out ---------------------------------------------
async function lightsOut() {
  if (reduced || lightsOn.value) return
  window.__rbTrack?.('easter_egg', 'lights')
  lightsOn.value = true
  lightsArmTime = Date.now()
  await nextTick()
  const el = lightsEl.value
  if (!el) return
  const { gsap } = await import('gsap')
  const fx = gsap.quickSetter(el, '--fx', 'px') as (v: number) => void
  const fy = gsap.quickSetter(el, '--fy', 'px') as (v: number) => void
  fx(window.innerWidth / 2)
  fy(window.innerHeight / 2)
  const onMove = (e: PointerEvent) => {
    fx(e.clientX)
    fy(e.clientY)
  }
  window.addEventListener('pointermove', onMove, { passive: true })
  gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'steps(3)' })

  const restore = () => {
    window.removeEventListener('pointermove', onMove)
    clearTimeout(lightsTimer)
    gsap.to(el, { opacity: 0, duration: 0.2, ease: 'steps(2)', onComplete: () => (lightsOn.value = false) })
    const lamps = gsap.utils.toArray<HTMLElement>('.lamp')
    gsap.fromTo(lamps, { opacity: 0.1 }, { opacity: 1, duration: 0.12, stagger: 0.01, ease: 'steps(2)' })
    toast('POWER RESTORED. IT WAS ALREADY ON IT.')
    window.removeEventListener('pointerdown', onClick)
    window.removeEventListener('keydown', onEsc)
  }
  const onClick = () => {
    if (Date.now() - lightsArmTime > 400) restore()
  }
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') restore()
  }
  window.addEventListener('pointerdown', onClick)
  window.addEventListener('keydown', onEsc)
  lightsTimer = setTimeout(restore, 45000)
}

// -- KidCam shutter -----------------------------------------
async function shutter() {
  window.__rbTrack?.('easter_egg', 'shutter')
  const n = Number(localStorage.getItem('rb_img') || '42')
  localStorage.setItem('rb_img', String(n + 1))
  const name = `IMG_${String(n).padStart(4, '0')}.JPG`
  if (!reduced) {
    flashOn.value = true
    await nextTick()
    const { gsap } = await import('gsap')
    gsap.fromTo(
      '.egg-flash',
      { opacity: 0.65 },
      { opacity: 0, duration: 0.15, ease: 'none', onComplete: () => (flashOn.value = false) },
    )
  }
  toast(`${name} → SD OK`)
}

// -- degauss ------------------------------------------------
function degauss() {
  if (reduced) return
  window.__rbTrack?.('easter_egg', 'degauss')
  document.documentElement.classList.add('egg-degauss')
  setTimeout(() => document.documentElement.classList.remove('egg-degauss'), 1100)
}

// -- screensaver --------------------------------------------
async function startSaver() {
  if (reduced || saverOn.value || document.hidden) return
  if (!saverTracked) {
    window.__rbTrack?.('easter_egg', 'screensaver')
    saverTracked = true
  }
  saverOn.value = true
  await nextTick()
  const badge = badgeEl.value
  if (!badge) return
  const { gsap } = await import('gsap')
  const colors = ['var(--teal-hot)', 'var(--green)', 'var(--amber)', 'var(--red)']
  let ci = 0
  const pos = { x: 60, y: 60, vx: 2.1, vy: 1.7 }
  const tick = () => {
    const w = window.innerWidth - badge.offsetWidth
    const h = window.innerHeight - badge.offsetHeight
    pos.x += pos.vx
    pos.y += pos.vy
    let hit = false
    if (pos.x <= 0 || pos.x >= w) {
      pos.vx *= -1
      pos.x = Math.max(0, Math.min(w, pos.x))
      hit = true
    }
    if (pos.y <= 0 || pos.y >= h) {
      pos.vy *= -1
      pos.y = Math.max(0, Math.min(h, pos.y))
      hit = true
    }
    if (hit) {
      ci = (ci + 1) % colors.length
      badge.style.color = colors[ci] ?? ''
      badge.style.borderColor = colors[ci] ?? ''
    }
    gsap.set(badge, { x: pos.x, y: pos.y })
  }
  gsap.ticker.add(tick)
  saverTicker = () => gsap.ticker.remove(tick)
}

function stopSaver() {
  if (!saverOn.value) return
  saverTicker?.()
  saverOn.value = false
}

function armIdle() {
  clearTimeout(idleTimer)
  stopSaver()
  idleTimer = setTimeout(startSaver, 90_000)
}

const onLights = () => void lightsOut()
const onShutter = () => void shutter()
const onDegauss = () => degauss()

onMounted(() => {
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.addEventListener('rb:egg-lights', onLights)
  window.addEventListener('rb:egg-shutter', onShutter)
  window.addEventListener('rb:egg-degauss', onDegauss)
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(ev, armIdle, { passive: true })
  }
  armIdle()
})

onUnmounted(() => {
  window.removeEventListener('rb:egg-lights', onLights)
  window.removeEventListener('rb:egg-shutter', onShutter)
  window.removeEventListener('rb:egg-degauss', onDegauss)
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.removeEventListener(ev, armIdle)
  }
  clearTimeout(idleTimer)
  clearTimeout(lightsTimer)
  stopSaver()
})
</script>

<template>
  <div>
    <div v-if="lightsOn" ref="lightsEl" class="egg-lights" aria-hidden="true" />
    <div v-if="flashOn" class="egg-flash" aria-hidden="true" />
    <div v-if="saverOn" class="egg-saver" aria-hidden="true">
      <span ref="badgeEl" class="egg-saver__badge">RILEY.BETTS/OPS ▮</span>
    </div>
  </div>
</template>

<style scoped>
.egg-lights {
  --fx: 50vw;
  --fy: 50vh;
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-cursor) - 1);
  pointer-events: none;
  background: radial-gradient(
    circle 150px at var(--fx) var(--fy),
    transparent 0%,
    rgba(2, 4, 5, 0.55) 55%,
    rgba(2, 4, 5, 0.97) 100%
  );
}

.egg-flash {
  position: fixed;
  inset: 0;
  z-index: var(--z-cursor);
  pointer-events: none;
  background: #fff;
}

.egg-saver {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-cursor) - 1);
  pointer-events: none;
  background: rgba(2, 4, 5, 0.6);
}

.egg-saver__badge {
  position: absolute;
  top: 0;
  left: 0;
  display: inline-block;
  padding: 6px 12px;
  border: 1px solid var(--teal-hot);
  color: var(--teal-hot);
  font-size: var(--fs-data);
  font-weight: 700;
  letter-spacing: 0.12em;
  background: var(--bg-0);
}
</style>

<style>
/* degauss wobble — global because the class lands on <html> */
.egg-degauss {
  animation: egg-degauss-wobble 1.1s ease-in-out 1;
}

@keyframes egg-degauss-wobble {
  0% { transform: scale(1) skewX(0deg); filter: hue-rotate(0deg); }
  15% { transform: scale(1.012, 0.988) skewX(0.6deg); filter: hue-rotate(18deg); }
  30% { transform: scale(0.992, 1.008) skewX(-0.5deg); filter: hue-rotate(-14deg); }
  45% { transform: scale(1.006, 0.995) skewX(0.3deg); filter: hue-rotate(8deg); }
  65% { transform: scale(0.997, 1.003) skewX(-0.15deg); filter: hue-rotate(-4deg); }
  100% { transform: scale(1) skewX(0deg); filter: hue-rotate(0deg); }
}
</style>
