<script setup lang="ts">
import type { eventWithTime } from '@rrweb/types'

const props = defineProps<{ sid: string }>()

const host = ref<HTMLDivElement | null>(null)
const state = ref<'loading' | 'ready' | 'empty' | 'error'>('loading')

// rrweb-player v2 is a Svelte 4 component class: new Player({ target, props })
let player: { $destroy: () => void } | null = null

onMounted(async () => {
  try {
    const events = await $fetch<eventWithTime[]>(`/api/ops/replay/${props.sid}`)
    // rrweb needs a full snapshot + at least one more event to play anything
    if (!Array.isArray(events) || events.length < 2) {
      state.value = 'empty'
      return
    }

    const [{ default: Player }] = await Promise.all([
      import('rrweb-player'),
      import('rrweb-player/dist/style.css'),
    ])

    state.value = 'ready'
    await nextTick()
    const el = host.value
    if (!el) return

    const width = Math.max(320, Math.floor(el.clientWidth || 480))
    player = new Player({
      target: el,
      props: {
        events,
        autoPlay: false,
        skipInactive: true,
        width,
        height: Math.round(width * 0.62),
      },
    }) as unknown as { $destroy: () => void }
  } catch (err) {
    const statusCode = (err as { statusCode?: number } | null)?.statusCode
    state.value = statusCode === 404 ? 'empty' : 'error'
  }
})

onBeforeUnmount(() => {
  player?.$destroy()
  player = null
})
</script>

<template>
  <div class="replay" data-testid="replay-player">
    <div v-if="state === 'loading'" class="replay__msg label">... POLLING</div>
    <div v-else-if="state === 'empty'" class="replay__msg label">NO REPLAY CAPTURED</div>
    <div v-else-if="state === 'error'" class="replay__msg replay__msg--err label">
      REPLAY LINK FAULT
    </div>
    <div ref="host" class="replay__host" />
  </div>
</template>

<style scoped>
.replay {
  min-width: 0;
}

.replay__msg {
  padding: var(--space-4) 0;
  text-align: center;
  color: var(--text-faint);
}

.replay__msg--err {
  color: var(--red);
}

.replay__host {
  min-width: 0;
  overflow: hidden;
}

/* fold the stock (light) player chrome into the console skin */
.replay__host :deep(.rr-player) {
  background: var(--bg-2);
  border: 1px solid var(--hairline);
  border-radius: 0;
  box-shadow: none;
  float: none;
}

.replay__host :deep(.rr-controller) {
  background: var(--bg-1);
  color: var(--text);
  border-radius: 0;
}

.replay__host :deep(.rr-timeline__time) {
  color: var(--text-dim);
}

.replay__host :deep(.rr-progress__step) {
  background: var(--teal);
}

.replay__host :deep(.rr-progress__handler) {
  background: var(--teal-hot);
}

.replay__host :deep(.switch input[type='checkbox']:checked + label:before) {
  background: var(--teal);
}
</style>
