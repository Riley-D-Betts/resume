<script setup lang="ts">
import { resume } from '~/data/resume'

/**
 * SEG 06 — COMMS. A terminal window that types the uplink handshake,
 * then offers the four channels. The footer carries the analytics
 * notice and the honeypot link.
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
  const [{ gsap }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger')])

  const mm = gsap.matchMedia()
  ctx = mm

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const lines = el.querySelectorAll<HTMLElement>('.comms__prompt-line')
    const ready = el.querySelector('.comms__ready')
    const actions = el.querySelectorAll('.comms__action')

    gsap.set(lines, { autoAlpha: 0 })
    gsap.set(ready, { autoAlpha: 0 })
    gsap.set(actions, { autoAlpha: 0, y: 10 })

    const tl = gsap.timeline({
      scrollTrigger: { trigger: el, start: 'top 70%', once: true },
    })

    lines.forEach((lineEl, i) => {
      const text = comms.promptLines[i] ?? ''
      tl.to(
        lineEl,
        { autoAlpha: 1, duration: 0.45, scrambleText: { text, chars: '01▮#/', speed: 1.6 }, ease: 'none' },
        i * 0.5,
      )
    })

    tl.to(ready, { autoAlpha: 1, duration: 0.3 }, '>0.2').to(
      actions,
      { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.08 },
      '>-0.1',
    )
  })
})

onUnmounted(() => ctx?.revert())
</script>

<template>
  <div ref="root" class="comms">
    <SectionHeader num="06" title="COMMS" tag="OPEN A CHANNEL — RESPONSE TIME BETTER THAN MOST TICKETING SYSTEMS" />

    <Panel class="comms__terminal" :title="comms.title">
      <div class="comms__screen">
        <p v-for="(line, i) in comms.promptLines" :key="i" class="comms__prompt-line">{{ line }}</p>
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
  padding: var(--space-4);
}

.comms__screen {
  min-height: 9em;
  font-size: var(--fs-data);
  line-height: 2;
}

.comms__prompt-line {
  color: var(--text-dim);
  min-height: 2em;
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
}

.comms__action:hover {
  border-color: var(--teal-hot);
  color: var(--teal-hot);
  text-decoration: none;
  background: var(--bg-2);
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

@media (max-width: 900px) {
  .comms {
    padding: var(--space-5) var(--space-3) var(--space-3);
  }

  .comms__actions {
    flex-direction: column;
  }

  .comms__action {
    text-align: center;
  }
}
</style>
