<script setup lang="ts">
import type { TrendPoint } from '~/data/resume'

const props = defineProps<{ title: string; unit: string; points: TrendPoint[] }>()

// The viewBox is drawn at roughly the width the portlet renders it, so
// the SVG scales ~1:1 on desktop. The axis labels live OUTSIDE the SVG
// as an HTML row, so they keep their font size at every viewport width
// instead of shrinking with the plot on mobile.
const W = 620
const H = 140
const pad = { l: 14, r: 14, t: 14, b: 12 }
const plotBottom = H - pad.b
const plotRight = W - pad.r
const third = pad.t + (plotBottom - pad.t) / 3
const twoThirds = pad.t + ((plotBottom - pad.t) * 2) / 3

const maxV = computed(() => Math.max(...props.points.map((p) => p.value)))

const coords = computed(() =>
  props.points.map((p, i) => {
    const x = pad.l + (i / (props.points.length - 1)) * (W - pad.l - pad.r)
    const y = plotBottom - (p.value / maxV.value) * (plotBottom - pad.t - 8)
    return { x, y, p }
  }),
)

const linePath = computed(() =>
  coords.value.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '),
)
const areaPath = computed(() => {
  const c = coords.value
  if (!c.length) return ''
  return `${linePath.value} L${c[c.length - 1]!.x.toFixed(1)},${plotBottom} L${c[0]!.x.toFixed(1)},${plotBottom} Z`
})

const active = ref(props.points.length - 1)
</script>

<template>
  <div class="ns-trend">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      width="100%"
      :style="`height: auto; aspect-ratio: ${W} / ${H}; display: block`"
      role="img"
      :aria-label="title"
    >
      <!-- plot frame + gridlines, like Bettsuite's trend graph -->
      <rect :x="pad.l" :y="pad.t" :width="plotRight - pad.l" :height="plotBottom - pad.t" fill="none" stroke="#dfe4eb" stroke-width="1" />
      <line :x1="pad.l" :y1="third" :x2="plotRight" :y2="third" stroke="#eff1f5" stroke-width="1" />
      <line :x1="pad.l" :y1="twoThirds" :x2="plotRight" :y2="twoThirds" stroke="#eff1f5" stroke-width="1" />
      <path :d="areaPath" fill="#607799" fill-opacity="0.12" />
      <path :d="linePath" fill="none" stroke="#607799" stroke-width="2" stroke-linejoin="round" />
      <g v-for="(c, i) in coords" :key="i">
        <circle
          :cx="c.x"
          :cy="c.y"
          :r="active === i ? 6 : 4"
          :fill="active === i ? '#607799' : '#fff'"
          stroke="#607799"
          stroke-width="2"
          style="cursor: pointer"
          @mouseenter="active = i"
          @click="active = i"
        />
      </g>
    </svg>
    <!-- x-axis labels as HTML so they stay readable at every width; the
         points are evenly spaced, so space-between mirrors their x's -->
    <div class="ns-trend__axis">
      <button
        v-for="(c, i) in coords"
        :key="i"
        type="button"
        class="ns-trend__year"
        :class="{ 'ns-trend__year--on': active === i }"
        @click="active = i"
        @mouseenter="active = i"
      >
        {{ c.p.label }}
      </button>
    </div>
    <div class="ns-trend__caption">
      <span>{{ title }}</span>
      <span>{{ points[0]?.label }} – {{ points[points.length - 1]?.label }}</span>
    </div>
    <div class="ns-trend__note">
      <b>{{ points[active]?.label }}</b> · tier {{ points[active]?.value }}/{{ maxV }} — {{ points[active]?.note }}
    </div>
  </div>
</template>
