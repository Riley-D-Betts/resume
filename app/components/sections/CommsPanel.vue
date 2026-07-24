<script setup lang="ts">
import { resume } from '~/data/resume'

/**
 * SEG 06 — COMMS. A terminal window types the uplink handshake with a
 * live caret, an oscilloscope draws the carrier wave the whole time,
 * the action buttons are gently magnetic, and the privacy notice
 * decodes itself when it scrolls into view.
 */
const comms = resume.comms
const identity = resume.identity

const root = ref<HTMLElement | null>(null)
const copied = ref(false)
let ctx: { revert: () => void } | undefined

async function copyAddr() {
  try {
    await navigator.clipboard.writeText(identity.email)
    copied.value = true
    setTimeout(() => (copied.value = false), 3000)
  } catch {
    location.href = `mailto:${identity.email}`
  }
}

onMounted(async () => {
  const el = root.value
  if (!el) return
  const [{ gsap }, { ScrollTrigger }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger')])

  const mm = gsap.matchMedia()
  ctx = mm

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const lines = el.querySelectorAll<HTMLElement>('.comms__prompt-line')
    const carets = el.querySelectorAll<HTMLElement>('.comms__caret')
    const ready = el.querySelector('.comms__ready')
    const actions = el.querySelectorAll<HTMLElement>('.comms__action')

    gsap.set(lines, { autoAlpha: 0 })
    gsap.set(carets, { autoAlpha: 0 })
    gsap.set(ready, { autoAlpha: 0 })
    gsap.set(actions, { autoAlpha: 0, y: 10 })

    const tl = gsap.timeline({
      scrollTrigger: { trigger: el, start: 'top 70%', once: true },
    })

    lines.forEach((lineEl, i) => {
      const text = comms.promptLines[i] ?? ''
      const at = i * 0.5
      tl.set(carets[i] ?? [], { autoAlpha: 1 }, at)
        .to(
          lineEl,
          { autoAlpha: 1, duration: 0.45, scrambleText: { text, chars: '01▮#/', speed: 1.6 }, ease: 'none' },
          at,
        )
        .set(carets[i] ?? [], { autoAlpha: 0 }, at + 0.48)
    })

    tl.to(ready, { autoAlpha: 1, duration: 0.3 }, '>0.2').to(
      actions,
      { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.08, ease: 'console' },
      '>-0.1',
    )

    // -- oscilloscope: carrier wave, alive while visible ---
    const scope = el.querySelector<SVGPathElement>('.comms__scope-path')
    let scopeTween: gsap.core.Tween | undefined
    if (scope) {
      const phase = { p: 0 }
      const W = 140
      const MID = 14
      const draw = () => {
        let d = `M0 ${MID.toFixed(1)}`
        for (let x = 4; x <= W; x += 4) {
          const y = MID + Math.sin(x * 0.09 + phase.p) * 7 * Math.sin(x * 0.013 + phase.p * 0.4)
          d += ` L${x} ${y.toFixed(1)}`
        }
        scope.setAttribute('d', d)
      }
      scopeTween = gsap.to(phase, {
        p: Math.PI * 2,
        duration: 1.6,
        ease: 'none',
        repeat: -1,
        paused: true,
        onUpdate: draw,
      })
      draw()
      ScrollTrigger.create({
        trigger: el,
        start: 'top bottom',
        end: 'bottom top',
        onToggle: (self) => (self.isActive ? scopeTween!.play() : scopeTween!.pause()),
      })
    }

    // -- magnetic actions (fine pointers) ------------------
    const cleanups: (() => void)[] = []
    if (window.matchMedia('(pointer: fine)').matches) {
      actions.forEach((btn) => {
        const toX = gsap.quickTo(btn, 'x', { duration: 0.3, ease: 'power2.out' })
        const toY = gsap.quickTo(btn, 'y', { duration: 0.3, ease: 'power2.out' })
        const onMove = (e: PointerEvent) => {
          const r = btn.getBoundingClientRect()
          toX(((e.clientX - r.left) / r.width - 0.5) * 8)
          toY(((e.clientY - r.top) / r.height - 0.5) * 6)
        }
        const onLeave = () => {
          toX(0)
          toY(0)
        }
        btn.addEventListener('pointermove', onMove, { passive: true })
        btn.addEventListener('pointerleave', onLeave, { passive: true })
        cleanups.push(() => {
          btn.removeEventListener('pointermove', onMove)
          btn.removeEventListener('pointerleave', onLeave)
        })
      })
    }

    // -- privacy notice decodes in ------------------------
    const privacy = el.querySelector<HTMLElement>('.comms__privacy')
    if (privacy) {
      const text = privacy.textContent ?? ''
      gsap.to(privacy, {
        duration: 1.1,
        scrambleText: { text, chars: '01▮▯#', speed: 0.9 },
        scrollTrigger: { trigger: privacy, start: 'top 94%', once: true },
      })
    }

    return () => {
      scopeTween?.kill()
      cleanups.forEach((c) => c())
    }
  })
})

onUnmounted(() => ctx?.revert())
</script>

<template>
  <div ref="root" class="comms">
    <SectionHeader num="06" title="COMMS" tag="OPEN A CHANNEL — RESPONSE TIME BETTER THAN MOST TICKETING SYSTEMS" />

    <Panel class="comms__terminal" :title="comms.title">
      <svg class="comms__scope" viewBox="0 0 140 28" aria-hidden="true">
        <path class="comms__scope-path" fill="none" stroke="var(--green)" stroke-width="1.2" />
      </svg>

      <div class="comms__screen">
        <p v-for="(line, i) in comms.promptLines" :key="i" class="comms__prompt-row">
          <span class="comms__prompt-line">{{ line }}</span><span class="comms__caret">▮</span>
        </p>
        <p class="comms__ready">
          {{ comms.ready }} <span class="blink" />
        </p>
        <p v-if="copied" class="comms__copied">> ADDR COPIED ......... OK</p>
      </div>

      <div class="comms__actions">
        <template v-for="a in comms.actions" :key="a.label">
          <button v-if="a.kind === 'copy'" class="comms__action" type="button" @click="copyAddr">
            {{ a.label }}
          </button>
          <a
            v-else
            class="comms__action"
            :href="a.href"
            :target="a.kind === 'link' ? '_blank' : undefined"
            :rel="a.kind === 'link' ? 'noopener' : undefined"
          >{{ a.label }}</a>
        </template>
      </div>
    </Panel>

    <footer class="comms__footer">
      <p>{{ comms.footer }}</p>
      <p class="comms__privacy">{{ comms.privacyNotice }}</p>
      <a class="void-link" href="/void.html" rel="nofollow" tabindex="-1" aria-hidden="true">void</a>
    </footer>
  </div>
</template>

<style scoped>
.comms {
  max-width: 860px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4) var(--space-4);
}

.comms__terminal :deep(.panel__body) {
  position: relative;
  padding: var(--space-4);
}

.comms__scope {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  width: 140px;
  height: 28px;
  opacity: 0.7;
}

.comms__screen {
  min-height: 9em;
  font-size: var(--fs-data);
  line-height: 2;
}

.comms__prompt-row {
  min-height: 2em;
}

.comms__prompt-line {
  color: var(--text-dim);
}

.comms__caret {
  color: var(--green);
  margin-left: 2px;
}

.comms__ready {
  color: var(--green);
  font-weight: 700;
  letter-spacing: 0.06em;
}

.comms__copied {
  color: var(--teal-hot);
}

.comms__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
  border-top: 1px solid var(--hairline);
  padding-top: var(--space-3);
}

.comms__action {
  display: inline-block;
  border: 1px solid var(--hairline-lit);
  color: var(--text);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-data);
  letter-spacing: 0.08em;
  transition: border-color 0.2s, color 0.2s, background 0.2s;
  will-change: transform;
}

.comms__action:hover {
  border-color: var(--teal-hot);
  color: var(--teal-hot);
  text-decoration: none;
  background: var(--bg-2);
}

.comms__action:active {
  transform: scale(0.97);
}

.comms__footer {
  position: relative;
  margin-top: var(--space-5);
  border-top: 1px solid var(--hairline);
  padding-top: var(--space-3);
  font-size: var(--fs-micro);
  letter-spacing: 0.1em;
  color: var(--text-faint);
  display: grid;
  gap: var(--space-1);
}

.comms__privacy {
  color: var(--text-dim);
}

@media (prefers-reduced-motion: reduce) {
  .comms__scope,
  .comms__caret {
    display: none;
  }
}

@media (max-width: 900px) {
  .comms {
    padding: var(--space-5) var(--space-3) var(--space-3);
  }

  .comms__scope {
    display: none;
  }

  .comms__actions {
    flex-direction: column;
  }

  .comms__action {
    text-align: center;
  }
}
</style>
