<script setup lang="ts">
import type { Pages } from '#shared/analytics/ops'
import type { DataColumn } from '~/components/ops/DataTable.vue'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

useHead({ title: 'OPS // PAGES' })

const filters = useOpsFilters()
const fmt = useOpsFormat()
const { state, query, linkTo } = filters

type Row = Record<string, unknown>

const { data, status, error } = useOpsFetch<Pages>('/api/ops/pages', { query })

const compare = computed(() => state.value.compare && (data.value?.pages ?? []).some(p => p.prev !== undefined))

const columns = computed<DataColumn[]>(() => {
  const cols: DataColumn[] = [
    { key: 'path', label: 'PATH', ellipsis: true },
    { key: 'pageviews', label: 'PAGEVIEWS' },
  ]
  if (compare.value) {
    cols.push({
      key: 'prevPageviews',
      label: 'PREV PV',
      title: 'pageviews in the previous period · change',
      numeric: true,
      format: (v, row) => {
        const d = fmt.delta(row.pageviews, v)
        return d ? `${fmt.num(v)} · ${d.text}` : fmt.num(v)
      },
    })
  }
  cols.push(
    { key: 'sessions', label: 'SESSIONS' },
    { key: 'entries', label: 'ENTRIES' },
    { key: 'exits', label: 'EXITS' },
    { key: 'avgActiveMs', label: 'AVG ACTIVE', format: v => fmt.mmss(v), numeric: true },
    { key: 'p50ActiveMs', label: 'P50 ACTIVE', format: v => fmt.mmss(v), numeric: true, title: 'median active time — sampled from the newest 5 000 page visits in range' },
    { key: 'avgScrollPct', label: 'SCROLL %', format: v => fmt.pct(v, 0) },
    { key: 'bounceRate', label: 'BOUNCE %', format: v => fmt.pct(v, 1), title: 'bounced sessions entering here ÷ sessions entering here' },
    { key: 'errors', label: 'ERRORS' },
    {
      key: 'textCps',
      label: 'TEXT CHARS / ACTIVE SEC',
      title: 'text length ÷ active seconds — higher = skimming or bouncing',
      format: v => fmt.num(v, 1),
      numeric: true,
    },
  )
  return cols
})

const rows = computed<Row[]>(() =>
  (data.value?.pages ?? []).map(p => ({
    ...p,
    prevPageviews: p.prev?.pageviews ?? null,
  })),
)

const sectionColumns: DataColumn[] = [
  { key: 'path', label: 'PATH', ellipsis: true },
  { key: 'section', label: 'SECTION' },
  { key: 'avgDwellMs', label: 'AVG DWELL', format: v => fmt.sec(v), numeric: true },
  { key: 'n', label: 'ENTERS' },
  { key: 'sessions', label: 'SESSIONS' },
]

const sectionRows = computed<Row[]>(() => (data.value?.sections ?? []) as unknown as Row[])

function pageTo(row: Row): string {
  return linkTo('/ops/pages/detail', { path: String(row.path ?? '') })
}

const sinceNote = computed(() => {
  const s = data.value?.since
  return s ? `PAGE-LEVEL DATA SINCE ${fmt.full(s)}` : 'NO PAGE-LEVEL DATA YET // page_visits is empty'
})
</script>

<template>
  <div class="pg">
    <FilterBar />

    <p v-if="error" class="pg__fault">{{ opsFault(error, 'pages') }}</p>
    <p v-else-if="!data && status === 'pending'" class="pg__poll label">... POLLING</p>

    <template v-if="data">
      <div class="pg__bar">
        <span class="pg__note label">{{ sinceNote }}</span>
        <ExportButton entity="page_visits" />
      </div>

      <Panel title="PAGES // WHAT THEY READ, FOR HOW LONG">
        <DataTable
          :columns="columns"
          :rows="rows"
          row-key="path"
          row-testid="page-row"
          :sort="{ key: 'pageviews', dir: 'desc' }"
          :row-to="pageTo"
          empty="NO DATA // PAGES"
        />
      </Panel>

      <Panel title="SECTIONS // DWELL PER PAGE">
        <DataTable
          :columns="sectionColumns"
          :rows="sectionRows"
          :row-key="(r: Row) => `${String(r.path)}#${String(r.section)}`"
          :sort="{ key: 'avgDwellMs', dir: 'desc' }"
          :row-to="pageTo"
          empty="NO DATA // SECTIONS"
          dense
          :limit="40"
        />
        <p class="pg__note label">DWELL = VISIBLE ≥ 40 % FOR ≥ 500 MS · HIDDEN-TAB TIME EXCLUDED</p>
      </Panel>
    </template>
  </div>
</template>

<style scoped>
.pg {
  display: grid;
  gap: var(--space-4);
}

.pg__poll {
  color: var(--text-faint);
}

.pg__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.pg__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.pg__note {
  color: var(--text-faint);
}
</style>
