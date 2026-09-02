<script setup lang="ts">
import type { HeatCell } from '#shared/analytics/ops'

/**
 * Intensity grid (day × hour by default). One teal hue in six quantile
 * steps (`--seq-1..6`; zero = surface), 2 px gaps, per-cell tooltip, TABLE
 * twin. Pass `heat` (the API's `{ dow, hour, n }[]`) or explicit
 * `rows` / `cols` / `cells`.
 */
const props = withDefaults(
  defineProps<{
    heat?: HeatCell[]
    rows?: string[]
    cols?: string[]
    /** cells[rowIndex][colIndex] */
    cells?: number[][]
    ariaLabel?: string
    tableToggle?: boolean
    valueFormat?: (v: number) => string
    /** Row label column width in px. */
    labelWidth?: number
    testid?: string
  }>(),
  {
    heat: undefined,
    rows: undefined,
    cols: undefined,
    cells: undefined,
    ariaLabel: 'Heatmap',
    tableToggle: true,
    valueFormat: undefined,
    labelWidth: 34,
    testid: 'heatmap',
  },
)

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))
const GAP = 2

const fmt = useOpsFormat()

const rowLabels = computed<string[]>(() => props.rows ?? (props.heat ? DOW : []))
const colLabels = computed<string[]>(() => props.cols ?? (props.heat ? HOURS : []))

const grid = computed<number[][]>(() => {
  if (props.cells) return props.cells
  const out = rowLabels.value.map(() => colLabels.value.map(() => 0))
  for (const c of props.heat ?? []) {
    const row = out[c.dow]
    if (row && c.hour >= 0 && c.hour < row.length) row[c.hour] = (row[c.hour] ?? 0) + c.n
  }
  return out
})

/** Quantile thresholds over the non-zero values → 6 steps. */
const thresholds = computed<number[]>(() => {
  const vals = grid.value.flat().filter(v => v > 0).sort((a, b) => a - b)
  if (vals.length === 0) return []
  return [1, 2, 3, 4, 5].map(k => vals[Math.min(vals.length - 1, Math.floor((vals.length * k) / 6))] ?? 0)
})

function level(v: number): number {
  if (v <= 0) return 0
  let lvl = 1
  for (const t of thresholds.value) if (v > t) lvl++
  return Math.min(6, lvl)
}

const maxV = computed(() => Math.max(0, ...grid.value.flat()))
const total = computed(() => grid.value.flat().reduce((s, v) => s + v, 0))

// -- geometry ---------------------------------------------------------
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
      // Next frame: a same-frame write re-sizes the SVG inside the observer's own delivery and trips "ResizeObserver loop completed".
      if (w) requestAnimationFrame(() => (width.value = Math.max(160, Math.floor(w))))
    })
    ro.observe(el)
  }
})
onBeforeUnmount(() => ro?.disconnect())

const cellW = computed(() => {
  const n = Math.max(1, colLabels.value.length)
  return Math.max(4, (width.value - props.labelWidth) / n - GAP)
})
const cellH = computed(() => Math.max(8, Math.min(22, cellW.value)))
const height = computed(() => rowLabels.value.length * (cellH.value + GAP) + 18)

function cx(j: number): number {
  return props.labelWidth + j * (cellW.value + GAP)
}
function cy(i: number): number {
  return i * (cellH.value + GAP)
}

const colTicks = computed(() => {
  const n = colLabels.value.length
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((width.value - props.labelWidth) / 30))))
  return colLabels.value.map((label, j) => ({ label, j })).filter(t => t.j % every === 0)
})

function fv(v: number): string {
  return props.valueFormat ? props.valueFormat(v) : fmt.num(v)
}

// -- hover ------------------------------------------------------------
const hover = ref<{ i: number; j: number } | null>(null)
const hoverText = computed(() => {
  const h = hover.value
  if (!h) return ''
  const v = grid.value[h.i]?.[h.j] ?? 0
  const col = colLabels.value[h.j] ?? ''
  const suffix = props.heat && !props.cols ? ':00' : ''
  return `${rowLabels.value[h.i] ?? ''} ${col}${suffix} · ${fv(v)}${total.value > 0 ? ` · ${fmt.share(v, total.value, 1)}` : ''}`
})
const tipStyle = computed(() => {
  const h = hover.value
  if (!h) return {}
  const x = cx(h.j) + cellW.value / 2
  const y = cy(h.i)
  const flip = x > width.value * 0.6
  return flip ? { right: `${width.value - x + 8}px`, top: `${y - 26}px` } : { left: `${x + 8}px`, top: `${y - 26}px` }
})

// -- table twin -------------------------------------------------------
const tableColumns = computed(() => [
  { key: '_row', label: '' },
  ...colLabels.value.map((c, j) => ({ key: `c${j}`, label: c, align: 'right' as const, numeric: true })),
])
const tableRows = computed(() =>
  rowLabels.value.map((r, i) => {
    const row: Record<string, unknown> = { _row: r }
    colLabels.value.forEach((_, j) => (row[`c${j}`] = grid.value[i]?.[j] ?? 0))
    return row
  }),
)
</script>

<template>
  <TableToggle :disabled="!tableToggle">
    <div ref="wrap" class="hm" :data-testid="testid" @pointerleave="hover = null">
      <div v-if="rowLabels.length === 0 || maxV === 0" class="hm__empty label">NO DATA</div>
      <svg v-else class="hm__svg" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="ariaLabel">
        <text v-for="(r, i) in rowLabels" :key="`r-${r}`" :x="labelWidth - 6" :y="cy(i) + cellH / 2 + 3.5" class="hm__label" text-anchor="end">{{ r }}</text>
        <template v-for="(r, i) in rowLabels" :key="`row-${r}`">
          <rect
            v-for="(c, j) in colLabels"
            :key="`c-${i}-${j}`"
            :x="cx(j)"
            :y="cy(i)"
            :width="cellW"
            :height="cellH"
            class="hm__cell"
            :class="[`hm__cell--l${level(grid[i]?.[j] ?? 0)}`, { 'hm__cell--on': hover && hover.i === i && hover.j === j }]"
            @pointerenter="hover = { i, j }"
            @pointermove="hover = { i, j }"
          />
        </template>
        <text v-for="t in colTicks" :key="`ct-${t.j}`" :x="cx(t.j) + cellW / 2" :y="height - 4" class="hm__label" text-anchor="middle">{{ t.label }}</text>
      </svg>
      <div v-if="hover" class="hm__tip" data-testid="chart-tooltip" :style="tipStyle">{{ hoverText }}</div>
      <div v-if="maxV > 0" class="hm__legend label">
        <span>LOW</span>
        <span v-for="l in 6" :key="l" class="hm__swatch" :class="`hm__cell--l${l}`" aria-hidden="true" />
        <span>HIGH · MAX {{ fv(maxV) }}</span>
      </div>
    </div>
    <template #table>
      <DataTable :columns="tableColumns" :rows="tableRows" :testid="`${testid}-table`" row-key="_row" dense :sortable="false" />
    </template>
  </TableToggle>
</template>

<style scoped>
.hm {
  position: relative;
  min-width: 0;
}

.hm__empty {
  padding: var(--space-3) 0;
  color: var(--text-faint);
}

.hm__svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  font-family: var(--font-mono);
}

.hm__label {
  font-size: 11px;
  fill: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.hm__cell {
  cursor: crosshair;
  shape-rendering: crispEdges;
}

.hm__cell--l0 { fill: var(--bg-2); }
.hm__cell--l1 { fill: var(--seq-1); }
.hm__cell--l2 { fill: var(--seq-2); }
.hm__cell--l3 { fill: var(--seq-3); }
.hm__cell--l4 { fill: var(--seq-4); }
.hm__cell--l5 { fill: var(--seq-5); }
.hm__cell--l6 { fill: var(--seq-6); }

.hm__cell--on {
  stroke: var(--text);
  stroke-width: 1;
}

.hm__tip {
  position: absolute;
  z-index: 2;
  padding: 2px var(--space-2);
  background: var(--bg-2);
  border: 1px solid var(--hairline-lit);
  color: var(--text);
  font-size: var(--fs-micro);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}

.hm__legend {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: var(--space-2);
  color: var(--text-faint);
}

.hm__legend > span:first-child {
  margin-right: var(--space-1);
}

.hm__legend > span:last-child {
  margin-left: var(--space-1);
}

.hm__swatch {
  display: inline-block;
  width: 14px;
  height: 8px;
}

.hm__swatch.hm__cell--l1 { background: var(--seq-1); }
.hm__swatch.hm__cell--l2 { background: var(--seq-2); }
.hm__swatch.hm__cell--l3 { background: var(--seq-3); }
.hm__swatch.hm__cell--l4 { background: var(--seq-4); }
.hm__swatch.hm__cell--l5 { background: var(--seq-5); }
.hm__swatch.hm__cell--l6 { background: var(--seq-6); }
</style>
