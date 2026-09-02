<script setup lang="ts">
export interface ColumnBin {
  label: string
  n: number
  /** tooltip override */
  title?: string
}

/**
 * Ordered buckets (histograms, nav-phase medians): inline SVG columns with
 * 2 px gaps and 4 px rounded data-ends, one hue, per-bar tooltip, TABLE twin.
 */
const props = withDefaults(
  defineProps<{
    bins: ColumnBin[]
    yFormat?: (v: number) => string
    height?: number
    ariaLabel?: string
    tableToggle?: boolean
    colorVar?: string
    keyLabel?: string
    valueLabel?: string
    testid?: string
  }>(),
  {
    yFormat: undefined,
    height: 160,
    ariaLabel: 'Column chart',
    tableToggle: true,
    colorVar: '--series-1',
    keyLabel: 'BIN',
    valueLabel: 'N',
    testid: 'column-chart',
  },
)

const fmt = useOpsFormat()
const M = { top: 10, right: 8, bottom: 22, left: 44 }
const GAP = 2
const R = 4

const wrap = ref<HTMLElement | null>(null)
const width = ref(600)
let ro: ResizeObserver | null = null
onMounted(() => {
  const el = wrap.value
  if (!el) return
  width.value = Math.max(160, el.clientWidth || 600)
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w) width.value = Math.max(160, Math.floor(w))
    })
    ro.observe(el)
  }
})
onBeforeUnmount(() => ro?.disconnect())

const plot = computed(() => ({
  left: M.left,
  top: M.top,
  right: width.value - M.right,
  bottom: props.height - M.bottom,
  w: Math.max(10, width.value - M.left - M.right),
  h: Math.max(10, props.height - M.top - M.bottom),
}))

function niceStep(raw: number): number {
  if (raw <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return m * mag
  return 10 * mag
}

const yMaxRaw = computed(() => Math.max(0, ...props.bins.map(b => b.n)))
const step = computed(() => niceStep(yMaxRaw.value / 4))
const yMax = computed(() => Math.max(step.value, Math.ceil(yMaxRaw.value / step.value) * step.value))
const ticks = computed(() => {
  const out: number[] = []
  for (let v = 0; v <= yMax.value + 1e-9; v += step.value) out.push(Number(v.toFixed(6)))
  return out
})

function fy(v: number): string {
  return props.yFormat ? props.yFormat(v) : fmt.num(v)
}

const slot = computed(() => (props.bins.length ? plot.value.w / props.bins.length : plot.value.w))
const barW = computed(() => Math.max(1, slot.value - GAP))

const bars = computed(() =>
  props.bins.map((b, i) => {
    const x = plot.value.left + i * slot.value + GAP / 2
    const h = yMax.value > 0 ? (Math.max(0, b.n) / yMax.value) * plot.value.h : 0
    const y = plot.value.bottom - h
    const w = barW.value
    const r = Math.min(R, w / 2, h)
    // rounded top corners only (the data end), flat base
    const d =
      h <= 0
        ? ''
        : `M${x},${plot.value.bottom} V${y + r} a${r},${r} 0 0 1 ${r},-${r} H${x + w - r} a${r},${r} 0 0 1 ${r},${r} V${plot.value.bottom} Z`
    return { bin: b, i, x, y, w, h, d }
  }),
)

const xTicks = computed(() => {
  const n = props.bins.length
  const maxLabels = Math.max(2, Math.floor(plot.value.w / 48))
  const every = Math.max(1, Math.ceil(n / maxLabels))
  return bars.value.filter(b => b.i % every === 0)
})

const hover = ref<number | null>(null)
const tipStyle = computed(() => {
  const b = hover.value === null ? null : bars.value[hover.value]
  if (!b) return {}
  const cx = b.x + b.w / 2
  const flip = cx > width.value * 0.6
  return flip ? { right: `${width.value - cx + 8}px`, top: `${M.top}px` } : { left: `${cx + 8}px`, top: `${M.top}px` }
})

const tableColumns = computed(() => [
  { key: 'label', label: props.keyLabel },
  { key: 'n', label: props.valueLabel, align: 'right' as const, format: (v: unknown) => (typeof v === 'number' ? fy(v) : '—') },
])
const tableRows = computed(() => props.bins.map(b => ({ label: b.label, n: b.n })))
</script>

<template>
  <TableToggle :disabled="!tableToggle || bins.length <= 3">
    <div ref="wrap" class="cc" :data-testid="testid" @pointerleave="hover = null">
      <div v-if="bins.length === 0" class="cc__empty label">NO DATA</div>
      <svg v-else class="cc__svg" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="ariaLabel">
        <g v-for="t in ticks" :key="t">
          <line :x1="plot.left" :x2="plot.right" :y1="plot.bottom - (t / yMax) * plot.h" :y2="plot.bottom - (t / yMax) * plot.h" class="cc__grid" />
          <text :x="plot.left - 6" :y="plot.bottom - (t / yMax) * plot.h + 3" class="cc__tick" text-anchor="end">{{ fy(t) }}</text>
        </g>
        <text v-for="b in xTicks" :key="`x-${b.i}`" :x="b.x + b.w / 2" :y="height - 6" class="cc__tick" text-anchor="middle">{{ b.bin.label }}</text>
        <g v-for="b in bars" :key="b.i" @pointerenter="hover = b.i" @pointermove="hover = b.i">
          <path v-if="b.d" :d="b.d" class="cc__bar" :class="{ 'cc__bar--on': hover === b.i }" :style="{ fill: `var(${colorVar})` }" />
          <!-- hit target: the whole column -->
          <rect :x="b.x" :y="plot.top" :width="b.w" :height="plot.h" class="cc__hit" />
        </g>
      </svg>
      <div v-if="hover !== null && bars[hover]" class="cc__tip" data-testid="chart-tooltip" :style="tipStyle">
        <span class="cc__tip-k">{{ bars[hover]!.bin.title ?? bars[hover]!.bin.label }}</span>
        <span class="cc__tip-v">{{ fy(bars[hover]!.bin.n) }}</span>
      </div>
    </div>
    <template #table>
      <DataTable :columns="tableColumns" :rows="tableRows" :testid="`${testid}-table`" row-key="label" dense :max-height="`${height + 80}px`" />
    </template>
  </TableToggle>
</template>

<style scoped>
.cc {
  position: relative;
  min-width: 0;
}

.cc__empty {
  padding: var(--space-3) 0;
  color: var(--text-faint);
}

.cc__svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  font-family: var(--font-mono);
}

.cc__grid {
  stroke: var(--grid);
  stroke-width: 1;
  shape-rendering: crispEdges;
}

.cc__tick {
  font-size: 11px;
  fill: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.cc__bar {
  transition: filter 0.15s;
}

.cc__bar--on {
  filter: brightness(1.25);
}

.cc__hit {
  fill: transparent;
  cursor: crosshair;
}

.cc__tip {
  position: absolute;
  z-index: 2;
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

.cc__tip-k {
  color: var(--text-dim);
}

.cc__tip-v {
  color: var(--text);
}
</style>
