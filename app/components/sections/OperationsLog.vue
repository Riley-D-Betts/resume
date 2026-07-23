<script setup lang="ts">
import { resume } from '~/data/resume'

/**
 * SEG 03 — OPERATIONS LOG. The career as a production line: a vertical
 * pipe draws itself down the left rail as you scroll (scrubbed), valve
 * nodes flip green as the flow reaches each role, and log entries slam
 * in with [OK] stamps.
 */
const roles = resume.roles

const root = ref<HTMLElement | null>(null)
let ctx: { revert: () => void } | undefined

const stampColor: Record<string, string> = {
  OK: 'var(--green)',
  PROMOTED: 'var(--amber)',
  HIRED: 'var(--teal-hot)',
}

onMounted(async () => {
  const el = root.value
  if (!el) return
  const [{ gsap }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger'), import('gsap/DrawSVGPlugin')])

  const mm = gsap.matchMedia()
  ctx = mm

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const pipe = el.querySelector<SVGGeometryElement>('.opslog__pipe-line')
    if (pipe) {
      gsap.set(pipe, { drawSVG: '0%' })
      gsap.to(pipe, {
        drawSVG: '100%',
        ease: 'none',
        scrollTrigger: { trigger: el.querySelector('.opslog__flow'), start: 'top 60%', end: 'bottom 55%', scrub: 0.8 },
      })
    }

    el.querySelectorAll('.opslog__node').forEach((node) => {
      gsap.to(node, {
        scrollTrigger: {
          trigger: node,
          start: 'top 62%',
          once: true,
          onEnter: () => node.classList.add('opslog__node--live'),
        },
      })
    })

    el.querySelectorAll('.opslog__entry').forEach((entry) => {
      const stamp = entry.querySelector('.opslog__stamp')
      gsap.set(entry, { autoAlpha: 0, x: 24 })
      if (stamp) gsap.set(stamp, { autoAlpha: 0, scale: 1.4 })
      const tl = gsap.timeline({
        scrollTrigger: { trigger: entry, start: 'top 78%', once: true },
      })
      tl.to(entry, { autoAlpha: 1, x: 0, duration: 0.4, ease: 'power2.out' })
      if (stamp) {
        tl.to(stamp, { autoAlpha: 1, scale: 1, duration: 0.18, ease: 'power3.in' }, '-=0.1').to(
          stamp,
          { opacity: 0.4, duration: 0.05, yoyo: true, repeat: 1 },
          '>',
        )
      }
    })

    el.querySelectorAll('.opslog__role-head').forEach((head) => {
      gsap.set(head, { autoAlpha: 0, y: 18 })
      gsap.to(head, {
        autoAlpha: 1,
        y: 0,
        duration: 0.5,
        scrollTrigger: { trigger: head, start: 'top 74%', once: true },
      })
    })
  })
})

onUnmounted(() => ctx?.revert())
</script>

<template>
  <div ref="root" class="opslog">
    <SectionHeader num="03" title="OPERATIONS LOG" tag="WORK HISTORY — CONTINUOUS FLOW, NO BATCH FAILURES" />

    <div class="opslog__flow">
      <svg class="opslog__pipe" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 24 100">
        <line class="opslog__pipe-shadow" x1="12" y1="0" x2="12" y2="100" />
        <line class="opslog__pipe-line" x1="12" y1="0" x2="12" y2="100" />
      </svg>

      <article
        v-for="(role, ri) in roles"
        :key="role.org"
        class="opslog__role"
        :class="{ 'opslog__role--offset': ri % 2 === 1 }"
      >
        <span class="opslog__node" aria-hidden="true" />

        <header class="opslog__role-head">
          <h3 class="opslog__org display">{{ role.org }}</h3>
          <p v-if="role.aka" class="opslog__aka label">{{ role.aka }}</p>
          <div class="opslog__titles">
            <div v-for="t in role.titles" :key="t.title" class="opslog__title-row">
              <span class="opslog__title">{{ t.title }}</span>
              <span class="opslog__period label">{{ t.period }}</span>
            </div>
          </div>
          <p class="opslog__summary">{{ role.summary }}</p>
        </header>

        <ul class="opslog__entries">
          <li v-for="line in role.logLines" :key="line.text" class="opslog__entry">
            <span class="opslog__entry-text">{{ line.text }}</span>
            <span
              v-if="line.stamp"
              class="opslog__stamp"
              :style="{ color: stampColor[line.stamp], borderColor: stampColor[line.stamp] }"
            >[{{ line.stamp }}]</span>
          </li>
        </ul>

        <div class="opslog__tags">
          <span v-for="tag in role.tags" :key="tag" class="opslog__tag">{{ tag }}</span>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.opslog {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}

.opslog__flow {
  position: relative;
  padding-left: 56px;
}

.opslog__pipe {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 12px;
  width: 24px;
  height: 100%;
}

.opslog__pipe-shadow,
.opslog__pipe-line {
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  fill: none;
}

.opslog__pipe-shadow {
  stroke: var(--hairline);
}

.opslog__pipe-line {
  stroke: var(--teal-hot);
}

.opslog__role {
  position: relative;
  padding-bottom: var(--space-5);
}

.opslog__role--offset {
  margin-left: clamp(0px, 6vw, 90px);
}

.opslog__node {
  position: absolute;
  left: -52px;
  top: 0.4em;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 2px solid var(--text-dim);
  background: var(--bg-0);
  transition: border-color 0.3s, background 0.3s, box-shadow 0.3s;
}

.opslog__role--offset .opslog__node {
  left: calc(-52px - clamp(0px, 6vw, 90px));
}

.opslog__node--live {
  border-color: var(--green);
  background: var(--green);
  box-shadow: 0 0 8px 2px rgba(47, 213, 117, 0.5);
}

.opslog__org {
  font-size: clamp(1.3rem, 3vw, 2.1rem);
}

.opslog__aka {
  color: var(--teal-hot);
  margin-top: var(--space-1);
}

.opslog__titles {
  margin-top: var(--space-2);
  border-left: 2px solid var(--hairline-lit);
  padding-left: var(--space-2);
}

.opslog__title-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: baseline;
}

.opslog__title {
  color: var(--text);
  font-weight: 700;
  font-size: var(--fs-data);
  letter-spacing: 0.06em;
}

.opslog__period {
  color: var(--text-faint);
}

.opslog__summary {
  margin-top: var(--space-2);
  max-width: 58ch;
  color: var(--text-dim);
  font-size: var(--fs-data);
}

.opslog__entries {
  list-style: none;
  margin-top: var(--space-3);
  display: grid;
  gap: var(--space-2);
}

.opslog__entry {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--fs-data);
  color: var(--text);
  max-width: 72ch;
}

.opslog__entry::before {
  content: '>';
  color: var(--teal);
  flex: none;
}

.opslog__stamp {
  flex: none;
  font-size: var(--fs-micro);
  font-weight: 700;
  letter-spacing: 0.1em;
  border: 1px solid;
  padding: 0 4px;
}

.opslog__tags {
  margin-top: var(--space-3);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.opslog__tag {
  font-size: var(--fs-micro);
  letter-spacing: 0.12em;
  color: var(--text-dim);
  border: 1px solid var(--hairline);
  padding: 2px 8px;
}

@media (max-width: 900px) {
  .opslog {
    padding: var(--space-5) var(--space-3);
  }

  .opslog__flow {
    padding-left: 34px;
  }

  .opslog__pipe {
    left: 4px;
  }

  .opslog__role--offset {
    margin-left: 0;
  }

  .opslog__node {
    left: -30px;
    width: 11px;
    height: 11px;
  }

  .opslog__role--offset .opslog__node {
    left: -30px;
  }
}
</style>
