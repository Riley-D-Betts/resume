<script setup lang="ts">
import type { PageDetail, PageStat, Pages } from '#shared/analytics/ops'
import type { BarRow } from '~/components/ops/BarRows.vue'
import type { ColumnBin } from '~/components/ops/ColumnChart.vue'
import type { DataColumn } from '~/components/ops/DataTable.vue'
import type { LineSeries } from '~/components/ops/LineChart.vue'
import type { OpsFetchError, OpsFetchStatus } from '~/composables/useOpsFetch'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

const filters = useOpsFilters()
const fmt = useOpsFormat()
const { state, query, linkTo } = filters

type Row = Record<string, unknown>

/** `?path=` is the shared PATH filter, so the URL round-trips through useOpsFilters. */
const path = computed(() => state.value.path)

useHead({ title: computed(() => (path.value ? `OPS // PAGE ${path.value}` : 'OPS // PAGE')) })

// Manual fetch: no request at all while no path is selected (the API 400s without one).
const data = ref<PageDetail | null>(null)
const status = ref<OpsFetchStatus>('idle')
const error = ref<OpsFetchError | null>(null)
let seq = 0

async function load() {
  if (!path.value) {
    data.value = null
    status.value = 'idle'
    error.value = null
    return
  }
  const my = ++seq
  status.value = 'pending'
  try {
    const res = await opsFetch<PageDetail>('/api/ops/pages/detail', { query: query.value })
    if (my !== seq) return
    data.value = res
    error.value = null
    status.value = 'success'
  } catch (e) {
    if (my !== seq) return
    error.value = e as OpsFetchError
    status.value = 'error'
  }
}

let lastKey = ''
watch(
  query,
  q => {
    const key = JSON.stringify(q)
    if (key === lastKey) return
    lastKey = key
    void load()
  },
  { immediate: true, deep: true },
)

// The page's own stat row comes from the list endpoint (30 s server cache).
const { data: list } = useOpsFetch<Pages>('/api/ops/pages', { query })
const stat = computed<PageStat | null>(() => (list.value?.pages ?? []).find(p => p.path === path.value) ?? null)

// -- blocks ------------------------------------------------------------
const series = computed<LineSeries[]>(() => [
  { key: 'pageviews', label: 'PAGEVIEWS', colorIndex: 1, points: (data.value?.series ?? []).map(p => ({ x: p.day, y: p.pageviews })) },
])

const sectionRows = computed<BarRow[]>(() =>
  [...(data.value?.sections ?? [])]
    .sort((a, b) => b.avgDwellMs - a.avgDwellMs)
    .map(s => ({
      k: s.section,
      n: s.avgDwellMs,
      display: `${fmt.sec(s.avgDwellMs)} · ${fmt.num(s.n)}x`,
      title: `${s.section}: avg dwell ${fmt.sec(s.avgDwellMs)} over ${fmt.num(s.n)} enters in ${fmt.num(s.sessions)} sessions`,
    })),
)

const scrollBins = computed<ColumnBin[]>(() =>
  (data.value?.scrollFunnel ?? []).map(f => ({ label: `${f.pct}%`, n: f.sessions, title: `reached ${f.pct}%: ${fmt.num(f.sessions)} sessions` })),
)

const dwellBins = computed<ColumnBin[]>(() => (data.value?.dwellHist ?? []).map(b => ({ label: b.bucket, n: b.n })))

function pathRows(list: { k: string; n: number }[] | undefined): BarRow[] {
  return (list ?? []).map(p => ({
    k: p.k,
    n: p.n,
    to: p.k.startsWith('(') ? undefined : linkTo('/ops/pages/detail', { path: p.k }),
  }))
}

const nextRows = computed(() => pathRows(data.value?.next))
const prevRows = computed(() => pathRows(data.value?.prev))

const clickColumns: DataColumn[] = [
  { key: 'sel', label: 'SELECTOR', ellipsis: true },
  { key: 'text', label: 'TEXT', ellipsis: true },
  { key: 'n', label: 'CLICKS' },
]
const clickRows = computed<Row[]>(() => (data.value?.clicks ?? []) as unknown as Row[])

const visitColumns: DataColumn[] = [
  { key: 'entered_at', label: 'ENTERED', format: v => fmt.dateTime(v), numeric: true, align: 'left' },
  { key: 'sid', label: 'SESSION', format: v => String(v).slice(0, 8).toUpperCase() },
  { key: 'from_path', label: 'FROM', format: v => fmt.str(v), ellipsis: true },
  { key: 'nav_kind', label: 'NAV', format: v => fmt.str(v).toUpperCase() },
  { key: 'active_ms', label: 'ACTIVE', format: v => fmt.mmss(v), numeric: true },
  { key: 'hidden_ms', label: 'HIDDEN', format: v => fmt.mmss(v), numeric: true },
  { key: 'max_scroll_pct', label: 'SCROLL %', format: v => fmt.pct(v, 0) },
  { key: 'sections_seen', label: 'SECTIONS' },
  { key: 'clicks', label: 'CLICKS' },
  { key: 'console_errors', label: 'CONSOLE ERR' },
  { key: 'leave_reason', label: 'LEAVE', format: v => fmt.str(v).toUpperCase() },
]
const visitRows = computed<Row[]>(() => (data.value?.recent ?? []) as unknown as Row[])

const isEmpty = computed(() => {
  const d = data.value
  if (!d) return false
  return d.series.length === 0 && d.recent.length === 0 && d.sections.length === 0 && d.clicks.length === 0
})
</script>

<template>
  <div class="pd">
    <FilterBar />

    <div class="pd__bar">
      <NuxtLink :to="linkTo('/ops/pages')" class="pd__back label">&larr; PAGES</NuxtLink>
      <NuxtLink v-if="path" :to="linkTo('/ops/sessions', { path })" class="pd__back label">SESSIONS ON THIS PAGE &rarr;</NuxtLink>
    </div>

    <p v-if="!path" class="pd__empty label">NO PATH SELECTED // PICK A PAGE FROM THE PATH FILTER OR THE PAGES TABLE</p>

    <p v-if="error" class="pd__fault">{{ opsFault(error, `page ${path}`) }}</p>
    <p v-else-if="!data && status === 'pending'" class="pd__poll label">... POLLING</p>

    <template v-if="data">
      <div v-if="stat" class="pd__stats">
        <StatCard label="PAGEVIEWS" :value="fmt.num(stat.pageviews)" :delta="state.compare ? fmt.delta(stat.pageviews, stat.prev?.pageviews) : null" />
        <StatCard label="SESSIONS" :value="fmt.num(stat.sessions)" />
        <StatCard label="ENTRIES" :value="fmt.num(stat.entries)" />
        <StatCard label="EXITS" :value="fmt.num(stat.exits)" />
        <StatCard label="AVG ACTIVE" :value="fmt.mmss(stat.avgActiveMs)" sub="MM:SS" :delta="state.compare ? fmt.delta(stat.avgActiveMs, stat.prev?.avgActiveMs) : null" />
        <StatCard label="P50 ACTIVE" :value="fmt.mmss(stat.p50ActiveMs)" sub="MM:SS" />
        <StatCard label="AVG SCROLL" :value="fmt.pct(stat.avgScrollPct, 0)" />
        <StatCard label="BOUNCE %" :value="fmt.pct(stat.bounceRate, 1)" hint="bounced sessions entering here ÷ sessions entering here" />
        <StatCard label="ERRORS" :value="fmt.num(stat.errors)" :lamp="stat.errors > 0 ? 'red' : 'off'" :pulse="false" />
        <StatCard label="TEXT CHARS / ACTIVE SEC" :value="fmt.num(stat.textCps, 1)" hint="higher = skimming or bouncing" />
      </div>

      <p v-if="isEmpty" class="pd__empty label">NO DATA // PAGE {{ path }}</p>

      <div class="pd__grid">
        <Panel :title="`PAGEVIEWS // ${path} PER DAY`" class="pd__wide">
          <LineChart
            :series="series"
            aria-label="Pageviews per day"
            :y-format="(v: number) => fmt.kfmt(v)"
            :x-format="(x: string) => fmt.dayLabel(x)"
          />
        </Panel>

        <Panel title="SECTIONS // AVG DWELL">
          <BarRows :rows="sectionRows" table-toggle key-label="SECTION" value-label="AVG DWELL" empty="NO DATA // SECTIONS" />
        </Panel>

        <Panel title="SCROLL FUNNEL // SESSIONS REACHING">
          <ColumnChart :bins="scrollBins" aria-label="Sessions reaching each scroll milestone" key-label="MILESTONE" value-label="SESSIONS" />
        </Panel>

        <Panel title="CAME FROM">
          <BarRows :rows="prevRows" fold-other key-label="PATH" value-label="VISITS" empty="NO DATA // PREV" />
        </Panel>

        <Panel title="WENT TO">
          <BarRows :rows="nextRows" fold-other key-label="PATH" value-label="VISITS" empty="NO DATA // NEXT" />
        </Panel>

        <Panel title="DWELL // 5 S BUCKETS OF ACTIVE TIME">
          <ColumnChart :bins="dwellBins" aria-label="Active time distribution" key-label="BUCKET" value-label="VISITS" />
        </Panel>

        <Panel title="TOP CLICKS">
          <DataTable :columns="clickColumns" :rows="clickRows" :sort="{ key: 'n', dir: 'desc' }" empty="NO DATA // CLICKS" dense :limit="20" />
        </Panel>

        <Panel title="RECENT VISITS" class="pd__wide">
          <DataTable
            :columns="visitColumns"
            :rows="visitRows"
            row-key="pvid"
            :sort="{ key: 'entered_at', dir: 'desc' }"
            :row-to="(r: Row) => `/ops/sessions/${String(r.sid)}`"
            empty="NO DATA // VISITS"
            dense
            :limit="25"
          />
        </Panel>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pd {
  display: grid;
  gap: var(--space-4);
}

.pd__bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-2);
}

.pd__back {
  color: var(--text-dim);
}

.pd__back:hover {
  color: var(--teal-hot);
  text-decoration: none;
}

.pd__poll {
  color: var(--text-faint);
}

.pd__empty {
  color: var(--text-faint);
}

.pd__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.pd__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-2);
}

.pd__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-4) var(--space-3);
  align-items: start;
}

.pd__wide {
  grid-column: 1 / -1;
}
</style>
