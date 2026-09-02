<script setup lang="ts">
import type { SessionRow, SessionsCursor, SessionsPage } from '#shared/analytics/ops'
import type { DataColumn, SortState } from '~/components/ops/DataTable.vue'
import type { OpsFetchError } from '~/composables/useOpsFetch'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

useHead({ title: 'OPS // SESSIONS' })

const filters = useOpsFilters()
const fmt = useOpsFormat()
const { state, query, linkTo } = filters

type Row = Record<string, unknown>

const LIMIT = 50

/** Keyset paging (audit A24): `next` → `before` + `beforeSid`; LOAD MORE appends. */
const SERVER_SORTS = new Set(['started_at', 'duration_ms', 'pageviews'])
const initial = state.value.sort && SERVER_SORTS.has(state.value.sort) ? state.value.sort : 'started_at'
const sort = ref<SortState>({ key: initial, dir: state.value.dir === 'asc' ? 'asc' : 'desc' })

const rows = ref<SessionRow[]>([])
const total = ref<number | null>(null)
const next = ref<SessionsCursor | null>(null)
const loading = ref(false)
const error = ref<OpsFetchError | null>(null)
let seq = 0

const baseQuery = computed(() => ({ ...query.value, sort: sort.value.key, dir: sort.value.dir, limit: String(LIMIT) }))

async function load(reset: boolean) {
  const my = ++seq
  loading.value = true
  if (reset) error.value = null
  const cursor = reset || !next.value ? {} : { before: String(next.value.before), beforeSid: next.value.beforeSid }
  try {
    const res = await opsFetch<SessionsPage>('/api/ops/sessions', { query: { ...baseQuery.value, ...cursor } })
    if (my !== seq) return
    if (reset || res.total !== null) total.value = res.total
    rows.value = reset ? res.rows : [...rows.value, ...res.rows]
    next.value = res.next
    error.value = null
  } catch (e) {
    if (my !== seq) return
    error.value = e as OpsFetchError
    if (reset) {
      rows.value = []
      next.value = null
      total.value = null
    }
  } finally {
    if (my === seq) loading.value = false
  }
}

// Only reload when the request actually changed — every filter write rebuilds
// the state object, and a rebuilt-but-equal query must not restart the list.
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

function onSort(s: SortState) {
  if (SERVER_SORTS.has(s.key)) sort.value = s
}

function geo(s: SessionRow): string {
  const parts = [s.country ?? '??']
  if (s.city) parts.push(s.city)
  return parts.join(' / ')
}

function flagsOf(s: SessionRow): string[] {
  const out: string[] = []
  if (s.is_bot) out.push('BOT')
  if (s.is_webdriver) out.push('AUTO')
  if (s.is_tor) out.push('TOR')
  if (s.is_returning) out.push(`RET ×${s.visit_n}`)
  if (s.gpc) out.push('GPC')
  return out
}

const columns: DataColumn[] = [
  { key: 'started_at', label: 'TIME', format: v => fmt.dateTime(v), numeric: true, align: 'left' },
  { key: 'as_org', label: 'ORG', format: v => fmt.str(v), ellipsis: true, sortable: false },
  { key: 'geo', label: 'GEO', ellipsis: true, sortable: false },
  { key: 'client', label: 'CLIENT', ellipsis: true, sortable: false },
  { key: 'route', label: 'ENTRY → EXIT', ellipsis: true, sortable: false },
  { key: 'active_ms', label: 'ACTIVE', format: v => fmt.mmss(v), numeric: true, sortable: false, title: 'Σ page_visits.active_ms' },
  { key: 'duration_ms', label: 'HEARTBEAT', format: v => fmt.mmss(v), numeric: true, title: 'heartbeat time, 15 s steps' },
  { key: 'max_scroll_pct', label: 'SCROLL %', format: v => fmt.pct(v, 0), sortable: false },
  { key: 'pageviews', label: 'PAGES' },
  { key: 'intent', label: 'INTENT', sortable: false },
  { key: 'flags', label: 'FLAGS', sortable: false },
  { key: 'has_replay', label: 'REPLAY', format: v => (v ? 'YES' : 'NO'), align: 'center', sortable: false },
]

const tableRows = computed<Row[]>(() =>
  rows.value.map(s => ({
    ...s,
    geo: geo(s),
    client: `${s.device_type ?? '?'} · ${s.browser ?? '?'}${s.os ? ` · ${s.os}` : ''}`,
    route: `${s.entry_path ?? '—'} → ${s.exit_path ?? s.last_path ?? '—'}`,
    flags: flagsOf(s).join(' '),
  })),
)

function orgTo(row: Row): string | null {
  const org = row.as_org
  return typeof org === 'string' && org ? linkTo('/ops/orgs/detail', { org }) : null
}
</script>

<template>
  <div class="sx">
    <FilterBar />

    <p v-if="error" class="sx__fault">{{ opsFault(error, 'sessions') }}</p>

    <div class="sx__bar">
      <span class="sx__count label">
        <template v-if="total !== null">{{ fmt.num(rows.length) }} OF {{ fmt.num(total) }} SESSION{{ total === 1 ? '' : 'S' }}</template>
        <template v-else>{{ fmt.num(rows.length) }} SESSIONS</template>
      </span>
      <ExportButton entity="sessions" />
    </div>

    <Panel title="SESSION LOG">
      <DataTable
        :columns="columns"
        :rows="tableRows"
        row-key="sid"
        row-testid="session-row"
        :sort="sort"
        server-sort
        :row-to="(r: Row) => `/ops/sessions/${String(r.sid)}`"
        :empty="loading ? '... POLLING' : 'NO SESSIONS IN RANGE'"
        dense
        @sort="onSort"
      >
        <template #cell-as_org="{ row, text }">
          <NuxtLink v-if="orgTo(row)" :to="orgTo(row) as string" class="sx__org" :title="text" @click.stop>{{ text }}</NuxtLink>
          <template v-else>{{ text }}</template>
        </template>
        <template #cell-intent="{ row }">
          <IntentBadges :session="row" :max="5" />
        </template>
        <template #cell-flags="{ text }">
          <span class="sx__flags label">{{ text }}</span>
        </template>
        <template #cell-has_replay="{ value }">
          <StatusLamp :color="value ? 'teal' : 'off'" :pulse="false" />
        </template>
      </DataTable>

      <div v-if="loading && rows.length" class="sx__empty label">... POLLING</div>

      <button v-if="next" type="button" class="sx__more label" :disabled="loading" @click="load(false)">
        LOAD MORE // {{ fmt.num(rows.length) }}<template v-if="total !== null"> OF {{ fmt.num(total) }}</template>
      </button>
    </Panel>
  </div>
</template>

<style scoped>
.sx {
  display: grid;
  gap: var(--space-3);
}

.sx__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.sx__count {
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.sx__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.sx__org {
  color: var(--teal-hot);
}

.sx__flags {
  color: var(--amber);
  white-space: nowrap;
}

.sx__empty {
  padding: var(--space-3) 0;
  color: var(--text-faint);
}

.sx__more {
  width: 100%;
  margin-top: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
  transition: border-color 0.2s, color 0.2s;
}

.sx__more:hover:not(:disabled) {
  border-color: var(--teal);
  color: var(--teal-hot);
}

.sx__more:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
