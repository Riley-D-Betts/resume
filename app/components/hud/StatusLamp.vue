<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    color?: 'green' | 'amber' | 'red' | 'teal' | 'off'
    pulse?: boolean
  }>(),
  { color: 'green', pulse: true },
)

const colorVar = computed(() => {
  if (props.color === 'off') return 'var(--text-faint)'
  if (props.color === 'teal') return 'var(--teal-hot)'
  return `var(--${props.color})`
})
</script>

<template>
  <span
    class="lamp"
    :class="[`lamp--${color}`, { 'lamp--pulse': pulse && color !== 'off' }]"
    :style="{ background: colorVar }"
    aria-hidden="true"
  />
</template>

<style scoped>
.lamp {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}

.lamp--green { box-shadow: 0 0 5px 1px rgba(47, 213, 117, 0.5); }
.lamp--amber { box-shadow: 0 0 5px 1px rgba(255, 176, 32, 0.5); }
.lamp--red { box-shadow: 0 0 5px 1px rgba(255, 69, 69, 0.5); }
.lamp--teal { box-shadow: 0 0 5px 1px rgba(0, 180, 200, 0.5); }
.lamp--off { box-shadow: none; }

.lamp--pulse {
  animation: lamp-pulse 2s ease-in-out infinite;
}

@keyframes lamp-pulse {
  50% {
    opacity: 0.45;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lamp--pulse {
    animation: none;
  }
}
</style>
