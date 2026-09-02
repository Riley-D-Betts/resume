<script setup lang="ts">
import type { EventRow, PageVisitRow, SessionRow, VisitorDetail } from '#shared/analytics/ops'
import type { DataColumn } from '~/components/ops/DataTable.vue'
import type { StatusReadout } from '~/data/resume'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

const route = useRoute()
const vid = computed(() => String(route.params.vid ?? ''))

useHead({ title: computed(() => `OPS // VISITOR ${vid.value.slice(0, 8).toUpperCase()}`) })

const filters = useOpsFilters()
const fmt = useOpsFormat()
const { linkTo } = filters

type Row = Record<string, unknown>

const { data, status, error } = useOpsFetch<VisitorDetail>(() => `/api/ops/visitors/${encodeURIComponent(vid.value)}`)

const facts = computed<StatusReadout[]>(() => {
  const v = data.value?.visitor
  if (!v) return []
  return [
    { label: 'VID', value: v.vid },
    { label: 'FIRST SEEN', value: fmt.full(v.first_seen_at) },
    { label: 'LAST SEEN', value: fmt.full(v.last_seen_at) },
    { label: 'VISITS', value: fmt.num(v.visit_count) },
    { label: 'FIRST ORG', value: fmt.str(v.first_as_org) },
    { label: 'LAST ORG', value: fmt.str(v.last_as_org) },
    { label: 'FIRST COUNTRY', value: fmt.str(v.first_country) },
    { label: 'LAST COUNTRY', value: fmt.str(v.last_country) },
    { label: 'FIRST ENTRY', value: fmt.str(v.first_entry_path) },
    { label: 'FIRST REFERRER', value: fmt.str(v.first_referrer) },
    { label: 'FIRST UTM', value: [v.first_utm_source, v.first_utm_medium, v.first_utm_campaign].filter(Boolean).join(' / ') || '—' },
  ]
})

// Totals over the sessions returned (≤ 100 newest).
const totals = computed(() => {
  const ss = data.value?.sessions ?? []
  const sum = (f: (s: SessionRow) => number) => ss.reduce((a, s) => a + f(s), 0)
  return {
    sessions: ss.length,
    activeMs: sum(s => s.active_ms),
    pageviews: sum(s => s.pageviews),
    prints: sum(s => s.prints),
    copies: sum(s => s.copies),
    emailCopies: sum(s => s.email_copies),
    mailHandoffs: sum(s => s.form_submitted),
    mailtoClicks: sum(s => s.mailto_clicks),
    finds: sum(s => s.finds),
    searches: sum(s => s.searches),
    replays: sum(s => s.has_replay),
  }
})

const sessionColumns: DataColumn[] = [
  { key: 'started_at', label: 'TIME', format: v => fmt.dateTime(v), numeric: true, align: 'left' },
  { key: 'visit_n', label: 'VISIT #' },
  { key: 'as_org', label: 'ORG', format: v => fmt.str(v), ellipsis: true },
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

/** Page visits grouped per session (newest session first), for one PathTimeline each. */
const timelines = computed(() => {
  const bySid = new Map<string, PageVisitRow[]>()
  for (const pv of data.value?.pageVisits ?? []) {
    const list = bySid.get(pv.sid) ?? []
    list.push(pv)
    bySid.set(pv.sid, list)
  }
  return (data.value?.sessions ?? [])
    .filter(s => bySid.has(s.sid))
    .map(s => ({ sid: s.sid, startedAt: s.started_at, pages: bySid.get(s.sid) ?? [] }))
})

function parsePayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function compact(e: EventRow): string {
  const p = parsePayload(e.payload)
  if (!p) return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined || v === '' || typeof v === 'object') continue
    parts.push(`${k}=${String(v)}`)
    if (parts.length >= 5) break
  }
  return parts.join(' · ')
}

const intentColumns: DataColumn[] = [
  { key: 'ts', label: 'TIME', format: v => fmt.dateTimeSec(v), numeric: true, align: 'left' },
  { key: 'type', label: 'TYPE' },
  { key: 'name', label: 'NAME', format: v => fmt.str(v), ellipsis: true },
  { key: 'path', label: 'PATH', format: v => fmt.str(v), ellipsis: true },
  { key: 'detail', label: 'PAYLOAD', ellipsis: true, sortable: false },
]
const intentRows = computed<Row[]>(() => (data.value?.intents ?? []).map(e => ({ ...e, detail: compact(e) })))

const isEmpty = computed(() => Boolean(data.value) && (data.value?.sessions.length ?? 0) === 0)
</script>

<template>
  <div class="vd">
    <NuxtLink :to="linkTo('/ops/visitors')" class="vd__back label">&larr; VISITORS</NuxtLink>

    <p v-if="error" class="vd__fault">
      {{ error.statusCode === 404 ? 'UNKNOWN VISITOR // NO RECORD' : opsFault(error, 'visitor') }}
    </p>
    <p v-else-if="!data && status === 'pending'" class="vd__poll label">... POLLING</p>

    <template v-if="data">
      <div class="vd__stats">
        <StatCard label="VISITS" :value="fmt.num(data.visitor.visit_count)" :sub="`${fmt.num(totals.sessions)} SESSIONS LOADED`" />
        <StatCard label="TOTAL ACTIVE" :value="fmt.mmss(totals.activeMs)" sub="MM:SS · Σ PAGE VISITS" />
        <StatCard label="PAGES READ" :value="fmt.num(totals.pageviews)" />
        <StatCard label="LAST SEEN" :value="fmt.ago(data.visitor.last_seen_at)" sub="AGO" />
        <StatCard label="MAIL HANDOFFS" :value="fmt.num(totals.mailHandoffs)" hint="contact form composed a mailto" />
        <StatCard label="MAILTO CLICKS" :value="fmt.num(totals.mailtoClicks)" />
        <StatCard label="EMAIL COPIES" :value="fmt.num(totals.emailCopies)" />
        <StatCard label="PRINTS" :value="fmt.num(totals.prints)" />
        <StatCard label="COPIES" :value="fmt.num(totals.copies)" />
        <StatCard label="FINDS / SEARCHES" :value="`${fmt.num(totals.finds)} / ${fmt.num(totals.searches)}`" />
        <StatCard label="REPLAYS" :value="fmt.num(totals.replays)" :lamp="totals.replays > 0 ? 'teal' : 'off'" :pulse="false" />
      </div>

      <p v-if="isEmpty" class="vd__empty label">NO DATA // VISITOR {{ vid.slice(0, 8).toUpperCase() }}</p>

      <Panel :title="`VISITOR // ${vid.slice(0, 8).toUpperCase()}`">
        <div class="vd__meta">
          <Readout v-for="r in facts" :key="r.label" :readout="r" />
        </div>
      </Panel>

      <Panel title="SESSIONS // NEWEST 100">
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

      <Panel title="PATH TIMELINES // PER SESSION">
        <div v-if="timelines.length === 0" class="vd__empty label">NO PAGE VISITS RECORDED</div>
        <div v-for="t in timelines" :key="t.sid" class="vd__timeline">
          <NuxtLink :to="`/ops/sessions/${t.sid}`" class="vd__tl-head label">
            {{ fmt.full(t.startedAt) }} · SESSION {{ t.sid.slice(0, 8).toUpperCase() }} · {{ t.pages.length }} PAGE{{ t.pages.length === 1 ? '' : 'S' }}
          </NuxtLink>
          <PathTimeline :pages="t.pages" :start-ts="t.startedAt" :path-to="(p: string) => linkTo('/ops/pages/detail', { path: p })" />
        </div>
      </Panel>

      <Panel title="INTENT EVENTS // NEWEST 200">
        <DataTable
          :columns="intentColumns"
          :rows="intentRows"
          row-key="id"
          :sort="{ key: 'ts', dir: 'desc' }"
          empty="NO INTENT EVENTS"
          dense
          :limit="40"
        />
      </Panel>
    </template>
  </div>
</template>

<style scoped>
.vd {
  display: grid;
  gap: var(--space-4);
}

.vd__back {
  color: var(--text-dim);
  justify-self: start;
}

.vd__back:hover {
  color: var(--teal-hot);
  text-decoration: none;
}

.vd__poll {
  color: var(--text-faint);
}

.vd__empty {
  color: var(--text-faint);
  padding: var(--space-2) 0;
}

.vd__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.vd__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-2);
}

.vd__meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  column-gap: var(--space-4);
}

.vd__timeline {
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--hairline);
}

.vd__timeline:last-child {
  border-bottom: none;
}

.vd__tl-head {
  display: block;
  margin-bottom: var(--space-1);
  color: var(--text-dim);
}

.vd__tl-head:hover {
  color: var(--teal-hot);
  text-decoration: none;
}
</style>
