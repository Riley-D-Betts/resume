<script setup lang="ts">
import type { Cohorts, VisitorSummary, Visitors } from '#shared/analytics/ops'
import type { BarRow } from '~/components/ops/BarRows.vue'
import type { DataColumn, SortState } from '~/components/ops/DataTable.vue'
import type { OpsFetchError } from '~/composables/useOpsFetch'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

useHead({ title: 'OPS // VISITORS' })

const filters = useOpsFilters()
const fmt = useOpsFormat()
const { state, query, linkTo } = filters

type Row = Record<string, unknown>

const LIMIT = 50
const MAX_OFFSET = 5000

// -- cohorts -----------------------------------------------------------
const { data: cohorts, status: cStatus, error: cError } = useOpsFetch<Cohorts>('/api/ops/cohorts', { query })

const recencyLabels = computed(() => (cohorts.value?.recency ?? []).map(r => r.bucket))
const freqLabels = computed(() => (cohorts.value?.frequency ?? []).map(f => `${f.bucket} VISITS`))
const recencyRows = computed<BarRow[]>(() => (cohorts.value?.recency ?? []).map(r => ({ k: `LAST SEEN ${r.bucket}`, n: r.n })))
const freqRows = computed<BarRow[]>(() => (cohorts.value?.frequency ?? []).map(f => ({ k: `${f.bucket} VISITS`, n: f.n })))

// -- visitors (offset paging, ≤ 5 000) ----------------------------------
const SERVER_SORTS = new Set(['lastSeen', 'visitCount', 'totalActiveMs', 'intent'])
const initial = state.value.sort && SERVER_SORTS.has(state.value.sort) ? state.value.sort : 'lastSeen'
const sort = ref<SortState>({ key: initial, dir: state.value.dir === 'asc' ? 'asc' : 'desc' })

const rows = ref<VisitorSummary[]>([])
const total = ref(0)
const offset = ref(0)
const loading = ref(false)
const error = ref<OpsFetchError | null>(null)
let seq = 0

const baseQuery = computed(() => ({ ...query.value, sort: sort.value.key, dir: sort.value.dir, limit: String(LIMIT) }))

async function load(reset: boolean) {
  const my = ++seq
  loading.value = true
  if (reset) {
    offset.value = 0
    error.value = null
  }
  try {
    const res = await opsFetch<Visitors>('/api/ops/visitors', { query: { ...baseQuery.value, offset: String(offset.value) } })
    if (my !== seq) return
    total.value = res.total
    rows.value = reset ? res.rows : [...rows.value, ...res.rows]
    offset.value = res.offset + res.rows.length
    error.value = null
  } catch (e) {
    if (my !== seq) return
    error.value = e as OpsFetchError
    if (reset) rows.value = []
  } finally {
    if (my === seq) loading.value = false
  }
}

// Only reload when the request actually changed (a rebuilt-but-equal query must not restart the list).
let lastKey = ''
watch(
  baseQuery,
  q => {
    const key = JSON.stringify(q)
    if (key === lastKey) return
    lastKey = key
    void load(true)
  },
  { immediate: true, deep: true },
)

const hasMore = computed(() => rows.value.length < total.value && offset.value < MAX_OFFSET)

function onSort(s: SortState) {
  if (SERVER_SORTS.has(s.key)) sort.value = s
}

const columns: DataColumn[] = [
  { key: 'vid', label: 'VISITOR', format: v => String(v).slice(0, 8).toUpperCase(), sortable: false },
  { key: 'visitCount', label: 'VISITS' },
  { key: 'lastSeen', label: 'LAST SEEN', format: v => fmt.dateTime(v), numeric: true, align: 'left' },
  { key: 'firstSeen', label: 'FIRST SEEN', format: v => fmt.dateTime(v), numeric: true, align: 'left', sortable: false },
  { key: 'recencyDays', label: 'RECENCY', format: v => `${fmt.num(v)} d`, numeric: true, sortable: false },
  { key: 'freqBucket', label: 'FREQ', sortable: false },
  { key: 'lastAsOrg', label: 'LAST ORG', format: v => fmt.str(v), ellipsis: true, sortable: false },
  { key: 'firstAsOrg', label: 'FIRST ORG', format: v => fmt.str(v), ellipsis: true, sortable: false },
  { key: 'lastCountry', label: 'COUNTRY', format: v => fmt.str(v), sortable: false },
  { key: 'firstEntryPath', label: 'FIRST ENTRY', format: v => fmt.str(v), ellipsis: true, sortable: false },
  { key: 'firstReferrer', label: 'FIRST REFERRER', format: v => fmt.str(v), ellipsis: true, sortable: false },
  { key: 'totalActiveMs', label: 'ACTIVE', format: v => fmt.mmss(v), numeric: true, title: 'Σ page_visits.active_ms over the visitor’s sessions in range' },
  { key: 'sessionsInRange', label: 'SESSIONS', sortable: false },
  { key: 'pagesRead', label: 'PAGES', sortable: false },
  { key: 'intent', label: 'INTENT', sortable: false },
  { key: 'hasReplay', label: 'REPLAY', format: v => (v ? 'YES' : 'NO'), align: 'center', sortable: false },
]

const tableRows = computed<Row[]>(() => rows.value as unknown as Row[])

function flagsOf(intent: unknown): string[] {
  if (!intent || typeof intent !== 'object') return []
  return Object.entries(intent as Record<string, unknown>)
    .filter(([, n]) => typeof n === 'number' && n > 0)
    .map(([k]) => k)
}

const cohortsEmpty = computed(() => Boolean(cohorts.value) && (cohorts.value?.visitors ?? 0) === 0)
</script>

<template>
  <div class="vs">
    <FilterBar :show-compare="false" />

    <p v-if="cError" class="vs__fault">{{ opsFault(cError, 'cohorts') }}</p>
    <p v-else-if="!cohorts && cStatus === 'pending'" class="vs__poll label">... POLLING</p>

    <template v-if="cohorts">
      <div class="vs__stats">
        <StatCard label="VISITORS IN RANGE" :value="fmt.num(cohorts.visitors)" hint="visitors with ≥ 1 session in the window" />
        <StatCard label="RETURNING SHARE" :value="fmt.pct(cohorts.returningShare, 1)" hint="visitors with visit_count > 1 — the same definition the RETURNING chip uses on this view" :to="linkTo('/ops/visitors', { returning: '1' })" />
        <StatCard label="SEEN < 1 D" :value="fmt.num(cohorts.recency[0]?.n ?? 0)" />
        <StatCard label="10+ VISITS" :value="fmt.num(cohorts.frequency[3]?.n ?? 0)" />
      </div>

      <p v-if="cohortsEmpty" class="vs__empty label">NO DATA // VISITORS</p>

      <div class="vs__grid">
        <Panel title="COHORTS // RECENCY × FREQUENCY">
          <Heatmap
            :rows="recencyLabels"
            :cols="freqLabels"
            :cells="cohorts.matrix"
            aria-label="Visitors by recency and frequency"
            :label-width="60"
          />
          <p class="vs__note label">RECENCY = DAYS SINCE LAST SEEN AT THE END OF THE WINDOW · FREQUENCY = LIFETIME VISITS</p>
        </Panel>
        <Panel title="RECENCY">
          <BarRows :rows="recencyRows" key-label="BUCKET" value-label="VISITORS" empty="NO DATA // RECENCY" />
        </Panel>
        <Panel title="FREQUENCY">
          <BarRows :rows="freqRows" key-label="BUCKET" value-label="VISITORS" empty="NO DATA // FREQUENCY" />
        </Panel>
        <Panel title="THEIR SESSIONS // DAY × HOUR" class="vs__wide">
          <Heatmap :heat="cohorts.heatmap" aria-label="Sessions of these visitors by weekday and hour" />
        </Panel>
      </div>
    </template>

    <p v-if="error" class="vs__fault">{{ opsFault(error, 'visitors') }}</p>

    <div class="vs__bar">
      <span class="vs__count label">{{ fmt.num(rows.length) }} OF {{ fmt.num(total) }} VISITOR{{ total === 1 ? '' : 'S' }}</span>
      <ExportButton entity="visitors" />
    </div>

    <Panel title="VISITORS // WHO KEEPS COMING BACK">
      <DataTable
        :columns="columns"
        :rows="tableRows"
        row-key="vid"
        row-testid="visitor-row"
        :sort="sort"
        server-sort
        :row-to="(r: Row) => linkTo(`/ops/visitors/${String(r.vid)}`)"
        :empty="loading ? '... POLLING' : 'NO DATA // VISITORS'"
        dense
        @sort="onSort"
      >
        <template #cell-intent="{ value, row }">
          <IntentBadges :flags="flagsOf(value)" :replay="Boolean(row.hasReplay)" :max="5" />
        </template>
        <template #cell-hasReplay="{ value }">
          <StatusLamp :color="value ? 'teal' : 'off'" :pulse="false" />
        </template>
      </DataTable>
      <div v-if="loading && rows.length" class="vs__empty label">... POLLING</div>
      <button v-if="hasMore" type="button" class="vs__more label" :disabled="loading" @click="load(false)">
        LOAD MORE // {{ fmt.num(rows.length) }} OF {{ fmt.num(total) }}
      </button>
      <p v-else-if="rows.length >= MAX_OFFSET" class="vs__note label">OFFSET PAGING STOPS AT {{ fmt.num(MAX_OFFSET) }} · NARROW THE FILTERS OR EXPORT</p>
    </Panel>
  </div>
</template>

<style scoped>
.vs {
  display: grid;
  gap: var(--space-4);
}

.vs__poll {
  color: var(--text-faint);
}

.vs__empty {
  color: var(--text-faint);
  padding: var(--space-2) 0;
}

.vs__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.vs__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-2);
}

.vs__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-4) var(--space-3);
  align-items: start;
}

.vs__wide {
  grid-column: 1 / -1;
}

.vs__note {
  margin-top: var(--space-2);
  color: var(--text-faint);
}

.vs__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.vs__count {
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.vs__more {
  width: 100%;
  margin-top: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
  transition: border-color 0.2s, color 0.2s;
}

.vs__more:hover:not(:disabled) {
  border-color: var(--teal);
  color: var(--teal-hot);
}

.vs__more:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
