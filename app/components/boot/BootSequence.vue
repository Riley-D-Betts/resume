<script setup lang="ts">
import { resume } from '~/data/resume'

/**
 * SEG 00 — full-screen boot overlay. A CRT powers on (the picture
 * expands from a bright horizontal line), the boot log types with a
 * scramble resolve while random lines glitch, a spinner ticks beside
 * the progress bar, and the whole tube powers back down to a line on
 * exit. Skippable at any moment; auto-skipped on revisit and under
 * reduced motion. SSR renders the overlay opaque so the hero never
 * flashes early; a server-only <noscript> rule removes it without JS.
 */
const active = ref(true)
const lines = resume.boot.lines
const BAR_LEN = 24
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// No-JS fallback: hide the overlay entirely so SSR content is readable.
// Rendered ONLY on the server — a client-side vdom <noscript><style> gets
// recreated as a live style node during hydration and would apply the
// rule even with JS enabled (display:none for everyone).
useHead(
  { noscript: [{ innerHTML: '<style>.boot { display: none !important; }</style>' }] },
  { mode: 'server' },
)

const root = ref<HTMLElement | null>(null)
let tl: gsap.core.Timeline | undefined
let glitchCall: gsap.core.Tween | undefined
let keyHandler: ((e: KeyboardEvent) => void) | undefined

function finish(skipped: boolean) {
  sessionStorage.setItem('rb_booted', '1')
  window.__rbTrack?.(skipped ? 'boot_skipped' : 'boot_done')
  ;(window as Window & { __rbBootDone?: boolean }).__rbBootDone = true
  active.value = false
  document.documentElement.style.overflow = ''
  window.dispatchEvent(new CustomEvent('rb:boot-done'))
  // measurements change when a fixed overlay leaves — resync triggers
  void import('gsap/ScrollTrigger').then(({ ScrollTrigger }) => ScrollTrigger.refresh())
}

function skip() {
  tl?.kill()
  glitchCall?.kill()
  finish(true)
}

onMounted(async () => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const revisit = sessionStorage.getItem('rb_booted') === '1'
  if (reduced || revisit) {
    active.value = false
    ;(window as Window & { __rbBootDone?: boolean }).__rbBootDone = true
    window.dispatchEvent(new CustomEvent('rb:boot-done'))
    return
  }

  document.documentElement.style.overflow = 'hidden'
  keyHandler = () => skip()
  window.addEventListener('keydown', keyHandler, { once: true })

  const { gsap } = await import('gsap')
  const el = root.value
  if (!el) return finish(true)

  const inner = el.querySelector<HTMLElement>('.boot__inner')
  const lineEls = el.querySelectorAll<HTMLElement>('.boot__line')
  const barEl = el.querySelector<HTMLElement>('.boot__bar')
  const spinEl = el.querySelector<HTMLElement>('.boot__spin')
  const doneEl = el.querySelector<HTMLElement>('.boot__done')

  // random single-frame glitches on already-typed lines while booting
  const glitch = () => {
    const typed = Array.from(lineEls).filter((l) => l.textContent && l.style.visibility !== 'hidden')
    const victim = typed[Math.floor(Math.random() * typed.length)]
    if (victim) {
      gsap
        .timeline()
        .set(victim, { x: gsap.utils.random(-4, 4), opacity: 0.4 })
        .set(victim, { x: 0, opacity: 1 }, '+=0.05')
    }
    glitchCall = gsap.delayedCall(gsap.utils.random(0.35, 0.9), glitch)
  }

  tl = gsap.timeline({ onComplete: () => finish(false) })

  // -- CRT power-on: picture expands from a bright line ----
  tl.fromTo(
    inner,
    { scaleY: 0.012, opacity: 0.9, filter: 'brightness(4)' },
    { scaleY: 1, opacity: 1, filter: 'brightness(1)', duration: 0.4, ease: 'console' },
  ).add(() => glitch(), '<0.3')

  // -- boot log types with scramble resolve ----------------
  lineEls.forEach((lineEl, i) => {
    const text = lines[i] ?? ''
    tl!.to(
      lineEl,
      {
        duration: 0.22,
        autoAlpha: 1,
        scrambleText: { text, chars: '01▮▯#/', speed: 2 },
        ease: 'none',
      },
      0.35 + i * 0.24,
    )
  })

  // -- progress bar + spinner ------------------------------
  if (barEl) {
    const bar = { n: 0 }
    tl.to(
      bar,
      {
        n: BAR_LEN,
        duration: 0.7,
        ease: 'steps(24)',
        onUpdate() {
          const n = Math.round(bar.n)
          barEl.textContent = '▮'.repeat(n) + '▯'.repeat(BAR_LEN - n)
          if (spinEl) spinEl.textContent = n < BAR_LEN ? (SPIN[n % SPIN.length] ?? '') : '✓'
        },
      },
      '>-0.1',
    )
  }

  if (doneEl) {
    tl.to(doneEl, { autoAlpha: 1, duration: 0.05 })
      .to(doneEl, { opacity: 0.35, duration: 0.06, yoyo: true, repeat: 3 })
  }

  // -- CRT power-down: collapse back to a line, then dark --
  tl.add(() => glitchCall?.kill(), '+=0.3')
    .to(inner, { scaleY: 0.008, opacity: 0.9, filter: 'brightness(4)', duration: 0.22, ease: 'power3.in' })
    .to(inner, { scaleX: 0, opacity: 0, duration: 0.14, ease: 'power2.in' })
    .to(el, { autoAlpha: 0, duration: 0.12 }, '<')
})

onUnmounted(() => {
  tl?.kill()
  glitchCall?.kill()
  if (keyHandler) window.removeEventListener('keydown', keyHandler)
  document.documentElement.style.overflow = ''
})
</script>

<template>
  <div v-if="active" ref="root" class="boot" data-testid="boot" @click="skip">
    <div class="boot__inner">
      <div v-for="(line, i) in lines" :key="i" class="boot__line" aria-hidden="true">{{ line }}</div>
      <div class="boot__row">
        <span class="boot__bar" aria-hidden="true"></span>
        <span class="boot__spin" aria-hidden="true"></span>
      </div>
      <div class="boot__done" aria-hidden="true">{{ resume.boot.done }}<span class="blink" /></div>
    </div>

    <button class="boot__skip label" data-testid="boot-skip" @click.stop="skip">[ SKIP BOOT ]</button>
    <span class="boot__sr">Loading Riley Betts’ résumé console. Press any key to skip the intro.</span>
  </div>
</template>

<style scoped>
.boot {
  position: fixed;
  inset: 0;
  z-index: var(--z-boot);
  background: var(--bg-0);
  display: flex;
  align-items: center;
  justify-content: center;
}

.boot__inner {
  width: min(560px, calc(100vw - 3rem));
  font-size: var(--fs-data);
  line-height: 1.9;
  will-change: transform, opacity, filter;
}

.boot__line {
  color: var(--text-dim);
  white-space: pre-wrap;
  visibility: hidden;
  opacity: 0;
  min-height: 1.9em;
}

.boot__row {
  margin-top: var(--space-2);
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
}

.boot__bar {
  color: var(--teal-hot);
  letter-spacing: 0.05em;
}

.boot__spin {
  color: var(--green);
  min-width: 1ch;
}

.boot__done {
  margin-top: var(--space-2);
  color: var(--green);
  font-weight: 700;
  letter-spacing: 0.1em;
  visibility: hidden;
  opacity: 0;
}

.boot__skip {
  position: absolute;
  right: var(--space-3);
  bottom: var(--space-3);
  padding: var(--space-2) var(--space-3);
  color: var(--text-dim);
  border: 1px solid var(--hairline);
  transition: color 0.2s, border-color 0.2s;
}

.boot__skip:hover {
  color: var(--teal-hot);
  border-color: var(--teal);
}

.boot__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
