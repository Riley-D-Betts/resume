<script setup lang="ts">
import type { StatusReadout } from '~/data/resume'

const props = defineProps<{ readout: StatusReadout }>()

const uptime = props.readout.live === 'uptime' ? useUptime() : null
const clock = props.readout.live === 'clock' ? useIdahoTime() : null

const value = computed(() => {
  if (uptime) return uptime.value
  if (clock) return clock.value
  return props.readout.value
})
</script>

<template>
  <div class="readout">
    <span class="readout__label label">{{ readout.label }}</span>
    <StatusLamp v-if="readout.lamp" :color="readout.lamp" />
    <span class="readout__value" :class="{ 'readout__value--live': readout.live }">{{ value }}</span>
  </div>
</template>

<style scoped>
.readout {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--hairline);
  font-size: var(--fs-data);
}

.readout__label {
  flex: none;
  min-width: 4.5em;
}

.readout .lamp {
  align-self: center;
}

.readout__value {
  color: var(--text);
  overflow-wrap: anywhere;
}

.readout__value--live {
  color: var(--green);
  font-variant-numeric: tabular-nums;
}
</style>
