<script setup lang="ts">
import type { OpsQuery, PerfMetric, Performance } from '#shared/analytics/ops'
import type { BarRow } from '~/components/ops/BarRows.vue'
import type { ColumnBin } from '~/components/ops/ColumnChart.vue'
import type { DataColumn } from '~/components/ops/DataTable.vue'
import type { LineSeries } from '~/components/ops/LineChart.vue'
import type { PercentileTile } from '~/components/ops/PercentileTiles.vue'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

useHead({ title: 'OPS // PERFORMANCE' })

const filters = useOpsFilters()
const fmt = useOpsFormat()
const { query } = filters

type Row = Record<string, unknown>
type Dim = NonNullable<OpsQuery['dim']>

const DIMS: { key: Dim; label: string }[] = [
  { key: 'device', label: 'DEVICE' },
  { key: 'browser', label: 'BROWSER' },
  { key: 'os', label: 'OS' },
  { key: 'country', label: 'COUNTRY' },
  { key: 'path', label: 'PAGE' },
  { key: 'protocol', label: 'PROTOCOL' },
]
const dim = ref<Dim>('device')

const q = computed(() => ({ ...query.value, dim: dim.value }))

const { data, status, error } = useOpsFetch<Performance>('/api/ops/performance', { query: q })

const METRIC_ORDER: PerfMetric[] = ['lcp', 'inp', 'cls', 'ttfb', 'fcp', 'dcl', 'load', 'softNav']

const tiles = computed<PercentileTile[]>(() => {
  const by = new Map((data.value?.vitals ?? []).map(v => [v.metric, v]))
  return METRIC_ORDER.map(metric => {
    const v = by.get(metric)
    return {
      metric,
      p50: v?.p50 ?? null,
      p75: v?.p75 ?? null,
      p95: v?.p95 ?? null,
      n: v?.n ?? 0,
      sub: metric === 'softNav' ? 'PER SPA NAV' : 'PER DOCUMENT LOAD',
    }
  })
})

// -- by dimension (pivot byDim → one row per key, p75 per metric) --------
function fv(metric: PerfMetric, v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return metric === 'cls' ? v.toFixed(3) : fmt.ms(v)
}

const dimColumns = computed<DataColumn[]>(() => [
  { key: 'key', label: DIMS.find(x => x.key === dim.value)?.label ?? 'KEY', ellipsis: true },
  { key: 'n', label: 'SAMPLE', title: 'page loads sampled' },
  ...METRIC_ORDER.map<DataColumn>(m => ({
    key: m,
    label: `${m.toUpperCase()} P75`,
    numeric: true,
    format: v => fv(m, v),
  })),
])

const dimRows = computed<Row[]>(() => {
  const map = new Map<string, Row>()
  for (const r of data.value?.byDim ?? []) {
    const row = map.get(r.key) ?? { key: r.key, n: 0 }
    row[r.metric] = r.p75
    if (typeof row.n === 'number') row.n = Math.max(row.n, r.n)
    map.set(r.key, row)
  }
  return [...map.values()]
})

// -- LCP series + histograms ----------------------------------------------
const lcpSeries = computed<LineSeries[]>(() => [
  { key: 'lcp', label: 'LCP P75', colorIndex: 1, points: (data.value?.lcpSeries ?? []).map(p => ({ x: p.day, y: p.n > 0 ? p.p75 : null })) },
])

function histBins(metric: PerfMetric): ColumnBin[] {
  const h = (data.value?.hist ?? []).find(x => x.metric === metric)
  if (!h) return []
  return h.bins.map(b => ({
    label: metric === 'cls' ? b.from.toFixed(2) : `${fmt.num(b.from)}`,
    n: b.n,
    title: `${metric === 'cls' ? `${b.from.toFixed(2)}–${b.to.toFixed(2)}` : `${fmt.num(b.from)}–${fmt.num(b.to)} ms`}: ${fmt.num(b.n)} loads`,
  }))
}

const lcpBins = computed(() => histBins('lcp'))
const inpBins = computed(() => histBins('inp'))

const navBins = computed<ColumnBin[]>(() =>
  (data.value?.navBreakdown ?? []).map(p => ({ label: p.phase.toUpperCase(), n: p.p50, title: `${p.phase} p50: ${fmt.ms(p.p50)}` })),
)

const lcpElementColumns: DataColumn[] = [
  { key: 'sel', label: 'ELEMENT', ellipsis: true },
  { key: 'n', label: 'LOADS' },
  { key: 'p75', label: 'LCP P75', format: v => fmt.ms(v), numeric: true },
]
const lcpElementRows = computed<Row[]>(() => (data.value?.lcpElements ?? []) as unknown as Row[])

const slowestColumns: DataColumn[] = [
  { key: 'name', label: 'RESOURCE', ellipsis: true },
  { key: 'n', label: 'SEEN' },
  { key: 'p75Ms', label: 'P75', format: v => fmt.ms(v), numeric: true },
]
const slowestRows = computed<Row[]>(() => (data.value?.resources.slowest ?? []) as unknown as Row[])

const rttRows = computed<BarRow[]>(() => (data.value?.rtt ?? []).map(r => ({ k: r.bucket, n: r.n })))
const protocolRows = computed<BarRow[]>(() => data.value?.protocol ?? [])
const tlsRows = computed<BarRow[]>(() => data.value?.tls ?? [])
const cipherRows = computed<BarRow[]>(() => data.value?.cipher ?? [])
const coloRows = computed<BarRow[]>(() => data.value?.colo ?? [])

const isEmpty = computed(() => Boolean(data.value) && (data.value?.sampled.total ?? 0) === 0)
</script>

<template>
  <div class="pf">
    <FilterBar />

    <p v-if="error" class="pf__fault">{{ opsFault(error, 'performance') }}</p>
    <p v-else-if="!data && status === 'pending'" class="pf__poll label">... POLLING</p>

    <template v-if="data">
      <div class="pf__bar">
        <span class="pf__note label">
          SAMPLE {{ fmt.num(data.sampled.n) }} / {{ fmt.num(data.sampled.total) }} NEWEST PAGE LOADS · PERCENTILES IN SQL OVER THE SAMPLE
        </span>
        <ExportButton entity="page_perf" />
      </div>

      <p v-if="isEmpty" class="pf__empty label">NO DATA // PERFORMANCE</p>

      <PercentileTiles :tiles="tiles" />

      <Panel :title="`P75 BY ${DIMS.find(x => x.key === dim)?.label ?? 'DIMENSION'} // TOP 12 BY SAMPLE`">
        <div class="pf__dims" role="group" aria-label="Dimension">
          <button
            v-for="x in DIMS"
            :key="x.key"
            type="button"
            class="pf__chip label"
            :class="{ 'pf__chip--on': dim === x.key }"
            :aria-pressed="dim === x.key"
            @click="dim = x.key"
          >
            {{ x.label }}
          </button>
        </div>
        <DataTable :columns="dimColumns" :rows="dimRows" row-key="key" :sort="{ key: 'n', dir: 'desc' }" empty="NO DATA // BY DIMENSION" dense />
      </Panel>

      <div class="pf__grid">
        <Panel title="LCP P75 // PER DAY" class="pf__wide">
          <LineChart
            :series="lcpSeries"
            aria-label="LCP p75 per day"
            :y-format="(v: number) => fmt.ms(v)"
            :x-format="(x: string) => fmt.dayLabel(x)"
          />
        </Panel>

        <Panel title="LCP // HISTOGRAM (MS)">
          <ColumnChart :bins="lcpBins" aria-label="LCP distribution" key-label="FROM MS" value-label="LOADS" />
        </Panel>

        <Panel title="INP // HISTOGRAM (MS)">
          <ColumnChart :bins="inpBins" aria-label="INP distribution" key-label="FROM MS" value-label="INTERACTIONS" />
        </Panel>

        <Panel title="NAVIGATION PHASES // P50">
          <ColumnChart :bins="navBins" aria-label="Navigation timing phases, median" key-label="PHASE" value-label="P50 MS" :y-format="(v: number) => fmt.ms(v)" />
          <p class="pf__note label">DNS → CONNECT → TLS → REQUEST → RESPONSE → DOM INTERACTIVE → DCL → LOAD</p>
        </Panel>

        <Panel title="LCP ELEMENTS">
          <DataTable :columns="lcpElementColumns" :rows="lcpElementRows" row-key="sel" :sort="{ key: 'n', dir: 'desc' }" empty="NO DATA // LCP ELEMENTS" dense :limit="12" />
        </Panel>

        <Panel title="RESOURCES // PER DOCUMENT LOAD" class="pf__wide">
          <div class="pf__stats">
            <StatCard label="AVG COUNT" :value="fmt.num(data.resources.avgCount, 1)" />
            <StatCard label="AVG BYTES" :value="fmt.bytes(data.resources.avgBytes)" />
            <StatCard label="AVG CACHED" :value="fmt.num(data.resources.avgCached, 1)" sub="RESOURCES FROM CACHE" />
            <StatCard label="LONG TASKS" :value="fmt.num(data.longTasks.pagesWithAny)" :sub="`PAGES · AVG ${fmt.ms(data.longTasks.avgTotalMs)} · P95 LONGEST ${fmt.ms(data.longTasks.p95Longest)}`" />
            <StatCard label="LOAF" :value="fmt.num(data.loaf.pagesWithAny)" :sub="`PAGES · AVG ${fmt.ms(data.loaf.avgTotalMs)} · P95 LONGEST ${fmt.ms(data.loaf.p95Longest)}`" hint="long animation frames" />
          </div>
          <div class="pf__sub label">SLOWEST RESOURCES // NEWEST 500 LOADS</div>
          <DataTable :columns="slowestColumns" :rows="slowestRows" row-key="name" :sort="{ key: 'p75Ms', dir: 'desc' }" empty="NO DATA // RESOURCES" dense :limit="12" />
        </Panel>

        <Panel title="RTT // CLIENT ↔ EDGE">
          <BarRows :rows="rttRows" key-label="BUCKET" value-label="SESSIONS" empty="NO DATA // RTT" />
        </Panel>
        <Panel title="PROTOCOL">
          <BarRows :rows="protocolRows" key-label="PROTOCOL" value-label="SESSIONS" empty="NO DATA // PROTOCOL" />
        </Panel>
        <Panel title="TLS VERSION">
          <BarRows :rows="tlsRows" key-label="TLS" value-label="SESSIONS" empty="NO DATA // TLS" />
        </Panel>
        <Panel title="CIPHER">
          <BarRows :rows="cipherRows" fold-other key-label="CIPHER" value-label="SESSIONS" empty="NO DATA // CIPHER" />
        </Panel>
        <Panel title="COLO // EDGE LOCATION">
          <BarRows :rows="coloRows" fold-other key-label="COLO" value-label="SESSIONS" empty="NO DATA // COLO" />
        </Panel>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pf {
  display: grid;
  gap: var(--space-4);
}

.pf__poll {
  color: var(--text-faint);
}

.pf__empty {
  color: var(--text-faint);
}

.pf__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.pf__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.pf__note {
  margin-top: var(--space-2);
  color: var(--text-faint);
}

.pf__sub {
  margin: var(--space-3) 0 var(--space-2);
  color: var(--text-faint);
}

.pf__dims {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-bottom: var(--space-3);
}

.pf__chip {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
  transition: border-color 0.2s, color 0.2s;
}

.pf__chip:hover {
  border-color: var(--hairline-lit);
  color: var(--text);
}

.pf__chip--on {
  border-color: var(--teal);
  color: var(--teal-hot);
}

.pf__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-2);
}

.pf__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-4) var(--space-3);
  align-items: start;
}

.pf__wide {
  grid-column: 1 / -1;
}
</style>
