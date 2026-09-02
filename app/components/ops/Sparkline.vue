<script setup lang="ts">
/**
 * Compact one-series line (the overview's SESSIONS // LAST 30 DAYS panel).
 * Stroke `--series-1`, area `--series-1-wash`; hover shows the nearest day.
 */
const props = withDefaults(
  defineProps<{
    data: { day: string; n: number }[]
    ariaLabel?: string
    /** Pixel height of the plot. */
    height?: number
  }>(),
  { ariaLabel: 'Sessions per day, last 30 days', height: 56 },
)

const W = 300
const H = 56
const PAD = 3

const maxN = computed(() => (props.data.length ? Math.max(...props.data.map(d => d.n)) : 0))
const minN = computed(() => (props.data.length ? Math.min(...props.data.map(d => d.n)) : 0))

const pts = computed<[number, number][]>(() => {
  const scale = Math.max(1, maxN.value)
  return props.data.map((d, i) => {
    const x = props.data.length > 1 ? PAD + (i * (W - PAD * 2)) / (props.data.length - 1) : W / 2
    const y = H - PAD - (d.n / scale) * (H - PAD * 2)
    return [Number(x.toFixed(1)), Number(y.toFixed(1))]
  })
})

const line = computed(() => pts.value.map(p => `${p[0]},${p[1]}`).join(' '))

const area = computed(() => {
  if (pts.value.length < 2) return ''
  const first = pts.value[0]!
  const last = pts.value[pts.value.length - 1]!
  const body = pts.value.map(p => `L ${p[0]} ${p[1]}`).join(' ')
  return `M ${first[0]} ${H - PAD} ${body} L ${last[0]} ${H - PAD} Z`
})

// -- hover ------------------------------------------------------------
const svgEl = ref<SVGSVGElement | null>(null)
const hover = ref<number | null>(null)

function onMove(e: PointerEvent) {
  const el = svgEl.value
  if (!el || pts.value.length === 0) return
  const r = el.getBoundingClientRect()
  if (r.width === 0) return
  const x = ((e.clientX - r.left) / r.width) * W
  let best = 0
  let bestD = Infinity
  pts.value.forEach((p, i) => {
    const d = Math.abs(p[0] - x)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  hover.value = best
}

const hoverPt = computed(() => (hover.value === null ? null : pts.value[hover.value] ?? null))
const hoverDatum = computed(() => (hover.value === null ? null : props.data[hover.value] ?? null))
const tipStyle = computed(() => {
  const p = hoverPt.value
  if (!p) return {}
  const leftPct = (p[0] / W) * 100
  return leftPct > 60 ? { right: `${100 - leftPct}%` } : { left: `${leftPct}%` }
})
</script>

<template>
  <div class="spark" data-testid="sparkline" @pointerleave="hover = null">
    <div class="spark__plot" :style="{ height: `${height}px` }">
      <svg
        ref="svgEl"
        class="spark__svg"
        :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="none"
        role="img"
        :aria-label="ariaLabel"
        @pointermove="onMove"
      >
        <path v-if="area" :d="area" class="spark__area" />
        <polyline v-if="pts.length > 1" :points="line" class="spark__line" />
        <line
          v-if="hoverPt"
          :x1="hoverPt[0]"
          :x2="hoverPt[0]"
          :y1="0"
          :y2="H"
          class="spark__cross"
        />
      </svg>
      <span
        v-if="hoverPt"
        class="spark__dot"
        :style="{ left: `${(hoverPt[0] / W) * 100}%`, top: `${(hoverPt[1] / H) * 100}%` }"
        aria-hidden="true"
      />
      <div v-if="hoverDatum" class="spark__tip" data-testid="chart-tooltip" :style="tipStyle">
        <span class="spark__tip-k">{{ hoverDatum.day }}</span>
        <span class="spark__tip-v">{{ hoverDatum.n }}</span>
      </div>
    </div>
    <div class="spark__labels label">
      <span>MIN {{ minN }}</span>
      <span class="spark__max">MAX {{ maxN }}</span>
    </div>
  </div>
</template>

<style scoped>
.spark {
  min-width: 0;
}

.spark__plot {
  position: relative;
}

.spark__svg {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.spark__area {
  fill: var(--series-1-wash);
  stroke: none;
}

.spark__line {
  fill: none;
  stroke: var(--series-1);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  stroke-linejoin: round;
}

.spark__cross {
  stroke: var(--hairline-lit);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}

.spark__dot {
  position: absolute;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  background: var(--series-1);
  border: 1px solid var(--bg-1);
  pointer-events: none;
}

.spark__tip {
  position: absolute;
  top: 0;
  display: flex;
  gap: var(--space-2);
  padding: 2px var(--space-2);
  background: var(--bg-2);
  border: 1px solid var(--hairline-lit);
  font-size: var(--fs-micro);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}

.spark__tip-k {
  color: var(--text-dim);
}

.spark__tip-v {
  color: var(--text);
}

.spark__labels {
  display: flex;
  justify-content: space-between;
  margin-top: var(--space-1);
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.spark__max {
  color: var(--text-dim);
}
</style>
