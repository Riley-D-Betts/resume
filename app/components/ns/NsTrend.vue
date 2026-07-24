<script setup lang="ts">
import type { TrendPoint } from '~/data/resume'

const props = defineProps<{ title: string; unit: string; points: TrendPoint[] }>()

const W = 300
const H = 116
const pad = { l: 10, r: 10, t: 12, b: 22 }

const maxV = computed(() => Math.max(...props.points.map((p) => p.value)))

const coords = computed(() =>
  props.points.map((p, i) => {
    const x = pad.l + (i / (props.points.length - 1)) * (W - pad.l - pad.r)
    const y = H - pad.b - (p.value / maxV.value) * (H - pad.t - pad.b)
    return { x, y, p }
  }),
)

const linePath = computed(() => coords.value.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '))
const areaPath = computed(() => {
  const c = coords.value
  if (!c.length) return ''
  return `${linePath.value} L${c[c.length - 1]!.x.toFixed(1)},${H - pad.b} L${c[0]!.x.toFixed(1)},${H - pad.b} Z`
})

const active = ref(props.points.length - 1)
</script>

<template>
  <div class="ns-trend">
    <svg viewBox="0 0 300 116" width="100%" height="116" role="img" :aria-label="title">
      <defs>
        <linearGradient id="ns-trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2f6cab" stop-opacity="0.28" />
          <stop offset="1" stop-color="#2f6cab" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <path :d="areaPath" fill="url(#ns-trend-fill)" />
      <path :d="linePath" fill="none" stroke="#2f6cab" stroke-width="2" stroke-linejoin="round" />
      <g v-for="(c, i) in coords" :key="i">
        <text :x="c.x" :y="H - 7" font-size="9" fill="#7d8b99" text-anchor="middle">{{ c.p.label }}</text>
        <circle
          :cx="c.x"
          :cy="c.y"
          :r="active === i ? 5 : 3"
          :fill="active === i ? '#2f6cab' : '#fff'"
          stroke="#2f6cab"
          stroke-width="2"
          style="cursor: pointer"
          @mouseenter="active = i"
          @click="active = i"
        />
      </g>
    </svg>
    <div class="ns-trend__caption">
      <span>{{ title }}</span>
      <span>{{ points[0]?.label }} – {{ points[points.length - 1]?.label }}</span>
    </div>
    <div class="ns-trend__note">
      <b>{{ points[active]?.label }}</b> · tier {{ points[active]?.value }}/{{ maxV }} — {{ points[active]?.note }}
    </div>
  </div>
</template>
