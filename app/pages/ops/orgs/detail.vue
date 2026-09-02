<script setup lang="ts">
import type { OrgDetail, SessionRow } from '#shared/analytics/ops'
import type { BarRow } from '~/components/ops/BarRows.vue'
import type { DataColumn } from '~/components/ops/DataTable.vue'
import type { OpsFetchError, OpsFetchStatus } from '~/composables/useOpsFetch'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

const filters = useOpsFilters()
const fmt = useOpsFormat()
const { state, query, linkTo } = filters

type Row = Record<string, unknown>

/** `?org=` is the shared ORG filter, so the URL round-trips through useOpsFilters. */
const org = computed(() => state.value.org)

useHead({ title: computed(() => (org.value ? `OPS // ORG ${org.value}` : 'OPS // ORG')) })

// Manual fetch: no request while no org is selected (the API 400s without one).
const data = ref<OrgDetail | null>(null)
const status = ref<OpsFetchStatus>('idle')
const error = ref<OpsFetchError | null>(null)
let seq = 0

async function load() {
  if (!org.value) {
    data.value = null
    status.value = 'idle'
    error.value = null
    return
  }
  const my = ++seq
  status.value = 'pending'
  try {
    const res = await opsFetch<OrgDetail>('/api/ops/orgs/detail', { query: query.value })
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

const spark = computed(() => (data.value?.series ?? []).map(p => ({ day: p.day, n: p.sessions })))

const pageRows = computed<BarRow[]>(() =>
  (data.value?.pages ?? []).map(p => ({ k: p.k, n: p.n, to: linkTo('/ops/pages/detail', { path: p.k }) })),
)
const countryRows = computed<BarRow[]>(() =>
  (data.value?.countries ?? []).map(c => ({ k: c.k, n: c.n, to: c.k.startsWith('(') ? undefined : linkTo('/ops/sessions', { country: c.k }) })),
)
const rdnsRows = computed<BarRow[]>(() => data.value?.rdnsHosts ?? [])

const intentTiles = computed(() => {
  const i = data.value?.intent
  if (!i) return []
  return [
    { label: 'PRINTS', value: i.prints },
    { label: 'COPIES', value: i.copies },
    { label: 'EMAIL COPIES', value: i.emailCopies },
    { label: 'FINDS', value: i.finds },
    { label: 'SEARCHES', value: i.searches },
    { label: 'EXIT INTENTS', value: i.exitIntents },
    { label: 'RAGE', value: i.rageClicks },
    { label: 'DEAD', value: i.deadClicks },
    { label: 'FORM STARTED', value: i.formStarted },
  ]
})

const visitorColumns: DataColumn[] = [
  { key: 'vid', label: 'VISITOR', format: v => String(v).slice(0, 8).toUpperCase() },
  { key: 'sessions', label: 'SESSIONS' },
  { key: 'firstSeen', label: 'FIRST SEEN', format: v => fmt.dateTime(v), numeric: true, align: 'left' },
  { key: 'lastSeen', label: 'LAST SEEN', format: v => fmt.dateTime(v), numeric: true, align: 'left' },
]
const visitorRows = computed<Row[]>(() => (data.value?.visitors ?? []) as unknown as Row[])

const sessionColumns: DataColumn[] = [
  { key: 'started_at', label: 'TIME', format: v => fmt.dateTime(v), numeric: true, align: 'left' },
  { key: 'geo', label: 'GEO', ellipsis: true },
  { key: 'client', label: 'CLIENT', ellipsis: true },
  { key: 'route', label: 'ENTRY → EXIT', ellipsis: true },
  { key: 'active_ms', label: 'ACTIVE', format: v => fmt.mmss(v), numeric: true },
  { key: 'pageviews', label: 'PAGES' },
  { key: 'max_scroll_pct', label: 'SCROLL %', format: v => fmt.pct(v, 0) },
  { key: 'intent', label: 'INTENT', sortable: false },
  { key: 'has_replay', label: 'REPLAY', format: v => (v ? 'YES' : 'NO'), align: 'center' },
]

function geo(s: SessionRow): string {
  const parts = [s.country ?? '??']
  if (s.city) parts.push(s.city)
  return parts.join(' / ')
}

const sessionRows = computed<Row[]>(() =>
  (data.value?.sessions ?? []).map(s => ({
    ...s,
    geo: geo(s),
    client: `${s.device_type ?? '?'} · ${s.browser ?? '?'}`,
    route: `${s.entry_path ?? '—'} → ${s.exit_path ?? s.last_path ?? '—'}`,
  })),
)

const isEmpty = computed(() => Boolean(data.value) && (data.value?.totals.sessions ?? 0) === 0)
</script>

<template>
  <div class="od">
    <FilterBar show-hide-isp />

    <div class="od__bar">
      <NuxtLink :to="linkTo('/ops/orgs', { org: null })" class="od__back label">&larr; ORGANIZATIONS</NuxtLink>
      <NuxtLink v-if="org" :to="linkTo('/ops/sessions', { org })" class="od__back label">ALL SESSIONS FROM THIS ORG &rarr;</NuxtLink>
    </div>

    <p v-if="!org" class="od__empty label">NO ORG SELECTED // PICK ONE FROM THE ORG FILTER OR THE ORGS TABLE</p>

    <p v-if="error" class="od__fault">{{ opsFault(error, `org ${org}`) }}</p>
    <p v-else-if="!data && status === 'pending'" class="od__poll label">... POLLING</p>

    <template v-if="data">
      <div class="od__head">
        <span class="od__kind label" :class="`od__kind--${data.kind}`">{{ data.kind.toUpperCase() }}</span>
        <h1 class="od__name">{{ data.org }}</h1>
        <span v-if="data.asns.length" class="od__asn label">AS {{ data.asns.join(' · ') }}</span>
        <ExportButton entity="sessions" />
      </div>

      <p v-if="isEmpty" class="od__empty label">NO DATA // ORG {{ org }}</p>

      <div class="od__stats">
        <StatCard label="SESSIONS" :value="fmt.num(data.totals.sessions)" :to="linkTo('/ops/sessions', { org })" />
        <StatCard label="VISITORS" :value="fmt.num(data.totals.visitors)" />
        <StatCard label="RETURNING %" :value="fmt.pct(data.totals.returningPct, 1)" />
        <StatCard label="PAGEVIEWS" :value="fmt.num(data.totals.pageviews)" />
        <StatCard label="AVG ACTIVE" :value="fmt.mmss(data.totals.avgActiveMs)" sub="MM:SS · Σ PAGE VISITS" />
        <StatCard label="BOUNCE %" :value="fmt.pct(data.totals.bounceRate, 1)" />
        <StatCard label="MAIL HANDOFFS" :value="fmt.num(data.totals.mailHandoffs)" hint="contact form composed a mailto" />
        <StatCard label="MAILTO CLICKS" :value="fmt.num(data.totals.mailtoClicks)" />
        <StatCard label="EMAIL COPIES" :value="fmt.num(data.totals.emailCopies)" />
      </div>

      <Panel title="SESSIONS // PER DAY">
        <Sparkline :data="spark" :aria-label="`Sessions per day from ${data.org}`" />
      </Panel>

      <Panel title="INTENT // SIGNALS FROM THIS ORG">
        <div class="od__mini">
          <StatCard v-for="t in intentTiles" :key="t.label" :label="t.label" :value="fmt.num(t.value)" testid="intent-card" />
        </div>
      </Panel>

      <div class="od__grid">
        <Panel title="PAGES READ">
          <BarRows :rows="pageRows" table-toggle fold-other key-label="PATH" value-label="VISITS" empty="NO DATA // PAGES" />
        </Panel>
        <Panel title="COUNTRIES">
          <BarRows :rows="countryRows" fold-other key-label="COUNTRY" value-label="SESSIONS" empty="NO DATA // COUNTRIES" />
        </Panel>
        <Panel title="RDNS HOSTS">
          <BarRows :rows="rdnsRows" fold-other key-label="HOST" value-label="SESSIONS" empty="NO RDNS // DISABLED OR NO PTR RECORD" />
        </Panel>

        <Panel title="VISITORS" class="od__wide">
          <DataTable
            :columns="visitorColumns"
            :rows="visitorRows"
            row-key="vid"
            row-testid="visitor-row"
            :sort="{ key: 'lastSeen', dir: 'desc' }"
            :row-to="(r: Row) => `/ops/visitors/${String(r.vid)}`"
            empty="NO DATA // VISITORS"
            dense
            :limit="20"
          />
        </Panel>

        <Panel title="SESSIONS // NEWEST 100" class="od__wide">
          <DataTable
            :columns="sessionColumns"
            :rows="sessionRows"
            row-key="sid"
            row-testid="session-row"
            :sort="{ key: 'started_at', dir: 'desc' }"
            :row-to="(r: Row) => `/ops/sessions/${String(r.sid)}`"
            empty="NO DATA // SESSIONS"
            dense
            :limit="25"
          >
            <template #cell-intent="{ row }">
              <IntentBadges :session="row" :max="5" />
            </template>
            <template #cell-has_replay="{ value }">
              <StatusLamp :color="value ? 'teal' : 'off'" :pulse="false" />
            </template>
          </DataTable>
        </Panel>
      </div>
    </template>
  </div>
</template>

<style scoped>
.od {
  display: grid;
  gap: var(--space-4);
}

.od__bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-2);
}

.od__back {
  color: var(--text-dim);
}

.od__back:hover {
  color: var(--teal-hot);
  text-decoration: none;
}

.od__poll {
  color: var(--text-faint);
}

.od__empty {
  color: var(--text-faint);
}

.od__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.od__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
}

.od__name {
  font-size: var(--fs-body);
  font-weight: normal;
  color: var(--text);
  overflow-wrap: anywhere;
}

.od__kind {
  display: inline-block;
  padding: 0 var(--space-1);
  border: 1px solid var(--hairline-lit);
  color: var(--text-dim);
  line-height: 1.6;
}

.od__kind--org {
  border-color: var(--teal);
  color: var(--teal-hot);
}

.od__asn {
  color: var(--text-faint);
}

.od__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-2);
}

.od__mini {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: var(--space-2);
}

.od__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-4) var(--space-3);
  align-items: start;
}

.od__wide {
  grid-column: 1 / -1;
}
</style>
