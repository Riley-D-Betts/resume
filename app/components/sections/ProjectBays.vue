<script setup lang="ts">
import { resume } from '~/data/resume'

/**
 * SEG 05 — PROJECT BAYS. Equipment-bay grid with uneven spans. Cards
 * flip up in 3D on entry and tilt toward the pointer with a tracking
 * glare. The KidCam schematic draws itself, then runs live: data
 * packets shuttle along the callout lines and the status LEDs blink.
 * Status words resolve out of scramble as each card lands.
 */
const projects = resume.projects

const root = ref<HTMLElement | null>(null)
let ctx: { revert: () => void } | undefined

onMounted(async () => {
  const el = root.value
  if (!el) return
  const [{ gsap }, { ScrollTrigger }] = await Promise.all([
    import('gsap'),
    import('gsap/ScrollTrigger'),
    import('gsap/DrawSVGPlugin'),
  ])

  const mm = gsap.matchMedia()
  ctx = mm

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const cards = el.querySelectorAll<HTMLElement>('.bays__card')
    gsap.set(cards, { autoAlpha: 0, y: 26, rotationX: 9, transformOrigin: '50% 100%' })

    ScrollTrigger.batch(Array.from(cards), {
      start: 'top 82%',
      once: true,
      onEnter: (batch) => {
        gsap.to(batch, { autoAlpha: 1, y: 0, rotationX: 0, duration: 0.55, ease: 'console', stagger: 0.1 })
        for (const card of batch as HTMLElement[]) {
          const chips = card.querySelectorAll('.bays__chip')
          const status = card.querySelector<HTMLElement>('.bays__status .label')
          gsap.fromTo(chips, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.25, stagger: 0.04, delay: 0.3 })
          if (status) {
            const text = status.textContent ?? ''
            gsap.to(status, { duration: 0.5, delay: 0.25, scrambleText: { text, chars: '▮▯01', speed: 2 } })
          }
        }
      },
    })

    // -- KidCam schematic: draw once, then live forever ----
    const schematic = el.querySelector('.bays__schematic')
    const strokes = el.querySelectorAll<SVGGeometryElement>('.bays__schematic [data-draw]')
    const packets = el.querySelectorAll<SVGCircleElement>('.bays__packet')
    const leds = el.querySelectorAll<SVGCircleElement>('.bays__led')
    const live = gsap.timeline({ paused: true })
    if (strokes.length) {
      gsap.set(strokes, { drawSVG: '0%' })
      gsap.set(packets, { autoAlpha: 0 })
      gsap.timeline({
        scrollTrigger: { trigger: schematic, start: 'top 80%', once: true },
        onComplete: () => live.play(),
      })
        .to(strokes, { drawSVG: '100%', duration: 1.2, ease: 'power2.inOut', stagger: 0.1 })
        .to(packets, { autoAlpha: 1, duration: 0.2 })

      // packets shuttle host→board and back along the callout lines
      packets.forEach((p, i) => {
        live.fromTo(
          p,
          { attr: { cx: 232 } },
          { attr: { cx: 292 }, duration: 1.1, ease: 'power1.inOut', yoyo: true, repeat: -1, delay: i * 0.4 },
          0,
        )
      })
      // status LEDs blink out of phase
      leds.forEach((led, i) => {
        live.to(led, { opacity: 0.25, duration: 0.5, yoyo: true, repeat: -1, ease: 'steps(1)', delay: i * 0.7 }, 0)
      })
      ScrollTrigger.create({
        trigger: schematic as Element,
        start: 'top bottom',
        end: 'bottom top',
        onToggle: (self) => {
          if (!live.paused() || self.isActive) (self.isActive ? live.play() : live.pause())
        },
      })
    }

    // -- pointer tilt + tracking glare (fine pointers) -----
    const cleanups: (() => void)[] = []
    if (window.matchMedia('(pointer: fine)').matches) {
      cards.forEach((card) => {
        const toRX = gsap.quickTo(card, 'rotationX', { duration: 0.35, ease: 'power2.out' })
        const toRY = gsap.quickTo(card, 'rotationY', { duration: 0.35, ease: 'power2.out' })
        const glare = gsap.quickSetter(card, '--glare-x', 'px') as (v: number) => void
        const glareY = gsap.quickSetter(card, '--glare-y', 'px') as (v: number) => void

        const onMove = (e: PointerEvent) => {
          const r = card.getBoundingClientRect()
          const nx = (e.clientX - r.left) / r.width - 0.5
          const ny = (e.clientY - r.top) / r.height - 0.5
          toRX(-ny * 5)
          toRY(nx * 6)
          glare(e.clientX - r.left)
          glareY(e.clientY - r.top)
          card.classList.add('bays__card--lit')
        }
        const onLeave = () => {
          toRX(0)
          toRY(0)
          card.classList.remove('bays__card--lit')
        }
        card.addEventListener('pointermove', onMove, { passive: true })
        card.addEventListener('pointerleave', onLeave, { passive: true })
        cleanups.push(() => {
          card.removeEventListener('pointermove', onMove)
          card.removeEventListener('pointerleave', onLeave)
        })
      })
    }

    return () => {
      live.kill()
      cleanups.forEach((c) => c())
    }
  })
})

onUnmounted(() => ctx?.revert())
</script>

<template>
  <div ref="root" class="bays">
    <SectionHeader num="05" title="PROJECT BAYS" tag="PERSONAL BUILDS — POWERED, MONITORED, OCCASIONALLY TODDLER-TESTED" />

    <div class="bays__grid">
      <Panel
        v-for="p in projects"
        :key="p.id"
        class="bays__card"
        :class="{ 'bays__card--featured': p.featured }"
      >
        <div class="bays__head">
          <span class="bays__bay label">{{ p.bay }} · {{ p.name }}</span>
          <span class="bays__status">
            <StatusLamp :color="p.statusLamp" :pulse="p.statusLamp !== 'green'" />
            <span class="label">{{ p.status }}</span>
          </span>
        </div>

        <svg
          v-if="p.id === 'kidcam'"
          class="bays__schematic"
          viewBox="0 0 320 150"
          aria-label="KidCam schematic — front view"
          role="img"
        >
          <g fill="none" stroke="var(--teal-hot)" stroke-width="1.5">
            <rect data-draw x="20" y="20" width="200" height="110" rx="10" />
            <circle data-draw cx="160" cy="75" r="34" />
            <circle data-draw cx="160" cy="75" r="22" />
            <rect data-draw x="42" y="44" width="52" height="52" rx="3" />
          </g>
          <g fill="none" stroke-width="1.5">
            <circle data-draw class="bays__led" cx="52" cy="30" r="5" stroke="var(--amber)" />
            <circle data-draw class="bays__led" cx="76" cy="30" r="5" stroke="var(--green)" />
          </g>
          <g fill="none" stroke="var(--text-dim)" stroke-width="1">
            <path data-draw d="M232 40 h60" stroke-dasharray="3 5" />
            <path data-draw d="M232 75 h60" stroke-dasharray="3 5" />
            <path data-draw d="M232 110 h60" stroke-dasharray="3 5" />
          </g>
          <g fill="var(--teal-hot)">
            <circle class="bays__packet" cx="232" cy="40" r="2.2" />
            <circle class="bays__packet" cx="232" cy="75" r="2.2" />
            <circle class="bays__packet" cx="232" cy="110" r="2.2" />
          </g>
          <g class="bays__schematic-labels" fill="var(--text-dim)" font-size="8" font-family="var(--font-mono)">
            <text x="240" y="36">BTN A/B</text>
            <text x="240" y="71">OV2640</text>
            <text x="240" y="106">ST7789 TFT</text>
          </g>
        </svg>

        <p class="bays__blurb">{{ p.blurb }}</p>

        <div class="bays__chips">
          <span v-for="s in p.specs" :key="s" class="bays__chip label">{{ s }}</span>
        </div>

        <div class="bays__links">
          <a
            v-for="l in p.links"
            :key="l.href"
            class="bays__link"
            :href="l.href"
            target="_blank"
            rel="noopener"
          >{{ l.label }}</a>
          <span v-if="!p.links.length" class="bays__link bays__link--dead label">SPEC ON REQUEST</span>
        </div>
      </Panel>
    </div>
  </div>
</template>

<style scoped>
.bays {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}

.bays__grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--space-3);
  perspective: 1100px;
}

.bays__card {
  --glare-x: -200px;
  --glare-y: -200px;
  grid-column: span 4;
  display: flex;
  flex-direction: column;
  transform-style: preserve-3d;
  will-change: transform;
}

.bays__card::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(
    220px circle at var(--glare-x) var(--glare-y),
    rgba(0, 180, 200, 0.09),
    transparent 70%
  );
  transition: opacity 0.25s;
}

.bays__card--lit::after {
  opacity: 1;
}

.bays__card :deep(.panel__body) {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: var(--space-2);
}

.bays__card--featured {
  grid-column: span 8;
  grid-row: span 2;
}

.bays__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  border-bottom: 1px solid var(--hairline);
  padding-bottom: var(--space-2);
}

.bays__bay {
  color: var(--teal-hot);
  font-weight: 700;
}

.bays__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.bays__schematic {
  width: min(100%, 340px);
  margin: var(--space-2) 0;
}

.bays__blurb {
  font-size: var(--fs-data);
  color: var(--text);
  max-width: 58ch;
}

.bays__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: auto;
  padding-top: var(--space-2);
}

.bays__chip {
  border: 1px solid var(--hairline-lit);
  padding: 2px 7px;
  color: var(--text-dim);
}

.bays__links {
  display: flex;
  gap: var(--space-3);
  border-top: 1px solid var(--hairline);
  padding-top: var(--space-2);
}

.bays__link {
  font-size: var(--fs-data);
  letter-spacing: 0.08em;
}

.bays__link--dead {
  color: var(--text-faint);
}

@media (max-width: 900px) {
  .bays {
    padding: var(--space-5) var(--space-3);
  }

  .bays__grid {
    grid-template-columns: 1fr;
  }

  .bays__card,
  .bays__card--featured {
    grid-column: span 1;
    grid-row: auto;
  }
}
</style>
