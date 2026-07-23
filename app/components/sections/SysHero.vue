<script setup lang="ts">
import { resume } from '~/data/resume'

/**
 * SEG 01 — SYS. Asymmetric hero: the name at display scale on the
 * left 2/3, a live data rail on the right, an accomplishment ticker
 * along the bottom edge. Plays once when the boot sequence hands off.
 */
const hero = resume.hero
const identity = resume.identity

const root = ref<HTMLElement | null>(null)
let ctx: { revert: () => void } | undefined
let onBoot: (() => void) | undefined

onMounted(async () => {
  const el = root.value
  if (!el) return
  const [{ gsap }, { SplitText }] = await Promise.all([import('gsap'), import('gsap/SplitText')])

  const mm = gsap.matchMedia()
  ctx = mm

  mm.add('(prefers-reduced-motion: no-preference)', async () => {
    // hide before first reveal — done from JS so no-JS visitors see everything
    const rail = el.querySelectorAll('.hero__rail .readout, .hero__rail .hero__rail-title')
    const prefix = el.querySelector('.hero__prefix')
    const hint = el.querySelector('.hero__hint')
    gsap.set([prefix, rail, hint], { autoAlpha: 0 })

    await document.fonts.ready
    const split = new SplitText(el.querySelectorAll('.hero__name-line'), {
      type: 'chars',
      charsClass: 'hero__char',
    })
    gsap.set(el.querySelectorAll('.hero__name-mask'), { autoAlpha: 1 })
    gsap.set(split.chars, { yPercent: 115 })

    const tl = gsap.timeline({ paused: true })
    tl.to(prefix, {
      autoAlpha: 1,
      duration: 0.45,
      scrambleText: { text: hero.prefix, chars: '01▮#/', speed: 1.4 },
    })
      .to(split.chars, { yPercent: 0, duration: 0.9, ease: 'power4.out', stagger: 0.04 }, '-=0.1')
      .to(rail, { autoAlpha: 1, x: 0, duration: 0.5, stagger: 0.07, startAt: { x: 18 } }, '-=0.55')
      .to(hint, { autoAlpha: 1, duration: 0.6 }, '-=0.2')

    const play = () => tl.play()
    if ((window as Window & { __rbBootDone?: boolean }).__rbBootDone) play()
    else {
      onBoot = play
      window.addEventListener('rb:boot-done', play, { once: true })
    }

    // scroll hint fades on first scroll
    const hintOff = () => gsap.to(hint, { autoAlpha: 0, duration: 0.4 })
    window.addEventListener('scroll', hintOff, { once: true, passive: true })

    return () => {
      split.revert()
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
  inset: 0;
  background-image:
    linear-gradient(var(--hairline) 1px, transparent 1px),
    linear-gradient(90deg, var(--hairline) 1px, transparent 1px);
  background-size: 72px 72px;
  opacity: 0.35;
  mask-image: radial-gradient(ellipse 90% 80% at 30% 40%, black 0%, transparent 75%);
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

.hero__ticker:hover .hero__ticker-track {
  animation-play-state: paused;
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
