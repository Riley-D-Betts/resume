<script setup lang="ts">
const props = defineProps<{
  label: string
  value: string
  percent: number
  min: number
  max: number
  target: string
}>()

// upper-semicircle gauge: M20,100 A80,80 0 0 1 180,100  (length = π·80)
const ARC = Math.PI * 80

const fraction = computed(() => {
  const f = (props.percent - props.min) / (props.max - props.min)
  return Math.max(0, Math.min(1, f))
})

// animate the fill in after mount
const shown = ref(false)
onMounted(() => requestAnimationFrame(() => (shown.value = true)))

const dash = computed(() => `${(shown.value ? fraction.value : 0) * ARC} ${ARC}`)

// needle endpoint (θ measured from +x axis, 180°→0° across the top)
const needle = computed(() => {
  const theta = Math.PI * (1 - (shown.value ? fraction.value : 0))
  return { x: 100 + 66 * Math.cos(theta), y: 100 - 66 * Math.sin(theta) }
})
</script>

<template>
  <div class="ns-meter">
    <!-- capped so the dial stays dial-sized in a wide column -->
    <svg
      viewBox="0 0 200 118"
      width="100%"
      style="height: auto; aspect-ratio: 200 / 118; max-width: 280px; display: block; margin: 0 auto"
      role="img"
      :aria-label="`${label}: ${value}`"
    >
      <path d="M20,100 A80,80 0 0 1 180,100" fill="none" stroke="#dfe4eb" stroke-width="16" />
      <path
        d="M20,100 A80,80 0 0 1 180,100"
        fill="none"
        stroke="#607799"
        stroke-width="16"
        :stroke-dasharray="dash"
        style="transition: stroke-dasharray 1.1s cubic-bezier(0.22, 1, 0.36, 1)"
      />
      <line
        x1="100"
        y1="100"
        :x2="needle.x"
        :y2="needle.y"
        stroke="#4d5f7a"
        stroke-width="3"
        stroke-linecap="round"
        style="transition: all 1.1s cubic-bezier(0.22, 1, 0.36, 1)"
      />
      <circle cx="100" cy="100" r="6" fill="#4d5f7a" />
      <text x="20" y="114" font-size="9" fill="#777777">{{ min }}</text>
      <text x="180" y="114" font-size="9" fill="#777777" text-anchor="end">{{ max }}</text>
    </svg>
    <div class="ns-meter__val">{{ value }}</div>
    <div class="ns-meter__label">{{ label }}</div>
    <div class="ns-meter__target">{{ target }}</div>
  </div>
</template>
