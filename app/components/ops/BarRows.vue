<script setup lang="ts">
import { NuxtLink } from '#components'
import { copyText, rowsToCsv } from '~/utils/csv'

export interface BarRow {
  k: string
  n: number
  /** optional right-column override (defaults to n) */
  display?: string
  /** optional drill-down (overrides the `to` prop for this row) */
  to?: string
  /** optional tooltip line (overrides the `tooltip` prop for this row) */
  title?: string
}

/**
 * Magnitude-by-category bars, one hue (`--series-1` unless `colorVar`), key
 * and value in text tokens. Hover tooltip per bar; TABLE twin when
 * `tableToggle`; > 12 rows fold into "Other" when `foldOther`.
 */
const props = withDefaults(
  defineProps<{
    rows: BarRow[]
    /** CSS custom property for the fill, e.g. `--series-2`. */
    colorVar?: string
    tooltip?: (row: BarRow) => string
    to?: (row: BarRow) => string | null | undefined
    tableToggle?: boolean
    foldOther?: boolean
    /** Rows emit `select` on click (cursor + keyboard focus) even without `to`. */
    selectable?: boolean
    /** Keep only the top N rows (after folding). */
    max?: number
    keyLabel?: string
    valueLabel?: string
    empty?: string
    testid?: string
  }>(),
  {
    colorVar: '--series-1',
    tooltip: undefined,
    to: undefined,
    tableToggle: false,
    foldOther: false,
    selectable: false,
    max: undefined,
    keyLabel: 'KEY',
    valueLabel: 'N',
    empty: 'NO DATA',
    testid: 'bar-rows',
  },
)

const emit = defineEmits<{ select: [row: BarRow] }>()

const fmt = useOpsFormat()

const shown = computed<BarRow[]>(() => {
  let rows = props.rows
  if (props.foldOther && rows.length > 12) {
    const head = rows.slice(0, 12)
    const rest = rows.slice(12)
    rows = [...head, { k: 'Other', n: rest.reduce((s, r) => s + r.n, 0), display: `${fmt.num(rest.reduce((s, r) => s + r.n, 0))} · ${rest.length}` }]
  }
  if (props.max !== undefined) rows = rows.slice(0, props.max)
  return rows
})

const total = computed(() => props.rows.reduce((s, r) => s + (Number.isFinite(r.n) ? r.n : 0), 0))
const maxN = computed(() => Math.max(1, ...shown.value.map(r => r.n)))

function link(r: BarRow): string | null {
  if (r.to) return r.to
  const t = props.to?.(r)
  return t ? t : null
}

function tipText(r: BarRow): string {
  if (r.title) return r.title
  if (props.tooltip) return props.tooltip(r)
  const pct = total.value > 0 ? ` · ${fmt.share(r.n, total.value, 1)}` : ''
  return `${r.k}: ${r.display ?? fmt.num(r.n)}${pct}`
}

// -- hover tooltip ----------------------------------------------------
const tip = ref<{ text: string; x: number; y: number } | null>(null)
const wrap = ref<HTMLElement | null>(null)

function showTip(r: BarRow, e: PointerEvent) {
  const el = wrap.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  tip.value = { text: tipText(r), x: e.clientX - rect.left, y: e.clientY - rect.top }
}

const tipStyle = computed(() => {
  if (!tip.value || !wrap.value) return {}
  const w = wrap.value.clientWidth || 300
  const flip = tip.value.x > w * 0.6
  return {
    top: `${tip.value.y - 28}px`,
    ...(flip ? { right: `${w - tip.value.x + 8}px` } : { left: `${tip.value.x + 8}px` }),
  }
})

// -- table twin -------------------------------------------------------
const tableColumns = computed(() => [
  { key: 'k', label: props.keyLabel },
  { key: 'n', label: props.valueLabel, align: 'right' as const, format: (v: unknown, row: Record<string, unknown>) => (typeof row.display === 'string' ? row.display : fmt.num(v)) },
])
const tableRows = computed(() => shown.value.map(r => ({ k: r.k, n: r.n, display: r.display })))

const copied = ref(false)
async function copyCsv() {
  copied.value = await copyText(rowsToCsv([{ key: 'k', label: props.keyLabel }, { key: 'n', label: props.valueLabel }], tableRows.value))
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <TableToggle :disabled="!tableToggle || shown.length <= 3">
    <div ref="wrap" class="bars" :data-testid="testid" @pointerleave="tip = null">
      <div v-if="shown.length === 0" class="bars__empty label">{{ empty }}</div>
      <template v-for="r in shown" :key="r.k">
        <component
          :is="link(r) ? NuxtLink : 'div'"
          :to="link(r) ?? undefined"
          class="bars__row"
          :class="{ 'bars__row--link': link(r) || selectable }"
          :tabindex="!link(r) && selectable ? 0 : undefined"
          @pointermove="showTip(r, $event)"
          @pointerenter="showTip(r, $event)"
          @click="emit('select', r)"
          @keydown.enter="emit('select', r)"
        >
          <span class="bars__k" :title="r.k">{{ r.k }}</span>
          <span class="bars__track" aria-hidden="true">
            <span class="bars__fill" :style="{ width: `${Math.max(1, (r.n / maxN) * 100)}%`, background: `var(${colorVar})` }" />
          </span>
          <span class="bars__n">{{ r.display ?? fmt.num(r.n) }}</span>
        </component>
      </template>
      <div v-if="tip" class="bars__tip" data-testid="chart-tooltip" :style="tipStyle">{{ tip.text }}</div>
    </div>
    <template #table>
      <DataTable :columns="tableColumns" :rows="tableRows" :testid="`${testid}-table`" row-key="k" :copy-csv="false" dense />
      <div class="bars__actions">
        <button type="button" class="bars__copy label" @click="copyCsv">{{ copied ? 'COPIED' : 'COPY CSV' }}</button>
      </div>
    </template>
  </TableToggle>
</template>

<style scoped>
.bars {
  position: relative;
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.bars__empty {
  color: var(--text-faint);
  padding: var(--space-2) 0;
}

.bars__row {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(60px, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-data);
  color: inherit;
  text-decoration: none;
}

.bars__row--link {
  cursor: pointer;
}

.bars__row--link:hover {
  text-decoration: none;
}

.bars__row--link:hover .bars__k {
  color: var(--teal-hot);
}

.bars__k {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text);
}

.bars__track {
  height: 6px;
  background: var(--bg-2);
  overflow: hidden;
}

.bars__fill {
  display: block;
  height: 100%;
  transition: width 0.4s ease;
}

.bars__row:hover .bars__fill {
  filter: brightness(1.2);
}

.bars__n {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.bars__tip {
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

.bars__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-1);
}

.bars__copy {
  color: var(--text-faint);
}

.bars__copy:hover {
  color: var(--teal-hot);
}
</style>
