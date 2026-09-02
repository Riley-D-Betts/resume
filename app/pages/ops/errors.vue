<script setup lang="ts">
import type { ErrorGroup, Errors, EventRow } from '#shared/analytics/ops'
import type { DataColumn } from '~/components/ops/DataTable.vue'
import type { LineSeries } from '~/components/ops/LineChart.vue'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

useHead({ title: 'OPS // ERRORS' })

const filters = useOpsFilters()
const fmt = useOpsFormat()
const { state, query, linkTo } = filters

type Row = Record<string, unknown>

const { data, status, error } = useOpsFetch<Errors>('/api/ops/errors', { query })

const compare = computed(() => state.value.compare && (data.value?.groups ?? []).some(g => g.prev !== undefined))

const total = computed(() => (data.value?.groups ?? []).reduce((a, g) => a + g.n, 0))
const sessionsHit = computed(() => (data.value?.groups ?? []).reduce((a, g) => a + g.sessions, 0))
const prevTotal = computed(() => (compare.value ? (data.value?.groups ?? []).reduce((a, g) => a + (g.prev ?? 0), 0) : null))

const byKind = computed(() => {
  const m = { js: 0, resource: 0, console: 0 }
  for (const g of data.value?.groups ?? []) m[g.kind] += g.n
  return m
})

const columns = computed<DataColumn[]>(() => {
  const cols: DataColumn[] = [
    { key: 'kind', label: 'KIND', format: v => String(v).toUpperCase(), width: '6em' },
    { key: 'msg', label: 'MESSAGE', ellipsis: true },
    { key: 'src', label: 'SOURCE', format: v => fmt.str(v), ellipsis: true },
    { key: 'n', label: 'N' },
  ]
  if (compare.value) {
    cols.push({
      key: 'prev',
      label: 'PREV',
      title: 'count in the previous period · change',
      numeric: true,
      format: (v, row) => {
        const d = fmt.delta(row.n, v)
        return d ? `${fmt.num(v)} · ${d.text}` : fmt.num(v)
      },
    })
  }
  cols.push(
    { key: 'sessions', label: 'SESSIONS' },
    { key: 'browsersText', label: 'BROWSERS', ellipsis: true, sortable: false },
    { key: 'pathsText', label: 'PAGES', ellipsis: true, sortable: false },
    { key: 'firstSeen', label: 'FIRST', format: v => fmt.dateTime(v), numeric: true, align: 'left' },
    { key: 'lastSeen', label: 'LAST', format: v => fmt.dateTime(v), numeric: true, align: 'left' },
  )
  return cols
})

function keyOf(g: ErrorGroup): string {
  return `${g.kind}|${g.msg}|${g.src ?? ''}`
}

const rows = computed<Row[]>(() =>
  (data.value?.groups ?? []).map(g => ({
    ...g,
    id: keyOf(g),
    browsersText: g.browsers.map(b => `${b.k} ${fmt.num(b.n)}`).join(' · '),
    pathsText: g.paths.map(p => `${p.k} ${fmt.num(p.n)}`).join(' · '),
  })),
)

const selectedId = ref<string | null>(null)
const selected = computed<ErrorGroup | null>(() => (data.value?.groups ?? []).find(g => keyOf(g) === selectedId.value) ?? null)

function onSelect(row: Row) {
  const id = String(row.id ?? '')
  selectedId.value = selectedId.value === id ? null : id
}

const series = computed<LineSeries[]>(() => [
  { key: 'errors', label: 'ERRORS', colorIndex: 1, points: (data.value?.series ?? []).map(p => ({ x: p.day, y: p.n })) },
])

function parsePayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function message(e: EventRow): string {
  const p = parsePayload(e.payload)
  if (!p) return e.name ?? '—'
  const msg = typeof p.msg === 'string' ? p.msg : typeof p.message === 'string' ? p.message : (e.name ?? '—')
  const src = typeof p.src === 'string' && p.src ? ` — ${p.src}` : ''
  const line = p.line !== undefined && p.line !== null ? `:${String(p.line)}` : ''
  return `${msg}${src}${line}`
}

const recentColumns: DataColumn[] = [
  { key: 'ts', label: 'TIME', format: v => fmt.dateTimeSec(v), numeric: true, align: 'left' },
  { key: 'type', label: 'TYPE' },
  { key: 'path', label: 'PATH', format: v => fmt.str(v), ellipsis: true },
  { key: 'message', label: 'MESSAGE', ellipsis: true },
]
const recentRows = computed<Row[]>(() => (data.value?.recent ?? []).map(e => ({ ...e, message: message(e) })))

const isEmpty = computed(() => Boolean(data.value) && (data.value?.groups.length ?? 0) === 0 && (data.value?.recent.length ?? 0) === 0)
</script>

<template>
  <div class="er">
    <FilterBar />

    <p v-if="error" class="er__fault">{{ opsFault(error, 'errors') }}</p>
    <p v-else-if="!data && status === 'pending'" class="er__poll label">... POLLING</p>

    <template v-if="data">
      <div class="er__stats">
        <StatCard label="ERRORS" :value="fmt.num(total)" :delta="prevTotal === null ? null : fmt.delta(total, prevTotal)" :lamp="total > 0 ? 'red' : 'off'" :pulse="false" />
        <StatCard label="GROUPS" :value="fmt.num(data.groups.length)" />
        <StatCard label="SESSIONS HIT" :value="fmt.num(sessionsHit)" hint="sum over groups — a session with two kinds counts twice" :to="linkTo('/ops/sessions', { intent: 'error' })" />
        <StatCard label="JS" :value="fmt.num(byKind.js)" />
        <StatCard label="RESOURCE" :value="fmt.num(byKind.resource)" />
        <StatCard label="CONSOLE" :value="fmt.num(byKind.console)" />
      </div>

      <div class="er__bar">
        <span class="er__note label">SAMPLE {{ fmt.num(data.sampled.n) }} / {{ fmt.num(data.sampled.total) }} NEWEST ERROR EVENTS · EXTENSION URLS SCRUBBED TO &lt;EXT&gt;</span>
        <ExportButton entity="events" />
      </div>

      <p v-if="isEmpty" class="er__empty label">NO DATA // ERRORS — CLEAN BOARD</p>

      <Panel title="ERRORS // GROUPED BY KIND · MESSAGE · SOURCE">
        <DataTable
          :columns="columns"
          :rows="rows"
          row-key="id"
          row-testid="error-row"
          :sort="{ key: 'n', dir: 'desc' }"
          empty="NO DATA // ERRORS"
          dense
          :limit="30"
          @select="onSelect"
        />
        <p class="er__note label">CLICK A ROW FOR THE SAMPLE STACK, BROWSERS AND PAGES</p>
      </Panel>

      <Panel v-if="selected" :title="`SAMPLE // ${selected.kind.toUpperCase()}`" teal>
        <div class="er__sample">
          <div class="er__sample-msg">{{ selected.msg }}</div>
          <div v-if="selected.src" class="er__sample-src label">{{ selected.src }}</div>
          <pre v-if="selected.sampleStack" class="er__stack">{{ selected.sampleStack }}</pre>
          <div v-else class="er__empty label">NO STACK CAPTURED</div>
          <div class="er__cols">
            <div>
              <div class="label er__colhead">BROWSERS</div>
              <BarRows :rows="selected.browsers" key-label="BROWSER" value-label="N" empty="NO DATA" />
            </div>
            <div>
              <div class="label er__colhead">PAGES</div>
              <BarRows :rows="selected.paths" key-label="PATH" value-label="N" empty="NO DATA" />
            </div>
          </div>
          <NuxtLink :to="`/ops/sessions/${selected.sampleSid}`" class="er__link label">SAMPLE SESSION {{ selected.sampleSid.slice(0, 8).toUpperCase() }} &rarr;</NuxtLink>
        </div>
      </Panel>

      <div class="er__grid">
        <Panel title="ERRORS // PER DAY" class="er__wide">
          <LineChart
            :series="series"
            aria-label="Error events per day"
            :y-format="(v: number) => fmt.kfmt(v)"
            :x-format="(x: string) => fmt.dayLabel(x)"
          />
        </Panel>

        <Panel title="RECENT // NEWEST 50" class="er__wide">
          <DataTable :columns="recentColumns" :rows="recentRows" row-key="id" :sort="{ key: 'ts', dir: 'desc' }" empty="NO DATA // RECENT" dense :limit="25" />
        </Panel>
      </div>
    </template>
  </div>
</template>

<style scoped>
.er {
  display: grid;
  gap: var(--space-4);
}

.er__poll {
  color: var(--text-faint);
}

.er__empty {
  color: var(--text-faint);
}

.er__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.er__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-2);
}

.er__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.er__note {
  margin-top: var(--space-2);
  color: var(--text-faint);
}

.er__sample {
  display: grid;
  gap: var(--space-2);
}

.er__sample-msg {
  color: var(--red);
  overflow-wrap: anywhere;
}

.er__sample-src {
  color: var(--text-dim);
  text-transform: none;
  overflow-wrap: anywhere;
}

.er__stack {
  max-height: 16rem;
  overflow: auto;
  padding: var(--space-2);
  background: var(--bg-0);
  border: 1px solid var(--hairline);
  font-size: var(--fs-micro);
  color: var(--text-dim);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.er__cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

@media (max-width: 560px) {
  .er__cols {
    grid-template-columns: 1fr;
  }
}

.er__colhead {
  margin-bottom: var(--space-2);
  color: var(--text-faint);
}

.er__link {
  color: var(--text-dim);
  justify-self: start;
}

.er__link:hover {
  color: var(--teal-hot);
  text-decoration: none;
}

.er__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-4) var(--space-3);
  align-items: start;
}

.er__wide {
  grid-column: 1 / -1;
}
</style>
