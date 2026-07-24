<script setup lang="ts">
import { resume } from '~/data/resume'

/**
 * SEG 01 — SYS. Asymmetric hero: the name at display scale, a live
 * data rail, an accomplishment ticker. Intro plays once when boot
 * hands off. After that the section stays alive: the grid drifts on
 * scroll, the whole hero parallaxes away as you leave it, the ticker
 * speeds up with scroll velocity, and the name's letters duck away
 * from the pointer like a magnet passing over a CRT.
 */
const hero = resume.hero
const identity = resume.identity

const root = ref<HTMLElement | null>(null)
let ctx: { revert: () => void } | undefined
let onBoot: (() => void) | undefined

onMounted(async () => {
  const el = root.value
  if (!el) return
  const [{ gsap }, { SplitText }, { ScrollTrigger }] = await Promise.all([
    import('gsap'),
    import('gsap/SplitText'),
    import('gsap/ScrollTrigger'),
  ])

  const mm = gsap.matchMedia()
  ctx = mm

  mm.add('(prefers-reduced-motion: no-preference)', async () => {
    const rail = el.querySelectorAll<HTMLElement>('.hero__rail .readout')
    const railTitle = el.querySelector('.hero__rail-title')
    const lamps = el.querySelectorAll('.hero__rail .lamp')
    const prefix = el.querySelector('.hero__prefix')
    const hint = el.querySelector('.hero__hint')
    const grid = el.querySelector('.hero__grid')
    const main = el.querySelector('.hero__main')
    const track = el.querySelector<HTMLElement>('.hero__ticker-track')

    gsap.set([prefix, railTitle, rail, hint], { autoAlpha: 0 })

    await document.fonts.ready
    const split = new SplitText(el.querySelectorAll('.hero__name-line'), {
      type: 'chars',
      charsClass: 'hero__char',
    })
    gsap.set(el.querySelectorAll('.hero__name-mask'), { autoAlpha: 1 })
    gsap.set(split.chars, { yPercent: 115 })

    // -- intro (plays once, on boot handoff) ---------------
    const values = Array.from(rail).map((r) => r.querySelector<HTMLElement>('.readout__value'))
    const tl = gsap.timeline({ paused: true })
    tl.to(prefix, {
      autoAlpha: 1,
      duration: 0.45,
      scrambleText: { text: hero.prefix, chars: '01▮#/', speed: 1.4 },
    })
      .to(split.chars, { yPercent: 0, duration: 0.9, ease: 'console', stagger: 0.04 }, '-=0.1')
      .to(railTitle, { autoAlpha: 1, duration: 0.3 }, '-=0.6')
      .to(rail, { autoAlpha: 1, x: 0, duration: 0.45, stagger: 0.08, startAt: { x: 18 } }, '<')

    // each static readout value resolves out of noise; live ones
    // (uptime, clock) are owned by Vue's ticker and skipped
    values.forEach((v, i) => {
      if (!v || v.classList.contains('readout__value--live')) return
      const finalText = v.textContent ?? ''
      tl.to(
        v,
        { duration: 0.4, scrambleText: { text: finalText, chars: '01▮▯#', speed: 2 } },
        0.7 + i * 0.09,
      )
    })
    tl.fromTo(
      lamps,
      { opacity: 0 },
      { opacity: 1, duration: 0.3, stagger: { each: 0.09, from: 'start' }, ease: 'steps(3)' },
      0.75,
    ).to(hint, { autoAlpha: 1, duration: 0.6 }, '>-0.2')

    const play = () => tl.play()
    if ((window as Window & { __rbBootDone?: boolean }).__rbBootDone) play()
    else {
      onBoot = play
      window.addEventListener('rb:boot-done', play, { once: true })
    }

    // -- scroll life ---------------------------------------
    // grid drifts up slightly faster than the page (depth), hero
    // content parallaxes away and dims as the section exits
    gsap.to(grid, {
      yPercent: -14,
      ease: 'none',
      scrollTrigger: { trigger: el, start: 'top top', end: 'bottom top', scrub: true },
    })
    gsap.to([main, el.querySelector('.hero__rail')], {
      yPercent: -8,
      autoAlpha: 0.15,
      ease: 'none',
      scrollTrigger: { trigger: el, start: '30% top', end: 'bottom top', scrub: 0.4 },
    })

    // -- ticker: infinite belt, speed follows scroll velocity
    let tickerTween: gsap.core.Tween | undefined
    if (track) {
      track.style.animation = 'none'
      tickerTween = gsap.to(track, { xPercent: -50, duration: 36, ease: 'none', repeat: -1 })
      ScrollTrigger.create({
        trigger: el,
        start: 'top bottom',
        end: 'bottom top',
        onUpdate(self) {
          const boost = gsap.utils.clamp(1, 5, 1 + Math.abs(self.getVelocity()) / 900)
          gsap.to(tickerTween!, { timeScale: boost, duration: 0.2, overwrite: true })
          gsap.to(tickerTween!, { timeScale: 1, duration: 1.2, delay: 0.25, overwrite: false })
        },
        onLeave: () => tickerTween?.pause(),
        onEnterBack: () => tickerTween?.resume(),
      })
    }

    // scroll hint fades on first scroll
    const hintOff = () => gsap.to(hint, { autoAlpha: 0, duration: 0.4 })
    window.addEventListener('scroll', hintOff, { once: true, passive: true })

    // -- name reacts to the pointer (fine pointers only) ---
    let nameCleanup: (() => void) | undefined
    if (window.matchMedia('(pointer: fine)').matches) {
      const nameEl = el.querySelector<HTMLElement>('.hero__name')
      if (nameEl) {
        let raf = 0
        const onMove = (e: PointerEvent) => {
          cancelAnimationFrame(raf)
          raf = requestAnimationFrame(() => {
            for (const char of split.chars as HTMLElement[]) {
              const r = char.getBoundingClientRect()
              const dx = e.clientX - (r.left + r.width / 2)
              const dy = e.clientY - (r.top + r.height / 2)
              const d = Math.hypot(dx, dy)
              const pull = Math.max(0, 1 - d / 110)
              gsap.to(char, {
                yPercent: -9 * pull,
                color: pull > 0.45 ? 'var(--teal-hot)' : 'var(--text)',
                duration: 0.25,
                overwrite: 'auto',
              })
            }
          })
        }
        const onLeave = () =>
          gsap.to(split.chars, { yPercent: 0, color: 'var(--text)', duration: 0.4, overwrite: 'auto' })
        nameEl.addEventListener('pointermove', onMove, { passive: true })
        nameEl.addEventListener('pointerleave', onLeave, { passive: true })
        nameCleanup = () => {
          nameEl.removeEventListener('pointermove', onMove)
          nameEl.removeEventListener('pointerleave', onLeave)
          cancelAnimationFrame(raf)
        }
      }
    }

    return () => {
      split.revert()
      tickerTween?.kill()
      nameCleanup?.()
      window.removeEventListener('scroll', hintOff)
    }
  })
})

onUnmounted(() => {
  ctx?.revert()
  if (onBoot) window.removeEventListener('rb:boot-done', onBoot)
})
</script>

<template>
  <div ref="root" class="hero">
    <div class="hero__grid" aria-hidden="true" />

    <div class="hero__main">
      <p class="hero__prefix label">{{ hero.prefix }}</p>

      <h1 class="hero__name" :aria-label="`${identity.name[0]} ${identity.name[1]}`">
        <span v-for="line in identity.name" :key="line" class="hero__name-mask">
          <span class="hero__name-line display">{{ line }}</span>
        </span>
      </h1>

      <p class="hero__hint label">
        {{ hero.scrollHint }} <span class="hero__hint-arrow">▼</span>
      </p>
    </div>

    <aside class="hero__rail" aria-label="Live status readouts">
      <p class="hero__rail-title label">// LIVE READOUTS</p>
      <Readout v-for="r in hero.readouts" :key="r.label" :readout="r" />
    </aside>

    <div class="hero__ticker" aria-hidden="true">
      <div class="hero__ticker-track">
        <span v-for="(t, i) in [...hero.ticker, ...hero.ticker]" :key="i" class="hero__ticker-item">
          {{ t }} <span class="hero__ticker-sep">·</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hero {
  position: relative;
  min-height: 100svh;
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
  grid-template-rows: 1fr auto;
  gap: var(--space-4);
  padding: calc(var(--hud-h) + var(--space-5)) var(--space-4) 0;
  overflow: hidden;
}

.hero__grid {
  position: absolute;
  inset: -15% 0 0 0;
  background-image:
    linear-gradient(var(--hairline) 1px, transparent 1px),
    linear-gradient(90deg, var(--hairline) 1px, transparent 1px);
  background-size: 72px 72px;
  opacity: 0.35;
  mask-image: radial-gradient(ellipse 90% 80% at 30% 40%, black 0%, transparent 75%);
  will-change: transform;
}

.hero__main {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}

.hero__prefix {
  color: var(--teal-hot);
  margin-bottom: var(--space-3);
}

.hero__name {
  font-size: var(--fs-display);
}

.hero__name-mask {
  display: block;
  overflow: hidden;
  padding-bottom: 0.06em;
  visibility: visible;
}

.hero__name-line {
  display: block;
  font-size: 1em;
}

.hero__name :deep(.hero__char) {
  will-change: transform;
}

.hero__hint {
  margin-top: var(--space-5);
  color: var(--text-dim);
}

.hero__hint-arrow {
  display: inline-block;
  animation: hint-bob 1.6s ease-in-out infinite;
  color: var(--teal-hot);
}

@keyframes hint-bob {
  50% {
    transform: translateY(4px);
  }
}

.hero__rail {
  position: relative;
  align-self: center;
  border-left: 1px solid var(--hairline);
  padding-left: var(--space-3);
}

.hero__rail-title {
  color: var(--text-faint);
  margin-bottom: var(--space-2);
}

.hero__ticker {
  grid-column: 1 / -1;
  overflow: hidden;
  border-top: 1px solid var(--hairline);
  padding: var(--space-2) 0;
  margin-top: var(--space-4);
}

.hero__ticker-track {
  display: inline-block;
  white-space: nowrap;
  animation: ticker-roll 36s linear infinite;
}

.hero__ticker-item {
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  color: var(--text-dim);
  margin-right: var(--space-3);
}

.hero__ticker-sep {
  color: var(--teal);
  margin-left: var(--space-3);
}

@keyframes ticker-roll {
  to {
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero__ticker-track {
    animation: none;
  }
  .hero__hint-arrow {
    animation: none;
  }
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto;
    padding-top: calc(var(--hud-h) + var(--space-4));
  }

  .hero__main {
    justify-content: flex-end;
    min-height: 46svh;
  }

  .hero__hint {
    margin-top: var(--space-3);
  }

  .hero__rail {
    align-self: start;
    border-left: none;
    border-top: 1px solid var(--hairline);
    padding-left: 0;
    padding-top: var(--space-3);
  }
}
</style>
