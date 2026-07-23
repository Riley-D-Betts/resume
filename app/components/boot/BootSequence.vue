<script setup lang="ts">
import { resume } from '~/data/resume'

/**
 * SEG 00 — full-screen boot overlay. Types the boot log with a
 * scramble resolve, fills a progress bar, flickers, and lifts.
 * Skippable at any moment; auto-skipped on revisit (sessionStorage)
 * and under reduced motion. SSR renders the overlay opaque so the
 * hero never flashes early; <noscript> removes it entirely.
 */
const active = ref(true)
const lines = resume.boot.lines
const BAR_LEN = 24

const root = ref<HTMLElement | null>(null)
let tl: gsap.core.Timeline | undefined
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

  const lineEls = el.querySelectorAll<HTMLElement>('.boot__line')
  const barEl = el.querySelector<HTMLElement>('.boot__bar')
  const doneEl = el.querySelector<HTMLElement>('.boot__done')

  tl = gsap.timeline({ onComplete: () => finish(false) })

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
      i * 0.24,
    )
  })

  if (barEl) {
    const bar = { n: 0 }
    tl.to(
      bar,
      {
        n: BAR_LEN,
        duration: 0.7,
        ease: 'steps(24)',
        onUpdate() {
          barEl.textContent = '▮'.repeat(Math.round(bar.n)) + '▯'.repeat(BAR_LEN - Math.round(bar.n))
        },
      },
      '>-0.1',
    )
  }

  if (doneEl) {
    tl.to(doneEl, { autoAlpha: 1, duration: 0.05 })
      .to(doneEl, { opacity: 0.35, duration: 0.06, yoyo: true, repeat: 3 })
  }

  tl.to(el.querySelector('.boot__inner'), { yPercent: -6, autoAlpha: 0, duration: 0.35, ease: 'power2.in' }, '+=0.35')
    .to(el, { autoAlpha: 0, duration: 0.18 }, '<0.15')
})

onUnmounted(() => {
  tl?.kill()
  if (keyHandler) window.removeEventListener('keydown', keyHandler)
  document.documentElement.style.overflow = ''
})
</script>

<template>
  <div v-if="active" ref="root" class="boot" data-testid="boot" @click="skip">
    <noscript>
      <component :is="'style'">.boot { display: none !important; }</component>
    </noscript>

    <div class="boot__inner">
      <div v-for="(line, i) in lines" :key="i" class="boot__line" aria-hidden="true">{{ line }}</div>
      <div class="boot__row">
        <span class="boot__bar" aria-hidden="true"></span>
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
}

.boot__bar {
  color: var(--teal-hot);
  letter-spacing: 0.05em;
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
