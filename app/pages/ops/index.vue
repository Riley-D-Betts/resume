<script setup lang="ts">
import type { Aggregates, EventRow, Live, Overview, RecentSession } from '#shared/analytics/ops'
import type { OpsRange } from '#shared/analytics/ops'
import type { BarRow } from '~/components/ops/BarRows.vue'
import type { DataColumn } from '~/components/ops/DataTable.vue'
import type { LineSeries } from '~/components/ops/LineChart.vue'
import type { StatusReadout } from '~/data/resume'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

useHead({ title: 'OPS // OVERVIEW' })

const filters = useOpsFilters()
const fmt = useOpsFormat()
const { state, query, linkTo } = filters

type Row = Record<string, unknown>

const {
  data: overview,
  status: oStatus,
  error: oError,
  refresh: refreshOverview,
} = useOpsFetch<Overview>('/api/ops/overview', { query })

const { data: aggregates, status: aStatus, error: aError } = useOpsFetch<Aggregates>('/api/ops/aggregates', { query })

// The tiles should tick while the console is open (15 s, visible tab only).
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    void refreshOverview()
  }, 15_000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

// ACTIVE NOW prefers the live strip's 10 s poll over the 15 s overview.
const live = ref<Live | null>(null)
const activeNow = computed(() => live.value?.activeNow ?? overview.value?.activeNow ?? 0)

const compare = computed(() => state.value.compare && Boolean(overview.value?.prev))

/** Delta vs the previous period — only when COMPARE is on and the API sent `prev`. */
function d(cur: unknown, prev: unknown) {
  return compare.value ? fmt.delta(cur, prev) : null
}

const RANGE_WORD: Record<OpsRange, string> = {
  '24h': 'LAST 24 H',
  '7d': 'LAST 7 DAYS',
  '30d': 'LAST 30 DAYS',
  '90d': 'LAST 90 DAYS',
  all: 'ALL TIME (≤ 365 DAYS)',
  custom: 'CUSTOM RANGE',
}
const rangeWord = computed(() => RANGE_WORD[state.value.range] ?? state.value.range.toUpperCase())

// -- series -------------------------------------------------------------
const COLOR: Record<string, number> = { sessions: 1, pageviews: 2, visitors: 3 }

const lineSeries = computed<LineSeries[]>(() => {
  const s = overview.value?.series ?? []
  return [
    { key: 'sessions', label: 'SESSIONS', points: s.map(p => ({ x: p.day, y: p.sessions })) },
    { key: 'pageviews', label: 'PAGEVIEWS', points: s.map(p => ({ x: p.day, y: p.pageviews })) },
    { key: 'visitors', label: 'VISITORS', points: s.map(p => ({ x: p.day, y: p.visitors })) },
  ]
})

/** Every point at zero is NO DATA, not a flat line along the axis (R4-L14). */
const seriesEmpty = computed(() => {
  const s = overview.value?.series ?? []
  return s.length === 0 || s.every(p => p.sessions === 0 && p.pageviews === 0 && p.visitors === 0)
})

/** COMPARE dashes only the primary series (contract E.4). */
const linePrev = computed<LineSeries[]>(() => {
  const ps = compare.value ? (overview.value?.prevSeries ?? []) : []
  if (!ps.length) return []
  return [{ key: 'sessions', label: 'SESSIONS // PREV', points: ps.map(p => ({ x: p.day, y: p.sessions })) }]
})

// -- bar blocks ---------------------------------------------------------
const orgRows = computed<BarRow[]>(() =>
  (overview.value?.topOrgs ?? []).map(o => ({
    k: o.k,
    n: o.n,
    display: o.kind === 'org' ? fmt.num(o.n) : `${fmt.num(o.n)} · ${o.kind.toUpperCase()}`,
    title: `${o.k} · ${o.kind.toUpperCase()} · ${fmt.num(o.n)} sessions`,
    // '(unknown)' / '??' are placeholders, not filter values (R4-M9).
    to: o.k.startsWith('(') ? undefined : linkTo('/ops/orgs/detail', { org: o.k }),
  })),
)

/** Only a real path links / filters — `(unknown)` and `??` stay plain text (R4-M9). */
function pathRows(list: { k: string; n: number }[] | undefined): BarRow[] {
  return (list ?? []).map(p => ({ k: p.k, n: p.n, to: p.k.startsWith('/') ? linkTo('/ops/pages/detail', { path: p.k }) : undefined }))
}

const pageRows = computed(() => pathRows(overview.value?.topPages))
const entryRows = computed(() => pathRows(overview.value?.entryPaths))
const exitRows = computed(() => pathRows(overview.value?.exitPaths))

const referrerRows = computed<BarRow[]>(() =>
  (overview.value?.referrers ?? []).map(r => ({
    k: r.k,
    n: r.n,
    to: r.k.startsWith('(') ? undefined : linkTo('/ops/sessions', { q: r.k }),
  })),
)

function filterRows(list: { k: string; n: number }[] | undefined, key: 'country' | 'device' | 'browser' | 'os'): BarRow[] {
  return (list ?? []).map(r => ({ k: r.k, n: r.n, to: r.k.startsWith('(') ? undefined : linkTo('/ops/sessions', { [key]: r.k }) }))
}

const countryRows = computed(() => filterRows(aggregates.value?.countries, 'country'))
const cityRows = computed(() => filterRows(aggregates.value?.cities, 'country'))
const deviceRows = computed(() => filterRows(aggregates.value?.devices, 'device'))
const browserRows = computed(() => filterRows(aggregates.value?.browsers, 'browser'))
const osRows = computed(() => filterRows(aggregates.value?.os, 'os'))
const langRows = computed<BarRow[]>(() => aggregates.value?.languagesRanked?.length ? aggregates.value.languagesRanked : (aggregates.value?.languages ?? []))

// -- segments -----------------------------------------------------------
const segmentColumns: DataColumn[] = [
  { key: 'dim', label: 'DIM', format: v => String(v).replace('referrerHost', 'referrer').toUpperCase() },
  { key: 'key', label: 'KEY', ellipsis: true },
  { key: 'sessions', label: 'SESSIONS' },
  { key: 'engagedPct', label: 'ENGAGED %', format: v => fmt.pct(v, 1), title: '≥ 2 pages, or ≥ 60 s active, or a mail handoff / mailto click' },
  { key: 'avgActiveMs', label: 'AVG ACTIVE', format: v => fmt.mmss(v), numeric: true },
  { key: 'contactPct', label: 'CONTACT %', format: v => fmt.pct(v, 1), title: 'mail handoff or mailto click' },
]

const segmentRows = computed<Row[]>(() => (aggregates.value?.segments ?? []) as unknown as Row[])

function segmentTo(row: Row): string | null {
  const key = String(row.key ?? '')
  if (!key || key.startsWith('(')) return null
  switch (row.dim) {
    case 'device':
      return linkTo('/ops/sessions', { device: key })
    case 'browser':
      return linkTo('/ops/sessions', { browser: key })
    case 'country':
      return linkTo('/ops/sessions', { country: key })
    case 'referrerHost':
      return linkTo('/ops/sessions', { q: key })
    default:
      return null
  }
}

// -- intent mini-tiles --------------------------------------------------
const intentTiles = computed(() => {
  const i = overview.value?.intent
  if (!i) return []
  return [
    { label: 'PRINTS', value: i.prints, flag: 'print' },
    { label: 'COPIES', value: i.copies, flag: 'copy' },
    { label: 'EMAIL COPIES', value: i.emailCopies, flag: 'email' },
    { label: 'SELECTS', value: i.selects, flag: '' },
    { label: 'FINDS', value: i.finds, flag: 'find' },
    { label: 'SEARCHES', value: i.searches, flag: 'search' },
    { label: 'EXIT INTENTS', value: i.exitIntents, flag: 'exit' },
    { label: 'RAGE', value: i.rageClicks, flag: 'rage' },
    { label: 'DEAD', value: i.deadClicks, flag: 'dead' },
    { label: 'FORM STARTED', value: i.formStarted, flag: 'form' },
  ]
})

// -- errors -------------------------------------------------------------
function parsePayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function errLine(e: EventRow): string {
  const p = parsePayload(e.payload)
  if (!p) return e.name ?? '(no payload)'
  const msg = typeof p.msg === 'string' ? p.msg : typeof p.message === 'string' ? p.message : (e.name ?? '(no message)')
  const src = typeof p.src === 'string' && p.src ? ` — ${p.src}` : ''
  const line = p.line !== undefined && p.line !== null ? `:${String(p.line)}` : ''
  return `${msg}${src}${line}`
}

// -- recent sessions ----------------------------------------------------
function geo(s: RecentSession): string {
  const parts = [s.country ?? '??']
  if (s.city) parts.push(s.city)
  return parts.join(' / ')
}

// -- storage readouts ---------------------------------------------------
const storage = computed<StatusReadout[]>(() => {
  const o = overview.value
  if (!o) return []
  return [
    { label: 'D1 SESSIONS', value: fmt.num(o.d1.sessions) },
    { label: 'D1 EVENTS', value: `≈ ${fmt.num(o.d1.eventsApprox)}` },
    { label: 'D1 PAGE VISITS', value: `≈ ${fmt.num(o.d1.pageVisitsApprox)}` },
    { label: 'D1 SIZE', value: o.d1.sizeBytes === null ? '— (PRAGMA UNAVAILABLE)' : fmt.bytes(o.d1.sizeBytes) },
    { label: 'R2 REPLAYS', value: `${fmt.num(o.replay.count)} IN RANGE` },
    { label: 'R2 BYTES', value: fmt.bytes(o.replay.bytes) },
  ]
})
</script>

<template>
  <div class="ov">
    <FilterBar />

    <LiveStrip :bots="state.bots" @live="(l: Live) => (live = l)" />

    <p v-if="oError" class="ov__fault">{{ opsFault(oError, 'overview') }}</p>
    <p v-else-if="!overview && oStatus === 'pending'" class="ov__poll label">... POLLING</p>

    <template v-if="overview">
      <!-- tiles -->
      <div class="ov__stats">
        <StatCard
          label="SESSIONS"
          :value="fmt.num(overview.stats.sessions)"
          :sub="`${fmt.num(overview.stats.visitsToday)} STARTED TODAY`"
          :delta="d(overview.stats.sessions, overview.prev?.sessions)"
          :to="linkTo('/ops/sessions')"
        />
        <StatCard
          label="VISITORS"
          :value="fmt.num(overview.stats.visitors)"
          :delta="d(overview.stats.visitors, overview.prev?.visitors)"
          :to="linkTo('/ops/visitors')"
        />
        <StatCard
          label="RETURNING %"
          :value="fmt.pct(overview.stats.returningPct, 1)"
          :delta="d(overview.stats.returningPct, overview.prev?.returningPct)"
          hint="sessions flagged returning ÷ sessions"
          :to="linkTo('/ops/visitors', { returning: '1' })"
        />
        <StatCard
          label="PAGEVIEWS"
          :value="fmt.num(overview.stats.pageviews)"
          :delta="d(overview.stats.pageviews, overview.prev?.pageviews)"
          :to="linkTo('/ops/pages')"
        />
        <StatCard
          label="AVG ACTIVE"
          :value="fmt.mmss(overview.stats.avgActiveMs)"
          sub="MM:SS · Σ PAGE VISITS"
          :delta="d(overview.stats.avgActiveMs, overview.prev?.avgActiveMs)"
          hint="Σ page_visits.active_ms per session, averaged"
        />
        <StatCard
          label="BOUNCE %"
          :value="fmt.pct(overview.stats.bounceRate, 1)"
          :delta="d(overview.stats.bounceRate, overview.prev?.bounceRate)"
          hint="single-page sessions with under 15 s active"
        />
        <StatCard
          label="MAIL HANDOFFS"
          :value="fmt.num(overview.stats.mailHandoffs)"
          :delta="d(overview.stats.mailHandoffs, overview.prev?.mailHandoffs)"
          hint="contact form composed a mailto (never “sent”)"
          :to="linkTo('/ops/intent')"
        />
        <StatCard
          label="MAILTO CLICKS"
          :value="fmt.num(overview.stats.mailtoClicks)"
          :delta="d(overview.stats.mailtoClicks, overview.prev?.mailtoClicks)"
          :to="linkTo('/ops/intent')"
        />
        <StatCard
          label="EMAIL COPIES"
          :value="fmt.num(overview.stats.emailCopies)"
          :delta="d(overview.stats.emailCopies, overview.prev?.emailCopies)"
          :to="linkTo('/ops/intent')"
        />
        <StatCard
          label="ACTIVE NOW"
          :value="fmt.num(activeNow)"
          sub="INPUT IN LAST 60 S"
          :lamp="activeNow > 0 ? 'green' : 'off'"
          :pulse="activeNow > 0"
        />
        <StatCard
          label="REPLAYS"
          :value="fmt.num(overview.replay.count)"
          :sub="`${fmt.bytes(overview.replay.bytes)} IN R2`"
          :lamp="overview.replay.count > 0 ? 'teal' : 'off'"
          :to="linkTo('/ops/sessions', { replay: '1' })"
        />
      </div>

      <!-- per-day series -->
      <Panel :title="`SESSIONS // ${rangeWord}`" class="ov__block">
        <div v-if="seriesEmpty" class="ov__empty label">NO DATA // SESSIONS</div>
        <Sparkline v-else :data="overview.series" :aria-label="`Sessions per day, ${rangeWord.toLowerCase()}`" />
      </Panel>

      <div class="ov__grid">
        <Panel title="SESSIONS · PAGEVIEWS · VISITORS // PER DAY" class="ov__wide">
          <div v-if="seriesEmpty" class="ov__empty label">NO DATA // OVERVIEW</div>
          <LineChart
            v-else
            :series="lineSeries"
            :prev="linePrev"
            :color-index="COLOR"
            aria-label="Sessions, pageviews and visitors per day"
            :y-format="(v: number) => fmt.kfmt(v)"
            :x-format="(x: string) => fmt.dayLabel(x)"
          />
        </Panel>

        <Panel title="SESSIONS // DAY × HOUR" class="ov__wide">
          <Heatmap :heat="overview.heatmap" aria-label="Sessions by weekday and hour" />
        </Panel>

        <Panel title="TOP ORGANIZATIONS">
          <BarRows :rows="orgRows" table-toggle fold-other key-label="ORG" value-label="SESSIONS" empty="NO DATA // ORGS" />
        </Panel>

        <Panel title="TOP PAGES">
          <BarRows :rows="pageRows" table-toggle fold-other key-label="PATH" value-label="PAGEVIEWS" empty="NO DATA // PAGES" />
        </Panel>

        <Panel title="REFERRERS // BY HOST">
          <BarRows :rows="referrerRows" table-toggle fold-other key-label="HOST" value-label="SESSIONS" empty="NO DATA // REFERRERS" />
        </Panel>

        <Panel title="ENTRY → EXIT PATHS">
          <div class="ov__cols">
            <div>
              <div class="label ov__colhead">ENTRY</div>
              <BarRows :rows="entryRows" key-label="PATH" value-label="SESSIONS" empty="NO DATA // ENTRY" />
            </div>
            <div>
              <div class="label ov__colhead">EXIT</div>
              <BarRows :rows="exitRows" key-label="PATH" value-label="SESSIONS" empty="NO DATA // EXIT" />
            </div>
          </div>
        </Panel>
      </div>
    </template>

    <p v-if="aError" class="ov__fault">{{ opsFault(aError, 'aggregates') }}</p>
    <p v-else-if="!aggregates && aStatus === 'pending'" class="ov__poll label">... POLLING</p>

    <div v-if="aggregates" class="ov__grid">
      <Panel title="GEO">
        <div class="ov__cols">
          <div>
            <div class="label ov__colhead">COUNTRIES</div>
            <BarRows :rows="countryRows" fold-other empty="NO DATA // GEO" />
          </div>
          <div>
            <div class="label ov__colhead">CITIES</div>
            <BarRows :rows="cityRows" fold-other empty="NO DATA // GEO" />
          </div>
        </div>
      </Panel>

      <Panel title="DEVICE / BROWSER / OS / LANG">
        <div class="ov__cols ov__cols--4">
          <div>
            <div class="label ov__colhead">DEVICE</div>
            <BarRows :rows="deviceRows" empty="NO DATA" />
          </div>
          <div>
            <div class="label ov__colhead">BROWSER</div>
            <BarRows :rows="browserRows" fold-other empty="NO DATA" />
          </div>
          <div>
            <div class="label ov__colhead">OS</div>
            <BarRows :rows="osRows" fold-other empty="NO DATA" />
          </div>
          <div>
            <div class="label ov__colhead">LANG</div>
            <BarRows :rows="langRows" fold-other empty="NO DATA" />
          </div>
        </div>
      </Panel>

      <Panel title="SEGMENTS // ENGAGEMENT BY DEVICE · BROWSER · COUNTRY · REFERRER" class="ov__wide">
        <DataTable
          :columns="segmentColumns"
          :rows="segmentRows"
          :sort="{ key: 'sessions', dir: 'desc' }"
          :row-key="(r: Row) => `${String(r.dim)}:${String(r.key)}`"
          :row-to="segmentTo"
          empty="NO DATA // SEGMENTS"
          dense
          :limit="16"
        />
        <p class="ov__note label">SAMPLE {{ fmt.num(aggregates.sampled.n) }} / {{ fmt.num(aggregates.sampled.total) }} NEWEST SESSIONS</p>
      </Panel>
    </div>

    <template v-if="overview">
      <Panel title="INTENT // SIGNALS IN RANGE" class="ov__block">
        <div class="ov__mini">
          <StatCard
            v-for="t in intentTiles"
            :key="t.label"
            :label="t.label"
            :value="fmt.num(t.value)"
            testid="intent-card"
            :to="linkTo('/ops/intent', t.flag ? { intent: t.flag } : {})"
          />
          <StatCard
            label="ERRORS"
            :value="fmt.num(overview.errors.total)"
            :lamp="overview.errors.total > 0 ? 'red' : 'off'"
            :pulse="false"
            sub="JS · RESOURCE · CONSOLE"
            hint="errors counted at ingest (session counters; the ERRORS page samples events)"
            testid="intent-card"
            :to="linkTo('/ops/errors')"
          />
        </div>
      </Panel>

      <div class="ov__grid">
        <Panel title="RECENT SESSIONS" class="ov__wide">
          <div v-if="overview.recent.length === 0" class="ov__empty label">NO DATA // SESSIONS</div>
          <div v-else class="ov__recent-head label">
            <span>TIME</span>
            <span>ORG</span>
            <span>GEO</span>
            <span>CLIENT</span>
            <span>ENTRY</span>
            <span class="ov__num">PAGES</span>
            <span class="ov__num">ACTIVE</span>
            <span>INTENT</span>
            <span />
          </div>
          <NuxtLink
            v-for="s in overview.recent"
            :key="s.sid"
            :to="linkTo(`/ops/sessions/${s.sid}`)"
            class="ov__recent"
          >
            <span class="ov__recent-t">{{ fmt.dateTime(s.startedAt) }}</span>
            <span class="ov__recent-cell" :title="s.asOrg ?? ''">{{ s.asOrg ?? '—' }}</span>
            <span class="ov__recent-cell">{{ geo(s) }}</span>
            <span class="ov__recent-cell ov__recent-dim">{{ s.deviceType ?? '?' }} · {{ s.browser ?? '?' }}</span>
            <span class="ov__recent-cell ov__recent-dim" :title="s.entryPath ?? ''">{{ s.entryPath ?? '—' }}</span>
            <span class="ov__recent-t ov__num">{{ fmt.num(s.pageviews) }}</span>
            <span class="ov__recent-t ov__num">{{ fmt.mmss(s.activeMs) }}</span>
            <span class="ov__recent-cell"><IntentBadges :flags="s.intent" :webdriver="false" :max="4" /></span>
            <span class="ov__recent-flags label">
              <span v-if="s.isBot">BOT</span>
              <StatusLamp :color="s.hasReplay ? 'teal' : 'off'" :pulse="false" />
            </span>
          </NuxtLink>
        </Panel>

        <Panel title="ERRORS // NEWEST" class="ov__wide">
          <details class="ov__errors" :open="overview.errors.total > 0">
            <summary class="label">
              {{ fmt.num(overview.errors.total) }} FAULT{{ overview.errors.total === 1 ? '' : 'S' }} IN RANGE
              <span v-if="overview.errors.recent.length < overview.errors.total"> · NEWEST {{ overview.errors.recent.length }} SHOWN</span>
            </summary>
            <div v-if="overview.errors.recent.length === 0" class="label ov__empty">CLEAN BOARD</div>
            <div v-for="e in overview.errors.recent" :key="e.id" class="ov__error">
              <span class="ov__recent-t">{{ fmt.dateTimeSec(e.ts) }}</span>
              <span class="ov__recent-t">{{ e.type }}</span>
              <span class="ov__recent-dim" :title="e.path ?? ''">{{ e.path ?? '' }}</span>
              <span class="ov__error-msg">{{ errLine(e) }}</span>
            </div>
            <NuxtLink :to="linkTo('/ops/errors')" class="ov__more label">GROUPED VIEW →</NuxtLink>
          </details>
        </Panel>

        <Panel title="STORAGE // D1 · R2">
          <div class="ov__readouts">
            <Readout v-for="r in storage" :key="r.label" :readout="r" />
          </div>
          <p class="ov__note label">≈ COUNTS ARE MAX(ROWID); D1 CAP 500 MB</p>
        </Panel>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ov {
  display: grid;
  gap: var(--space-4);
}

.ov__poll {
  color: var(--text-faint);
}

.ov__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.ov__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-2);
}

.ov__mini {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: var(--space-2);
}

.ov__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-4) var(--space-3);
  align-items: start;
}

.ov__wide {
  grid-column: 1 / -1;
}

.ov__cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.ov__cols--4 {
  grid-template-columns: repeat(4, 1fr);
}

@media (max-width: 860px) {
  .ov__cols--4 {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 560px) {
  .ov__cols,
  .ov__cols--4 {
    grid-template-columns: 1fr;
  }
}

.ov__colhead {
  margin-bottom: var(--space-2);
  color: var(--text-faint);
}

.ov__empty {
  color: var(--text-faint);
  padding: var(--space-2) 0;
}

.ov__note {
  margin-top: var(--space-2);
  color: var(--text-faint);
}

.ov__num {
  text-align: right;
}

.ov__recent-head,
.ov__recent {
  display: grid;
  grid-template-columns: 6.5em minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.8fr) 3.5em 4.5em minmax(0, 1fr) 3.5em;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--hairline);
  font-size: var(--fs-data);
}

.ov__recent-head {
  color: var(--text-faint);
  border-bottom-color: var(--hairline-lit);
}

.ov__recent {
  color: var(--text);
}

.ov__recent:hover {
  text-decoration: none;
  background: var(--bg-2);
}

.ov__recent-t {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.ov__recent-cell {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ov__recent-dim {
  color: var(--text-dim);
}

.ov__recent-flags {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  color: var(--amber);
}

@media (max-width: 860px) {
  .ov__recent-head,
  .ov__recent {
    grid-template-columns: 6.5em minmax(0, 1fr) minmax(0, 1fr) 3.5em 3.5em;
  }

  .ov__recent-head :nth-child(3),
  .ov__recent-head :nth-child(4),
  .ov__recent-head :nth-child(5),
  .ov__recent-head :nth-child(8),
  .ov__recent :nth-child(3),
  .ov__recent :nth-child(4),
  .ov__recent :nth-child(5),
  .ov__recent :nth-child(8) {
    display: none;
  }
}

.ov__errors summary {
  cursor: pointer;
  color: var(--text-dim);
  list-style: none;
}

.ov__errors summary::before {
  content: '▸ ';
  color: var(--red);
}

.ov__errors[open] summary::before {
  content: '▾ ';
}

.ov__error {
  display: grid;
  grid-template-columns: auto auto minmax(0, 0.6fr) minmax(0, 2fr);
  gap: var(--space-3);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--hairline);
  font-size: var(--fs-micro);
}

.ov__error-msg {
  color: var(--red);
  overflow-wrap: anywhere;
}

.ov__more {
  display: inline-block;
  margin-top: var(--space-2);
  color: var(--text-dim);
}

.ov__more:hover {
  color: var(--teal-hot);
  text-decoration: none;
}

.ov__readouts {
  display: grid;
  column-gap: var(--space-4);
}
</style>
