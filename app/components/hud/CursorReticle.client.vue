<script setup lang="ts">
/**
 * Crosshair reticle that lags the pointer. Fine pointers only, off
 * under reduced motion. Over interactive elements it expands to corner
 * brackets; over outbound links it shows a tiny TRACK tag — a wink at
 * the analytics.
 */
const enabled = ref(false)
const mode = ref<'idle' | 'hover' | 'track'>('idle')
const root = ref<HTMLElement | null>(null)

let cleanup: (() => void) | undefined

onMounted(async () => {
  const fine = window.matchMedia('(pointer: fine)').matches
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!fine || reduced) return
  enabled.value = true
  await nextTick()

  const { gsap } = await import('gsap')
  const el = root.value
  if (!el) return

  const toX = gsap.quickTo(el, 'x', { duration: 0.18, ease: 'power2.out' })
  const toY = gsap.quickTo(el, 'y', { duration: 0.18, ease: 'power2.out' })

  const onMove = (e: PointerEvent) => {
    toX(e.clientX)
    toY(e.clientY)
  }

  const onOver = (e: PointerEvent) => {
    const t = (e.target as Element | null)?.closest('a, button, [data-cursor]')
    if (!t) {
      mode.value = 'idle'
      return
    }
    const href = t.getAttribute('href') || ''
    const external = /^https?:\/\//.test(href) && !href.startsWith(location.origin)
    mode.value = external ? 'track' : 'hover'
  }

  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerover', onOver, { passive: true })
  cleanup = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerover', onOver)
  }
})

onUnmounted(() => cleanup?.())
</script>

<template>
  <div v-if="enabled" ref="root" class="reticle" :class="`reticle--${mode}`" aria-hidden="true">
    <span class="reticle__h" />
    <span class="reticle__v" />
    <span class="reticle__c reticle__c--tl" />
    <span class="reticle__c reticle__c--tr" />
    <span class="reticle__c reticle__c--bl" />
    <span class="reticle__c reticle__c--br" />
    <span class="reticle__tag">TRACK</span>
  </div>
</template>

<style scoped>
.reticle {
  position: fixed;
  top: -14px;
  left: -14px;
  width: 28px;
  height: 28px;
  z-index: var(--z-cursor);
  pointer-events: none;
}

.reticle__h,
.reticle__v {
  position: absolute;
  background: var(--teal-hot);
  opacity: 0.9;
  transition: opacity 0.2s;
}

.reticle__h {
  top: 50%;
  left: 25%;
  right: 25%;
  height: 1px;
}

.reticle__v {
  left: 50%;
  top: 25%;
  bottom: 25%;
  width: 1px;
}

.reticle__c {
  position: absolute;
  width: 7px;
  height: 7px;
  border: 1px solid var(--teal-hot);
  opacity: 0;
  transition: opacity 0.15s, transform 0.15s;
}

.reticle__c--tl { top: 0; left: 0; border-right: none; border-bottom: none; }
.reticle__c--tr { top: 0; right: 0; border-left: none; border-bottom: none; }
.reticle__c--bl { bottom: 0; left: 0; border-right: none; border-top: none; }
.reticle__c--br { bottom: 0; right: 0; border-left: none; border-top: none; }

.reticle--hover .reticle__h,
.reticle--track .reticle__h,
.reticle--hover .reticle__v,
.reticle--track .reticle__v {
  opacity: 0.25;
}

.reticle--hover .reticle__c,
.reticle--track .reticle__c {
  opacity: 1;
  transform: scale(1.35);
}

.reticle__tag {
  position: absolute;
  top: -14px;
  left: 130%;
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--red);
  opacity: 0;
  transition: opacity 0.15s;
}

.reticle--track .reticle__tag {
  opacity: 1;
}
</style>
