<script setup lang="ts">
import { resume } from '~/data/resume'

/**
 * SEG 04 — FOBECH. The inversion moment: the page washes deep teal
 * while the studio panel is on screen. The capability tiles ARE Andon
 * tiles — they enter RED/HOLD and flip GREEN/RELEASED as they cross
 * the trigger line, because QC gating is literally what Fobech builds.
 */
const fobech = resume.fobech

const root = ref<HTMLElement | null>(null)
let ctx: { revert: () => void } | undefined

onMounted(async () => {
  const el = root.value
  if (!el) return
  const [{ gsap }, { SplitText }] = await Promise.all([
    import('gsap'),
    import('gsap/SplitText'),
    import('gsap/ScrollTrigger'),
  ])

  const mm = gsap.matchMedia()
  ctx = mm

  mm.add('(prefers-reduced-motion: no-preference)', async () => {
    await document.fonts.ready

    // teal wash while the section holds the viewport
    const wash = gsap.to(el, {
      backgroundColor: '#012a31',
      duration: 0.7,
      ease: 'power1.inOut',
      paused: true,
    })
    const washTrigger = {
      trigger: el,
      start: 'top 65%',
      end: 'bottom 35%',
      onEnter: () => wash.play(),
      onLeave: () => wash.reverse(),
      onEnterBack: () => wash.play(),
      onLeaveBack: () => wash.reverse(),
    }
    gsap.timeline({ scrollTrigger: washTrigger })

    // taglines rise word by word
    const tagline = el.querySelector('.fobech__tagline')
    if (tagline) {
      const split = new SplitText(tagline, { type: 'words', wordsClass: 'fobech__word' })
      gsap.set(split.words, { yPercent: 120, autoAlpha: 0, rotate: 2 })
      gsap.to(split.words, {
        yPercent: 0,
        autoAlpha: 1,
        rotate: 0,
        duration: 0.7,
        ease: 'power3.out',
        stagger: 0.06,
        scrollTrigger: { trigger: tagline, start: 'top 78%', once: true },
      })
    }

    const intro = el.querySelectorAll('.fobech__logo, .fobech__sub, .fobech__blurb, .fobech__cta')
    gsap.set(intro, { autoAlpha: 0, y: 16 })
    gsap.to(intro, {
      autoAlpha: 1,
      y: 0,
      duration: 0.5,
      stagger: 0.1,
      scrollTrigger: { trigger: el, start: 'top 65%', once: true },
    })

    // Andon tiles: RED — HOLD → GREEN — RELEASED
    el.querySelectorAll<HTMLElement>('.fobech__tile').forEach((tile, i) => {
      const statusEl = tile.querySelector<HTMLElement>('.fobech__tile-status')
      const lampEl = tile.querySelector<HTMLElement>('.lamp')
      gsap.set(tile, { autoAlpha: 0, y: 20 })
      const tl = gsap.timeline({
        scrollTrigger: { trigger: tile, start: 'top 80%', once: true },
      })
      tl.to(tile, { autoAlpha: 1, y: 0, duration: 0.4, delay: i * 0.12 })
        .to(tile, { '--tile-flash': 0.35, duration: 0.08, yoyo: true, repeat: 1 } as gsap.TweenVars, '+=0.4')
        .add(() => {
          tile.classList.add('fobech__tile--released')
          if (lampEl) lampEl.style.backgroundColor = 'var(--green)'
          if (statusEl) {
            gsap.to(statusEl, {
              duration: 0.4,
              scrambleText: { text: 'RELEASED', chars: 'HOLDRELSA▮', speed: 2 },
            })
          }
        }, '<')
    })
  })
})

onUnmounted(() => ctx?.revert())
</script>

<template>
  <div ref="root" class="fobech">
    <div class="fobech__inner">
      <SectionHeader num="04" title="FOBECH" tag="INDEPENDENT SYSTEMS STUDIO — FOUNDER & PRINCIPAL" />

      <div class="fobech__cols">
        <div class="fobech__pitch">
          <img class="fobech__logo" :src="fobech.logo" alt="Fobech logo" width="220" height="56" />
          <h3 class="fobech__tagline display">{{ fobech.taglines[0] }}</h3>
          <p class="fobech__sub">{{ fobech.taglines[1] }}</p>
          <p class="fobech__blurb">{{ fobech.blurb }}</p>
          <a class="fobech__cta" :href="fobech.url" target="_blank" rel="noopener">
            {{ fobech.cta }}
          </a>
        </div>

        <div class="fobech__tiles" aria-label="Fobech capabilities">
          <div v-for="cap in fobech.capabilities" :key="cap.title" class="fobech__tile">
            <div class="fobech__tile-head">
              <StatusLamp color="red" :pulse="false" />
              <span class="fobech__tile-status label">HOLD</span>
            </div>
            <h4 class="fobech__tile-title">{{ cap.title }}</h4>
            <p class="fobech__tile-desc label">{{ cap.desc }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fobech {
  background: var(--bg-0);
}

.fobech__inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}

.fobech__cols {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}

.fobech__logo {
  width: 220px;
  height: auto;
  filter: brightness(1.9);
  margin-bottom: var(--space-4);
}

.fobech__tagline {
  font-size: clamp(1.7rem, 4vw, 3.2rem);
  text-transform: none;
  margin-bottom: var(--space-2);
}

.fobech__tagline :deep(.fobech__word) {
  display: inline-block;
}

.fobech__sub {
  color: var(--teal-hot);
  font-size: var(--fs-data);
  letter-spacing: 0.08em;
  margin-bottom: var(--space-3);
}

.fobech__blurb {
  font-size: var(--fs-body);
  max-width: 56ch;
  color: var(--text);
  margin-bottom: var(--space-4);
}

.fobech__cta {
  display: inline-block;
  border: 1px solid var(--teal-hot);
  color: var(--teal-hot);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-data);
  letter-spacing: 0.1em;
  transition: background 0.2s, color 0.2s, box-shadow 0.2s;
}

.fobech__cta:hover {
  background: var(--teal);
  color: #fff;
  text-decoration: none;
  box-shadow: 0 0 18px rgba(0, 180, 200, 0.35);
}

.fobech__tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.fobech__tile {
  --tile-flash: 0;
  position: relative;
  border: 1px solid rgba(255, 69, 69, 0.5);
  background:
    linear-gradient(rgba(255, 255, 255, var(--tile-flash)), rgba(255, 255, 255, var(--tile-flash))),
    var(--bg-1);
  padding: var(--space-3);
  min-height: 130px;
  transition: border-color 0.4s;
}

.fobech__tile--released {
  border-color: rgba(47, 213, 117, 0.55);
}

.fobech__tile-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.fobech__tile-status {
  color: var(--text);
  font-weight: 700;
}

.fobech__tile--released .fobech__tile-status {
  color: var(--green);
}

.fobech__tile-title {
  font-size: var(--fs-body);
  letter-spacing: 0.08em;
  margin-bottom: var(--space-1);
}

.fobech__tile-desc {
  color: var(--text-dim);
  line-height: 1.7;
}

@media (max-width: 900px) {
  .fobech__inner {
    padding: var(--space-5) var(--space-3);
  }

  .fobech__cols {
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  .fobech__tiles {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }
}
</style>
