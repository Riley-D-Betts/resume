<script setup lang="ts">
import { resume } from '~/data/resume'

/**
 * SEG 05 — PROJECT BAYS. An equipment-bay grid with uneven spans;
 * KidCam gets the featured bay with a line-art schematic that draws
 * itself. Outbound GitHub links are the analytics money metric.
 */
const projects = resume.projects

const root = ref<HTMLElement | null>(null)
let ctx: { revert: () => void } | undefined

const lampFor: Record<string, 'green' | 'amber' | 'teal'> = {}
for (const p of projects) lampFor[p.id] = p.statusLamp

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
    gsap.set(cards, { autoAlpha: 0, y: 26 })

    ScrollTrigger.batch(Array.from(cards), {
      start: 'top 82%',
      once: true,
      onEnter: (batch) => {
        gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out', stagger: 0.1 })
        for (const card of batch as HTMLElement[]) {
          const chips = card.querySelectorAll('.bays__chip')
          gsap.fromTo(chips, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.25, stagger: 0.04, delay: 0.3 })
        }
      },
    })

    const strokes = el.querySelectorAll<SVGGeometryElement>('.bays__schematic [data-draw]')
    if (strokes.length) {
      gsap.set(strokes, { drawSVG: '0%' })
      gsap.to(strokes, {
        drawSVG: '100%',
        duration: 1.2,
        ease: 'power2.inOut',
        stagger: 0.1,
        scrollTrigger: { trigger: el.querySelector('.bays__schematic'), start: 'top 80%', once: true },
      })
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
            <circle data-draw cx="52" cy="30" r="5" stroke="var(--amber)" />
            <circle data-draw cx="76" cy="30" r="5" stroke="var(--green)" />
          </g>
          <g fill="none" stroke="var(--text-dim)" stroke-width="1">
            <path data-draw d="M232 40 h60" stroke-dasharray="3 5" />
            <path data-draw d="M232 75 h60" stroke-dasharray="3 5" />
            <path data-draw d="M232 110 h60" stroke-dasharray="3 5" />
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
}

.bays__card {
  grid-column: span 4;
  display: flex;
  flex-direction: column;
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
