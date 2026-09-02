<script setup lang="ts">
import { copyText, rowsToCsv } from '~/utils/csv'

export interface DataColumn {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  /** Cell text; receives the raw value and the row. */
  format?: (value: unknown, row: Record<string, unknown>) => string
  width?: string
  /** Header tooltip (e.g. the definition of TEXT CHARS / ACTIVE SEC). */
  title?: string
  sortable?: boolean
  /** Force numeric sort / right alignment. */
  numeric?: boolean
  /** Truncate long text with an ellipsis (cell keeps the full text as title). */
  ellipsis?: boolean
}

export interface SortState {
  key: string
  dir: 'asc' | 'desc'
}

type Row = Record<string, unknown>

/**
 * Generic lookup table: sortable columns, sticky header inside `overflow:auto`,
 * optional row links, COPY CSV through `~/utils/csv` (same formula-defusing
 * rule as the server), `data-testid` pass-through.
 */
const props = withDefaults(
  defineProps<{
    columns: DataColumn[]
    rows: Row[]
    sortable?: boolean
    /** Initial sort. */
    sort?: SortState | null
    /** Emit `sort` instead of sorting locally (keyset-paged lists). */
    serverSort?: boolean
    rowKey?: string | ((row: Row) => string)
    rowTo?: (row: Row) => string | null | undefined
    rowTestid?: string
    testid?: string
    copyCsv?: boolean
    empty?: string
    maxHeight?: string
    dense?: boolean
    /** Rows rendered; the rest are behind SHOW ALL. */
    limit?: number
  }>(),
  {
    sortable: true,
    sort: null,
    serverSort: false,
    rowKey: undefined,
    rowTo: undefined,
    rowTestid: undefined,
    testid: 'data-table',
    copyCsv: true,
    empty: 'NO DATA',
    maxHeight: undefined,
    dense: false,
    limit: undefined,
  },
)

const emit = defineEmits<{ sort: [state: SortState]; select: [row: Row] }>()

const fmt = useOpsFormat()

const sortState = ref<SortState | null>(props.sort)
watch(
  () => props.sort,
  s => {
    sortState.value = s
  },
)

const numericCols = computed(() => {
  const m: Record<string, boolean> = {}
  for (const c of props.columns) {
    if (c.numeric !== undefined) {
      m[c.key] = c.numeric
      continue
    }
    const sample = props.rows.find(r => r[c.key] !== null && r[c.key] !== undefined)
    m[c.key] = typeof sample?.[c.key] === 'number'
  }
  return m
})

function align(c: DataColumn): 'left' | 'right' | 'center' {
  return c.align ?? (numericCols.value[c.key] ? 'right' : 'left')
}

function cmp(a: unknown, b: unknown): number {
  const an = a === null || a === undefined || a === ''
  const bn = b === null || b === undefined || b === ''
  if (an && bn) return 0
  if (an) return 1
  if (bn) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' })
}

const sorted = computed<Row[]>(() => {
  const s = sortState.value
  if (!s || props.serverSort) return props.rows
  const dir = s.dir === 'asc' ? 1 : -1
  return [...props.rows].sort((a, b) => {
    const r = cmp(a[s.key], b[s.key])
    // nulls stay last in both directions
    if (r === 1 && (a[s.key] === null || a[s.key] === undefined)) return 1
    if (r === -1 && (b[s.key] === null || b[s.key] === undefined)) return -1
    return r * dir
  })
})

const showAll = ref(false)
const visible = computed(() => (props.limit !== undefined && !showAll.value ? sorted.value.slice(0, props.limit) : sorted.value))
const hidden = computed(() => sorted.value.length - visible.value.length)

function toggleSort(c: DataColumn) {
  if (!props.sortable || c.sortable === false) return
  const cur = sortState.value
  const next: SortState =
    cur && cur.key === c.key ? { key: c.key, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key: c.key, dir: numericCols.value[c.key] ? 'desc' : 'asc' }
  sortState.value = next
  emit('sort', next)
}

function keyOf(row: Row, i: number): string {
  if (typeof props.rowKey === 'function') return props.rowKey(row)
  if (props.rowKey && row[props.rowKey] !== undefined) return String(row[props.rowKey])
  return String(i)
}

function text(c: DataColumn, row: Row): string {
  const v = row[c.key]
  if (c.format) return c.format(v, row)
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return fmt.num(v, Number.isInteger(v) ? 0 : 2)
  if (typeof v === 'boolean') return v ? 'YES' : 'NO'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function linkOf(row: Row): string | null {
  const t = props.rowTo?.(row)
  return t ? t : null
}

function onRow(row: Row) {
  emit('select', row)
  const to = linkOf(row)
  if (to) void navigateTo(to)
}

const copied = ref(false)
async function copy() {
  const ok = await copyText(rowsToCsv(props.columns, sorted.value, (key, value, row) => {
    const c = props.columns.find(x => x.key === key)
    if (c?.format) return c.format(value, row)
    return value
  }))
  copied.value = ok
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="dt" :class="{ 'dt--dense': dense }" :data-testid="testid">
    <div class="dt__scroll" :style="maxHeight ? { maxHeight } : undefined">
      <table class="dt__table">
        <thead>
          <tr>
            <th
              v-for="c in columns"
              :key="c.key"
              class="dt__th label"
              :class="[`dt__th--${align(c)}`, { 'dt__th--sortable': sortable && c.sortable !== false, 'dt__th--on': sortState?.key === c.key }]"
              :style="c.width ? { width: c.width } : undefined"
              :title="c.title"
              :aria-sort="sortState?.key === c.key ? (sortState.dir === 'asc' ? 'ascending' : 'descending') : undefined"
              scope="col"
              @click="toggleSort(c)"
            >
              <span>{{ c.label }}</span>
              <span v-if="sortState?.key === c.key" class="dt__arrow" aria-hidden="true">{{ sortState.dir === 'asc' ? '↑' : '↓' }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="visible.length === 0">
            <td class="dt__empty label" :colspan="columns.length">{{ empty }}</td>
          </tr>
          <tr
            v-for="(row, i) in visible"
            :key="keyOf(row, i)"
            class="dt__row"
            :class="{ 'dt__row--link': linkOf(row) }"
            :data-testid="rowTestid"
            :tabindex="linkOf(row) ? 0 : undefined"
            @click="onRow(row)"
            @keydown.enter="onRow(row)"
          >
            <td
              v-for="(c, ci) in columns"
              :key="c.key"
              class="dt__td"
              :class="[`dt__td--${align(c)}`, { 'dt__td--ellipsis': c.ellipsis }]"
              :title="c.ellipsis ? text(c, row) : undefined"
            >
              <slot :name="`cell-${c.key}`" :row="row" :value="row[c.key]" :text="text(c, row)">
                <NuxtLink v-if="ci === 0 && linkOf(row)" :to="linkOf(row) as string" class="dt__link" @click.stop>{{ text(c, row) }}</NuxtLink>
                <template v-else>{{ text(c, row) }}</template>
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="hidden > 0 || (copyCsv && rows.length > 0)" class="dt__foot">
      <button v-if="hidden > 0" type="button" class="dt__btn label" @click="showAll = true">SHOW ALL // +{{ fmt.num(hidden) }}</button>
      <span v-else />
      <button v-if="copyCsv && rows.length > 0" type="button" class="dt__btn label" data-testid="copy-csv" @click="copy">
        {{ copied ? 'COPIED' : 'COPY CSV' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.dt {
  min-width: 0;
}

.dt__scroll {
  overflow: auto;
  max-width: 100%;
}

.dt__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-data);
  font-variant-numeric: tabular-nums;
}

.dt--dense .dt__table {
  font-size: var(--fs-micro);
}

.dt__th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: var(--space-1) var(--space-2);
  background: var(--bg-1);
  border-bottom: 1px solid var(--hairline-lit);
  color: var(--text-dim);
  text-align: left;
  white-space: nowrap;
  user-select: none;
}

.dt__th--right {
  text-align: right;
}

.dt__th--center {
  text-align: center;
}

.dt__th--sortable {
  cursor: pointer;
}

.dt__th--sortable:hover,
.dt__th--on {
  color: var(--text);
}

.dt__arrow {
  margin-left: 2px;
}

.dt__td {
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--hairline);
  color: var(--text);
  vertical-align: top;
  white-space: nowrap;
}

.dt--dense .dt__td {
  padding: 2px var(--space-2);
}

.dt__td--right {
  text-align: right;
}

.dt__td--center {
  text-align: center;
}

.dt__td--ellipsis {
  max-width: 28em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dt__row--link {
  cursor: pointer;
}

.dt__row:hover .dt__td {
  background: var(--bg-2);
}

.dt__link {
  color: var(--teal-hot);
}

.dt__empty {
  padding: var(--space-2);
  color: var(--text-faint);
}

.dt__foot {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.dt__btn {
  color: var(--text-faint);
}

.dt__btn:hover {
  color: var(--teal-hot);
}
</style>
