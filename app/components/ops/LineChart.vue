<script setup lang="ts">
export interface LinePoint {
  x: string
  y: number | null
}

export interface LineSeries {
  key: string
  label: string
  points: LinePoint[]
  /** Fixed palette slot 1..6 (the slot follows the entity, never the rank). */
  colorIndex?: number
}

/**
 * Change-over-time line chart (inline SVG, one y-axis). ≤ 4 lines including
 * the dashed previous-period series (`prev`, drawn at `--series-prev-opacity`
 * in the colour of the matching `key`; COMPARE pages pass only the primary's
 * prev). Hover = nearest-x crosshair + tooltip listing every series; legend
 * when ≥ 2 lines; direct labels at the line ends; TABLE twin via TableToggle.
 */
const props = withDefaults(
  defineProps<{
    series: LineSeries[]
    prev?: LineSeries[]
    /** Palette slot per series key (overrides `series[].colorIndex`). */
    colorIndex?: Record<string, number>
    yFormat?: (v: number) => string
    xFormat?: (x: string) => string
    height?: number
    ariaLabel?: string
    tableToggle?: boolean
    /** Header for the x column of the table twin. */
    xLabel?: string
    testid?: string
  }>(),
  {
    prev: () => [],
    colorIndex: undefined,
    yFormat: undefined,
    xFormat: undefined,
    height: 220,
    ariaLabel: 'Line chart',
    tableToggle: true,
    xLabel: 'DAY',
    testid: 'line-chart',
  },
)

const fmt = useOpsFormat()

const MAX_LINES = 4
const M = { top: 12, right: 12, bottom: 22, left: 44 }

if (import.meta.dev && props.series.length + props.prev.length > MAX_LINES) {
  // Design rule: ≤ 4 series direct-labelled; more than that is unreadable.
  console.warn(`[LineChart] ${props.series.length + props.prev.length} lines > ${MAX_LINES}; only the first ${MAX_LINES} are drawn`)
}

interface Line {
  key: string
  label: string
  slot: number
  prev: boolean
  /** y per x-slot index (null = gap). */
  ys: (number | null)[]
  /** own x labels per slot (prev series carry their own period's days). */
  xs: (string | null)[]
}

const domain = computed<string[]>(() => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of props.series) for (const p of s.points) if (!seen.has(p.x)) { seen.add(p.x); out.push(p.x) }
  const prevLen = Math.max(0, ...props.prev.map(s => s.points.length))
  for (let i = out.length; i < prevLen; i++) out.push('')
  return out
})

const lines = computed<Line[]>(() => {
  const idx = new Map(domain.value.map((x, i) => [x, i] as const))
  const out: Line[] = []
  const slotOf = (s: LineSeries, i: number) => props.colorIndex?.[s.key] ?? s.colorIndex ?? Math.min(6, i + 1)
  const slots = new Map<string, number>()
  props.series.forEach((s, i) => {
    const slot = slotOf(s, i)
    slots.set(s.key, slot)
    const ys: (number | null)[] = domain.value.map(() => null)
    const xs: (string | null)[] = domain.value.map(x => x || null)
    for (const p of s.points) {
      const j = idx.get(p.x)
      if (j !== undefined) ys[j] = p.y
    }
    out.push({ key: s.key, label: s.label, slot, prev: false, ys, xs })
  })
  props.prev.forEach((s, i) => {
    const slot = slots.get(s.key) ?? slotOf(s, props.series.length + i)
    const ys: (number | null)[] = domain.value.map(() => null)
    const xs: (string | null)[] = domain.value.map(() => null)
    s.points.forEach((p, j) => {
      if (j < ys.length) {
        ys[j] = p.y
        xs[j] = p.x
      }
    })
    out.push({ key: `${s.key}:prev`, label: `${s.label} · PREV`, slot, prev: true, ys, xs })
  })
  return out.slice(0, MAX_LINES)
})

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

/** Space for the direct labels at the line ends. */
const labelW = computed(() => {
  const longest = Math.max(0, ...lines.value.map(l => l.label.length))
  return lines.value.length > 0 ? Math.min(140, 10 + longest * 6.6) : 0
})

const plot = computed(() => {
  const left = M.left
  const right = width.value - M.right - labelW.value
  const top = M.top
  const bottom = props.height - M.bottom
  return { left, right, top, bottom, w: Math.max(10, right - left), h: Math.max(10, bottom - top) }
})

function niceStep(raw: number): number {
  if (raw <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return m * mag
  return 10 * mag
}

const yMaxRaw = computed(() => Math.max(0, ...lines.value.flatMap(l => l.ys.filter((y): y is number => y !== null))))
const step = computed(() => niceStep(yMaxRaw.value / 4))
const yMax = computed(() => Math.max(step.value, Math.ceil(yMaxRaw.value / step.value) * step.value))
const ticks = computed(() => {
  const out: number[] = []
  for (let v = 0; v <= yMax.value + 1e-9; v += step.value) out.push(Number(v.toFixed(6)))
  return out
})

function xAt(i: number): number {
  const n = domain.value.length
  if (n <= 1) return plot.value.left + plot.value.w / 2
  return plot.value.left + (i * plot.value.w) / (n - 1)
}

function yAt(v: number): number {
  return plot.value.bottom - (v / yMax.value) * plot.value.h
}

function pathOf(l: Line): string {
  let d = ''
  let pen = false
  l.ys.forEach((y, i) => {
    if (y === null) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(y).toFixed(1)} `
    pen = true
  })
  return d.trim()
}

const paths = computed(() => lines.value.map(l => ({ line: l, d: pathOf(l) })))

/** Direct labels at the last non-null point, nudged apart vertically. */
const endLabels = computed(() => {
  const raw = lines.value
    .map(l => {
      let last = -1
      l.ys.forEach((y, i) => {
        if (y !== null) last = i
      })
      return last < 0 ? null : { line: l, x: xAt(last) + 6, y: yAt(l.ys[last] as number) }
    })
    .filter((v): v is { line: Line; x: number; y: number } => v !== null)
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < raw.length; i++) {
    const prev = raw[i - 1]!
    const cur = raw[i]!
    if (cur.y - prev.y < 12) cur.y = prev.y + 12
  }
  return raw
})

const xTicks = computed(() => {
  const n = domain.value.length
  if (n === 0) return []
  const maxLabels = Math.max(2, Math.floor(plot.value.w / 56))
  const every = Math.max(1, Math.ceil(n / maxLabels))
  const out: { i: number; label: string }[] = []
  for (let i = 0; i < n; i += every) {
    const x = domain.value[i] ?? ''
    if (x) out.push({ i, label: props.xFormat ? props.xFormat(x) : fmt.dayLabel(x) })
  }
  return out
})

function fy(v: number): string {
  return props.yFormat ? props.yFormat(v) : fmt.num(v)
}

// -- hover ------------------------------------------------------------
const hover = ref<number | null>(null)

function onMove(e: PointerEvent) {
  const el = wrap.value
  const n = domain.value.length
  if (!el || n === 0) return
  const px = e.clientX - el.getBoundingClientRect().left
  const i = n === 1 ? 0 : Math.round(((px - plot.value.left) / plot.value.w) * (n - 1))
  hover.value = Math.max(0, Math.min(n - 1, i))
}

const hoverRows = computed(() => {
  const i = hover.value
  if (i === null) return []
  return lines.value
    .map(l => ({ line: l, y: l.ys[i] ?? null, x: l.xs[i] ?? null }))
    .filter(r => r.y !== null)
})

const tipStyle = computed(() => {
  if (hover.value === null) return {}
  const x = xAt(hover.value)
  const flip = x > width.value * 0.6
  return flip ? { right: `${width.value - x + 10}px`, top: `${M.top}px` } : { left: `${x + 10}px`, top: `${M.top}px` }
})

// -- table twin -------------------------------------------------------
const tableColumns = computed(() => [
  { key: 'x', label: props.xLabel },
  ...lines.value.map(l => ({ key: l.key, label: l.label.toUpperCase(), align: 'right' as const, format: (v: unknown) => (typeof v === 'number' ? fy(v) : '—') })),
])
const tableRows = computed(() =>
  domain.value.map((x, i) => {
    const row: Record<string, unknown> = { x: x || lines.value.find(l => l.prev)?.xs[i] || `#${i + 1}` }
    for (const l of lines.value) row[l.key] = l.ys[i]
    return row
  }),
)

const hasData = computed(() => lines.value.some(l => l.ys.some(y => y !== null)))
</script>

<template>
  <TableToggle :disabled="!tableToggle || domain.length <= 3">
    <div ref="wrap" class="lc" :data-testid="testid" @pointerleave="hover = null">
      <div v-if="!hasData" class="lc__empty label">NO DATA</div>
      <svg v-else class="lc__svg" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="ariaLabel" @pointermove="onMove">
        <!-- gridlines + y axis labels -->
        <g v-for="t in ticks" :key="t">
          <line :x1="plot.left" :x2="plot.right" :y1="yAt(t)" :y2="yAt(t)" class="lc__grid" />
          <text :x="plot.left - 6" :y="yAt(t) + 3" class="lc__ytick" text-anchor="end">{{ fy(t) }}</text>
        </g>
        <!-- x axis labels -->
        <text v-for="t in xTicks" :key="t.i" :x="xAt(t.i)" :y="height - 6" class="lc__xtick" text-anchor="middle">{{ t.label }}</text>
        <!-- lines -->
        <path
          v-for="p in paths"
          :key="p.line.key"
          :d="p.d"
          class="lc__line"
          :class="{ 'lc__line--prev': p.line.prev }"
          :style="{ stroke: `var(--series-${p.line.slot})` }"
        />
        <!-- direct labels -->
        <text
          v-for="l in endLabels"
          :key="`lbl-${l.line.key}`"
          :x="l.x"
          :y="l.y + 3"
          class="lc__end"
        >
          {{ l.line.label }}
        </text>
        <!-- hover layer -->
        <g v-if="hover !== null">
          <line :x1="xAt(hover)" :x2="xAt(hover)" :y1="plot.top" :y2="plot.bottom" class="lc__cross" />
          <circle
            v-for="r in hoverRows"
            :key="`m-${r.line.key}`"
            :cx="xAt(hover)"
            :cy="yAt(r.y as number)"
            r="4"
            class="lc__marker"
            :style="{ fill: `var(--series-${r.line.slot})`, opacity: r.line.prev ? 'var(--series-prev-opacity)' : 1 }"
          />
        </g>
        <rect :x="plot.left" :y="plot.top" :width="plot.w" :height="plot.h" class="lc__hit" />
      </svg>

      <div v-if="hover !== null && hoverRows.length" class="lc__tip" data-testid="chart-tooltip" :style="tipStyle">
        <div class="lc__tip-x">{{ domain[hover] || hoverRows[0]?.x || '' }}</div>
        <div v-for="r in hoverRows" :key="r.line.key" class="lc__tip-row">
          <span class="lc__swatch" :class="{ 'lc__swatch--prev': r.line.prev }" :style="{ background: `var(--series-${r.line.slot})` }" aria-hidden="true" />
          <span class="lc__tip-k">{{ r.line.label }}<template v-if="r.line.prev && r.x"> {{ r.x }}</template></span>
          <span class="lc__tip-v">{{ fy(r.y as number) }}</span>
        </div>
      </div>

      <div v-if="lines.length >= 2" class="lc__legend label">
        <span v-for="l in lines" :key="`lg-${l.key}`" class="lc__legend-item">
          <span class="lc__swatch" :class="{ 'lc__swatch--prev': l.prev }" :style="{ background: `var(--series-${l.slot})` }" aria-hidden="true" />
          {{ l.label }}
        </span>
      </div>
    </div>
    <template #table>
      <DataTable :columns="tableColumns" :rows="tableRows" :testid="`${testid}-table`" row-key="x" dense :max-height="`${height + 80}px`" />
    </template>
  </TableToggle>
</template>

<style scoped>
.lc {
  position: relative;
  min-width: 0;
}

.lc__empty {
  padding: var(--space-3) 0;
  color: var(--text-faint);
}

.lc__svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  font-family: var(--font-mono);
  touch-action: none;
}

.lc__grid {
  stroke: var(--grid);
  stroke-width: 1;
  shape-rendering: crispEdges;
}

.lc__ytick,
.lc__xtick,
.lc__end {
  font-size: 11px;
  fill: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.lc__end {
  fill: var(--text);
}

.lc__line {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.lc__line--prev {
  stroke-dasharray: 5 4;
  opacity: var(--series-prev-opacity);
}

.lc__cross {
  stroke: var(--hairline-lit);
  stroke-width: 1;
  pointer-events: none;
}

.lc__marker {
  stroke: var(--bg-1);
  stroke-width: 1.5;
  pointer-events: none;
}

.lc__hit {
  fill: transparent;
  cursor: crosshair;
}

.lc__tip {
  position: absolute;
  z-index: 2;
  padding: var(--space-1) var(--space-2);
  background: var(--bg-2);
  border: 1px solid var(--hairline-lit);
  font-size: var(--fs-micro);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}

.lc__tip-x {
  color: var(--text-dim);
  letter-spacing: 0.08em;
  margin-bottom: 2px;
}

.lc__tip-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.lc__tip-k {
  color: var(--text-dim);
  flex: 1;
}

.lc__tip-v {
  color: var(--text);
}

.lc__swatch {
  display: inline-block;
  width: 10px;
  height: 3px;
  flex: none;
}

.lc__swatch--prev {
  opacity: var(--series-prev-opacity);
}

.lc__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  margin-top: var(--space-1);
  color: var(--text-dim);
}

.lc__legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
</style>
