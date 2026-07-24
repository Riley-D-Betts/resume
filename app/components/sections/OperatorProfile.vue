<script setup lang="ts">
import { resume } from '~/data/resume'

/**
 * SEG 02 — OPERATOR PROFILE. Dossier layout: schematic ID badge,
 * bio, count-up stats, fuse-panel skill rows. Beyond the entrance:
 * the badge runs a continuous scan (sweep line + a blip orbiting the
 * head circle), bio lines brighten as they cross the reading beam,
 * and the stats flicker as they lock in.
 */
const about = resume.about

const root = ref<HTMLElement | null>(null)
let ctx: { revert: () => void } | undefined

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
    await document.fonts.ready

    const badge = el.querySelector('.profile__badge')
    const badgeStrokes = el.querySelectorAll<SVGGeometryElement>('.profile__avatar [data-draw]')
    const sweep = el.querySelector('.profile__avatar-sweep')
    const blip = el.querySelector('.profile__avatar-blip')
    const paras = el.querySelectorAll('.profile__para')
    const fuses = el.querySelectorAll('.profile__fuse')
    const fuseLamps = el.querySelectorAll('.profile__fuse .lamp')
    const statEls = el.querySelectorAll<HTMLElement>('.profile__stat-value')

    const split = new SplitText(paras, { type: 'lines', linesClass: 'profile__line' })
    split.lines.forEach((line) => {
      const mask = document.createElement('span')
      mask.className = 'profile__line-mask'
      line.parentNode?.insertBefore(mask, line)
      mask.appendChild(line)
    })

    gsap.set(badge, { autoAlpha: 0, x: -20 })
    gsap.set(badgeStrokes, { drawSVG: '0%' })
    gsap.set([sweep, blip], { autoAlpha: 0 })
    gsap.set(split.lines, { yPercent: 110 })
    gsap.set(fuses, { autoAlpha: 0 })
    gsap.set(fuseLamps, { backgroundColor: 'var(--text-faint)', boxShadow: 'none' })

    const tl = gsap.timeline({
      scrollTrigger: { trigger: el, start: 'top 70%', once: true },
    })

    tl.to(badge, { autoAlpha: 1, x: 0, duration: 0.5, ease: 'console' })
      .to(badgeStrokes, { drawSVG: '100%', duration: 1.1, ease: 'power2.inOut', stagger: 0.08 }, '<0.1')
      .to(split.lines, { yPercent: 0, duration: 0.7, ease: 'power3.out', stagger: 0.045 }, '<0.2')
      .to(
        gsap.utils.shuffle(Array.from(fuses)),
        { autoAlpha: 1, duration: 0.16, stagger: 0.05 },
        '<0.4',
      )
      .to(
        gsap.utils.shuffle(Array.from(fuseLamps)),
        { backgroundColor: 'var(--green)', duration: 0.1, stagger: 0.04, clearProps: 'boxShadow' },
        '<0.15',
      )
      .to([sweep, blip], { autoAlpha: 1, duration: 0.4 }, '>-0.2')

    // -- continuous badge scan (only while the badge is visible) --
    const scan = gsap.timeline({ repeat: -1, paused: true })
    if (sweep) {
      scan.fromTo(sweep, { attr: { y1: 18, y2: 18 } }, { attr: { y1: 200, y2: 200 }, duration: 2.6, ease: 'none' }, 0)
        .to(sweep, { opacity: 0.15, duration: 0.3, yoyo: true, repeat: 1 }, 2.0)
    }
    if (blip) {
      // orbit the head circle (cx 100, cy 78, r 34)
      scan.to(
        blip,
        {
          duration: 2.6,
          ease: 'none',
          motionPath: {
            path: 'M100,44 A34,34 0 1 1 99.9,44',
            autoRotate: false,
          },
        },
        0,
      )
    }
    ScrollTrigger.create({
      trigger: badge as Element,
      start: 'top bottom',
      end: 'bottom top',
      onToggle: (self) => (self.isActive ? scan.play() : scan.pause()),
    })

    // -- reading beam: lines brighten as they cross mid-view -----
    for (const line of split.lines) {
      gsap.fromTo(
        line,
        { opacity: 0.45 },
        {
          opacity: 1,
          ease: 'none',
          scrollTrigger: { trigger: line, start: 'top 78%', end: 'top 52%', scrub: true },
        },
      )
    }

    // -- count-up stats, flicker on lock-in ----------------------
    statEls.forEach((statEl) => {
      const target = Number(statEl.dataset.countTo)
      if (Number.isNaN(target)) return
      const decimals = statEl.dataset.countTo?.includes('.') ? 1 : 0
      const proxy = { n: target === 0 ? 87 : 0 }
      gsap.to(proxy, {
        n: target,
        duration: 1.4,
        ease: 'power2.out',
        scrollTrigger: { trigger: statEl, start: 'top 80%', once: true },
        onUpdate() {
          statEl.textContent = proxy.n.toFixed(decimals)
        },
        onComplete() {
          gsap.fromTo(statEl, { opacity: 0.35 }, { opacity: 1, duration: 0.07, repeat: 3, yoyo: true })
        },
      })
    })

    ScrollTrigger.refresh()
    return () => {
      scan.kill()
      split.revert()
    }
  })
})

onUnmounted(() => ctx?.revert())
</script>

<template>
  <div ref="root" class="profile">
    <SectionHeader num="02" :title="about.header" :tag="about.fileTag" />

    <div class="profile__cols">
      <Panel class="profile__badge" title="ID BADGE // OPERATOR">
        <svg class="profile__avatar" viewBox="0 0 200 220" role="img" aria-label="Schematic operator portrait">
          <g fill="none" stroke="var(--teal-hot)" stroke-width="1.5">
            <circle data-draw cx="100" cy="78" r="34" />
            <path data-draw d="M40 190 C40 150 70 132 100 132 C130 132 160 150 160 190" />
            <path data-draw d="M84 70 h10 M106 70 h10" stroke="var(--green)" />
            <path data-draw d="M92 92 h16" stroke="var(--text-dim)" />
          </g>
          <g stroke="var(--hairline-lit)" stroke-width="1">
            <path data-draw d="M12 12 h24 M12 12 v24" />
            <path data-draw d="M188 12 h-24 M188 12 v24" />
            <path data-draw d="M12 208 h24 M12 208 v-24" />
            <path data-draw d="M188 208 h-24 M188 208 v-24" />
            <path data-draw d="M20 110 h160" stroke-dasharray="2 6" />
          </g>
          <line
            class="profile__avatar-sweep"
            x1="14"
            y1="18"
            x2="186"
            y2="18"
            stroke="var(--teal-hot)"
            stroke-width="1"
            opacity="0.5"
          />
          <circle class="profile__avatar-blip" cx="100" cy="44" r="2.5" fill="var(--green)" />
        </svg>
        <div class="profile__badge-meta">
          <p class="label">OPERATOR CLASS</p>
          <p class="profile__class">{{ about.operatorClass }}</p>
          <p class="label profile__clear-label">CLEARANCES</p>
          <ul class="profile__clearances">
            <li v-for="c in about.clearances" :key="c">{{ c }}</li>
          </ul>
        </div>
      </Panel>

      <div class="profile__body">
        <p v-for="(p, i) in about.paragraphs" :key="i" class="profile__para">{{ p }}</p>

        <div class="profile__stats">
          <div v-for="s in about.stats" :key="s.label" class="profile__stat">
            <div class="profile__stat-big">
              <span
                class="profile__stat-value"
                :data-count-to="s.countTo !== undefined ? String(s.countTo) : undefined"
              >{{ s.value }}</span
              ><span class="profile__stat-suffix">{{ s.suffix }}</span>
            </div>
            <p class="label">{{ s.label }}</p>
          </div>
        </div>

        <div class="profile__fusebox">
          <p class="label profile__fusebox-title">// CAPABILITY BREAKER PANEL</p>
          <div v-for="group in about.skillGroups" :key="group.label" class="profile__fuse-row">
            <span class="profile__fuse-group label">{{ group.label }}</span>
            <div class="profile__fuse-chips">
              <span v-for="skill in group.skills" :key="skill" class="profile__fuse">
                <StatusLamp color="green" :pulse="false" />
                {{ skill }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}

.profile__cols {
  display: grid;
  grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}

.profile__avatar {
  width: 100%;
  background:
    linear-gradient(var(--hairline) 1px, transparent 1px) 0 0 / 20px 20px,
    linear-gradient(90deg, var(--hairline) 1px, transparent 1px) 0 0 / 20px 20px;
}

.profile__badge-meta {
  margin-top: var(--space-3);
  display: grid;
  gap: var(--space-1);
}

.profile__class {
  color: var(--teal-hot);
  font-size: var(--fs-data);
}

.profile__clear-label {
  margin-top: var(--space-2);
}

.profile__clearances {
  list-style: none;
  font-size: var(--fs-micro);
  letter-spacing: 0.1em;
  color: var(--text-dim);
  display: grid;
  gap: 2px;
}

.profile__clearances li::before {
  content: '▸ ';
  color: var(--green);
}

.profile__body {
  min-width: 0;
}

.profile__para {
  font-size: var(--fs-body);
  max-width: 62ch;
  margin-bottom: var(--space-3);
  color: var(--text);
}

.profile__para :deep(.profile__line-mask) {
  display: block;
  overflow: hidden;
}

.profile__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin: var(--space-4) 0;
  border-top: 1px solid var(--hairline);
  border-bottom: 1px solid var(--hairline);
  padding: var(--space-3) 0;
}

.profile__stat-big {
  font-family: var(--font-display);
  font-size: clamp(1.6rem, 3.4vw, 2.8rem);
  color: var(--green);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.profile__stat-suffix {
  color: var(--text-dim);
  font-size: 0.55em;
  margin-left: 0.15em;
}

.profile__fusebox {
  margin-top: var(--space-4);
}

.profile__fusebox-title {
  color: var(--text-faint);
  margin-bottom: var(--space-2);
}

.profile__fuse-row {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr);
  gap: var(--space-2);
  align-items: baseline;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--hairline);
}

.profile__fuse-group {
  color: var(--teal-hot);
}

.profile__fuse-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.profile__fuse {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--hairline-lit);
  background: var(--bg-1);
  padding: 3px 8px;
  font-size: var(--fs-micro);
  letter-spacing: 0.1em;
}

@media (pointer: fine) and (prefers-reduced-motion: no-preference) {
  .profile__fuse:hover {
    border-color: var(--green);
    animation: fuse-flicker 0.25s steps(2) 2;
  }
}

@keyframes fuse-flicker {
  50% {
    opacity: 0.5;
  }
}

@media (max-width: 900px) {
  .profile {
    padding: var(--space-5) var(--space-3);
  }

  .profile__cols {
    grid-template-columns: 1fr;
  }

  .profile__badge {
    max-width: 320px;
  }

  .profile__stats {
    grid-template-columns: 1fr;
    gap: var(--space-2);
  }

  .profile__fuse-row {
    grid-template-columns: 1fr;
  }
}
</style>
