<script setup lang="ts">
import type { SessionDetail } from '#shared/analytics/ops'
import type { DataColumn } from '~/components/ops/DataTable.vue'
import type { StatusReadout } from '~/data/resume'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

const route = useRoute()
const sid = computed(() => String(route.params.id ?? ''))

useHead({ title: computed(() => `OPS // SESSION ${sid.value.slice(0, 8).toUpperCase()}`) })

const filters = useOpsFilters()
const fmt = useOpsFormat()
const { linkTo } = filters

type Row = Record<string, unknown>

const { data, status, error } = useOpsFetch<SessionDetail>(() => `/api/ops/sessions/${encodeURIComponent(sid.value)}`)

interface Group {
  title: string
  facts: StatusReadout[]
}

const has = (v: unknown) => v !== null && v !== undefined && v !== ''

function fact(label: string, value: unknown, lamp?: StatusReadout['lamp']): StatusReadout | null {
  if (!has(value)) return null
  return { label, value: fmt.str(value), ...(lamp ? { lamp } : {}) }
}

const groups = computed<Group[]>(() => {
  const d = data.value
  if (!d) return []
  const s = d.session
  const n = s.net
  const out: Group[] = []
  const push = (title: string, facts: (StatusReadout | null)[]) => {
    const f = facts.filter((x): x is StatusReadout => x !== null)
    if (f.length) out.push({ title, facts: f })
  }

  push('IDENTITY', [
    fact('SID', s.sid),
    fact('VID', s.vid),
    fact('STARTED', fmt.full(s.started_at)),
    fact('LAST SEEN', fmt.full(s.last_seen_at)),
    fact('VISIT #', s.visit_n),
    { label: 'RETURNING', value: fmt.yn(s.is_returning) },
    fact('EVENTS', s.events_n),
  ])

  const utm = [s.utm_source, s.utm_medium, s.utm_campaign, s.utm_term, s.utm_content].filter(Boolean).join(' / ')
  push('ARRIVAL', [
    fact('NAV KIND', s.nav_kind?.toUpperCase()),
    fact('SEC-FETCH-SITE', n?.fetch_site),
    fact('SEC-FETCH-MODE', n?.fetch_mode),
    fact('DOC REFERER', n?.doc_referer),
    fact('REFERRER', s.referrer),
    fact('UTM', utm || null),
    fact('ENTRY', s.entry_path),
    fact('EXIT', s.exit_path),
    fact('LAST PATH', s.last_path),
  ])

  push('GEO', [
    fact('COUNTRY', s.country),
    fact('REGION', s.region ? `${s.region}${n?.region_code ? ` (${n.region_code})` : ''}` : null),
    fact('CITY', s.city),
    fact('POSTAL', n?.postal_code),
    fact('METRO', n?.metro_code),
    fact('CONTINENT', n?.continent),
    n?.is_eu !== null && n?.is_eu !== undefined ? { label: 'EU', value: fmt.yn(n.is_eu) } : null,
    fact('COORDS', s.lat !== null && s.lon !== null ? `${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}` : null),
    fact('CLIENT TZ', s.tz),
    fact('CF TZ', n?.cf_tz),
    d.derived.tzMismatch ? { label: 'TZ OFFSET', value: 'MISMATCH // CLIENT ≠ CF (VPN?)', lamp: 'amber' } : null,
  ])

  const inputMode = [s.ptr_n ? `PTR ${fmt.num(s.ptr_n)}` : '', s.touch_n ? `TOUCH ${fmt.num(s.touch_n)}` : '', s.key_n ? `KEY ${fmt.num(s.key_n)}` : ''].filter(Boolean).join(' · ')
  push('ENGAGEMENT', [
    fact('PAGES', s.pageviews),
    { label: 'ACTIVE', value: `${fmt.mmss(d.derived.activeMs)} · Σ PAGE VISITS` },
    { label: 'HEARTBEAT TIME', value: `${fmt.mmss(s.duration_ms)} · 15 S STEPS` },
    fact('HIDDEN', fmt.mmss(s.hidden_ms)),
    fact('MAX SCROLL', `${s.max_scroll_pct}%`),
    fact('BLURS', s.blurs),
    fact('INPUT', inputMode || null),
    fact('FIRST INPUT', s.first_interaction_ms !== null ? fmt.ms(s.first_interaction_ms) : null),
    fact('OUTBOUND', s.outbounds),
    fact('HOVERS', s.hovers),
    fact('SUBTABS', s.subtabs),
  ])

  push('INTENT', [
    fact('PRINTS', s.prints),
    fact('COPIES', s.copies),
    fact('EMAIL COPIES', s.email_copies),
    fact('SELECTS', s.selects),
    fact('FORM', s.form_started ? `STARTED · ${s.form_submitted ? 'MAIL HANDOFF' : 'NO HANDOFF'}` : null),
    fact('MAILTO CLICKS', s.mailto_clicks),
    fact('FINDS', s.finds),
    fact('SEARCHES', s.searches),
    fact('EXIT INTENTS', s.exit_intents),
    fact('RAGE / DEAD', `${fmt.num(s.rage_clicks)} / ${fmt.num(s.dead_clicks)}`),
    fact('ERRORS', s.errors),
    fact('EGGS', s.eggs),
  ])

  const reason = d.derived.botReason
  push('FLAGS', [
    s.is_bot
      ? { label: 'BOT', value: `FLAGGED // ${reason ? reason.toUpperCase() : 'UNKNOWN REASON'}`, lamp: 'amber' }
      : { label: 'BOT', value: 'NO' },
    reason === 'honeypot' && d.derived.honeypotUa ? fact('HONEYPOT UA', d.derived.honeypotUa) : null,
    { label: 'WEBDRIVER', value: fmt.yn(s.is_webdriver), ...(s.is_webdriver ? { lamp: 'amber' as const } : {}) },
    { label: 'TOR', value: fmt.yn(s.is_tor), ...(s.is_tor ? { lamp: 'amber' as const } : {}) },
    { label: 'GPC', value: fmt.yn(s.gpc) },
    { label: 'DNT', value: fmt.yn(s.dnt) },
    { label: 'SAVE-DATA', value: fmt.yn(s.save_data) },
    s.has_replay ? { label: 'REPLAY', value: 'CAPTURED', lamp: 'teal' } : { label: 'REPLAY', value: 'NONE' },
  ])

  return out
})

const visitorFacts = computed<StatusReadout[]>(() => {
  const v = data.value?.visitor
  if (!v) return []
  return [
    { label: 'VISITS', value: fmt.num(v.visitCount) },
    { label: 'FIRST SEEN', value: fmt.full(v.firstSeen) },
    { label: 'LAST SEEN', value: fmt.full(v.lastSeen) },
    { label: 'OTHER SESSIONS', value: fmt.num(v.otherSessions) },
  ]
})

const perfColumns: DataColumn[] = [
  { key: 'ts', label: 'TIME', format: v => fmt.time(v), numeric: true, align: 'left' },
  { key: 'path', label: 'PATH', ellipsis: true },
  { key: 'nav_type', label: 'NAV', format: v => fmt.str(v).toUpperCase() },
  { key: 'ttfb_ms', label: 'TTFB', format: v => fmt.ms(v), numeric: true },
  { key: 'fcp_ms', label: 'FCP', format: v => fmt.ms(v), numeric: true },
  { key: 'lcp_ms', label: 'LCP', format: v => fmt.ms(v), numeric: true },
  { key: 'cls', label: 'CLS', format: v => (typeof v === 'number' ? v.toFixed(3) : '—'), numeric: true },
  { key: 'inp_ms', label: 'INP', format: v => fmt.ms(v), numeric: true },
  { key: 'dcl_ms', label: 'DCL', format: v => fmt.ms(v), numeric: true },
  { key: 'load_ms', label: 'LOAD', format: v => fmt.ms(v), numeric: true },
  { key: 'soft_nav_ms', label: 'SOFT NAV', format: v => fmt.ms(v), numeric: true },
  { key: 'protocol', label: 'PROTOCOL', format: v => fmt.str(v) },
  { key: 'transfer_bytes', label: 'TRANSFER', format: v => fmt.bytes(v), numeric: true },
  { key: 'res_count', label: 'RES', numeric: true },
  { key: 'res_bytes', label: 'RES BYTES', format: v => fmt.bytes(v), numeric: true },
  { key: 'long_tasks', label: 'LONG TASKS', numeric: true },
  { key: 'long_task_ms', label: 'LT MS', format: v => fmt.ms(v), numeric: true },
  { key: 'loaf_count', label: 'LOAF', numeric: true },
  { key: 'lcp_sel', label: 'LCP ELEMENT', format: v => fmt.str(v), ellipsis: true },
]
const perfRows = computed<Row[]>(() => (data.value?.perf ?? []) as unknown as Row[])

const timelineEvents = computed(() => data.value?.events ?? [])

/** IntentBadges folds the session's counters in; it takes a plain record. */
const badgeSession = computed<Record<string, unknown> | null>(
  () => (data.value?.session as unknown as Record<string, unknown> | undefined) ?? null,
)
</script>

<template>
  <div class="sd">
    <NuxtLink :to="linkTo('/ops/sessions')" class="sd__back label">&larr; SESSION LOG</NuxtLink>

    <p v-if="error" class="sd__fault">
      {{ error.statusCode === 404 ? 'UNKNOWN SESSION // NO RECORD' : opsFault(error, 'session') }}
    </p>
    <p v-else-if="!data && status === 'pending'" class="sd__poll label">... POLLING</p>

    <template v-if="data">
      <div class="sd__stats">
        <StatCard label="PAGES" :value="fmt.num(data.session.pageviews)" />
        <StatCard label="ACTIVE" :value="fmt.mmss(data.derived.activeMs)" sub="Σ PAGE VISITS" hint="Σ page_visits.active_ms — the one “active time”" />
        <StatCard label="HEARTBEAT TIME" :value="fmt.mmss(data.session.duration_ms)" sub="15 S STEPS" hint="heartbeat-quantised session length, never “active”" />
        <StatCard label="MAX SCROLL" :value="fmt.pct(data.session.max_scroll_pct, 0)" />
        <StatCard
          label="ORG"
          :value="data.session.as_org ?? '—'"
          :sub="data.session.asn ? `AS ${data.session.asn}` : undefined"
          :to="data.session.as_org ? linkTo('/ops/orgs/detail', { org: data.session.as_org }) : undefined"
        />
        <StatCard
          label="REPLAY"
          :value="data.session.has_replay ? 'CAPTURED' : 'NONE'"
          :lamp="data.session.has_replay ? 'teal' : 'off'"
          :pulse="false"
        />
      </div>

      <div class="sd__intent">
        <span class="label sd__intent-label">INTENT</span>
        <IntentBadges :flags="data.derived.intentFlags" :session="badgeSession" :replay="Boolean(data.session.has_replay)" />
      </div>

      <div class="sd__cols">
        <Panel :title="`SESSION // ${sid.slice(0, 8).toUpperCase()}`">
          <div class="sd__groups">
            <section v-for="g in groups" :key="g.title" class="sd__group">
              <div class="label sd__group-title">{{ g.title }}</div>
              <Readout v-for="r in g.facts" :key="r.label" :readout="r" />
            </section>
          </div>
        </Panel>

        <div class="sd__stack">
          <Panel title="VISITOR">
            <div v-if="!data.visitor" class="sd__empty label">NO VISITOR ROW</div>
            <template v-else>
              <Readout v-for="r in visitorFacts" :key="r.label" :readout="r" />
              <NuxtLink :to="`/ops/visitors/${data.session.vid}`" class="sd__link label">VISITOR HISTORY &rarr;</NuxtLink>
            </template>
          </Panel>

          <Panel title="PATH TIMELINE">
            <div v-if="data.pages.length === 0" class="sd__empty label">NO PAGE VISITS RECORDED</div>
            <PathTimeline
              v-else
              :pages="data.pages"
              :start-ts="data.session.started_at"
              :path-to="(p: string) => linkTo('/ops/pages/detail', { path: p })"
            />
          </Panel>
        </div>
      </div>

      <Panel title="ENVIRONMENT">
        <EnvPanel :session="data.session" :derived="data.derived" />
      </Panel>

      <Panel title="PERFORMANCE // PER DOCUMENT LOAD">
        <DataTable
          :columns="perfColumns"
          :rows="perfRows"
          row-key="pvid"
          :sort="{ key: 'ts', dir: 'asc' }"
          empty="NO PERF ROWS"
          dense
        />
      </Panel>

      <div class="sd__cols sd__cols--wide">
        <Panel title="EVENT TIMELINE">
          <EventTimeline
            :events="timelineEvents"
            :start-ts="data.session.started_at"
            :sid="sid"
            :next-after="data.nextAfter"
          />
        </Panel>
        <Panel title="REPLAY" :teal="Boolean(data.session.has_replay)">
          <ReplayPlayer v-if="data.session.has_replay" :sid="sid" />
          <div v-else class="sd__empty label">NO REPLAY // NOT SAMPLED OR NO SNAPSHOT RECEIVED</div>
        </Panel>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sd {
  display: grid;
  gap: var(--space-4);
}

.sd__back {
  color: var(--text-dim);
  justify-self: start;
}

.sd__back:hover {
  color: var(--teal-hot);
  text-decoration: none;
}

.sd__poll {
  color: var(--text-faint);
}

.sd__empty {
  color: var(--text-faint);
  padding: var(--space-2) 0;
}

.sd__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.sd__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-2);
}

.sd__intent {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.sd__intent-label {
  color: var(--text-faint);
}

.sd__cols {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: var(--space-3);
  align-items: start;
}

.sd__cols--wide {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

@media (max-width: 960px) {
  .sd__cols,
  .sd__cols--wide {
    grid-template-columns: 1fr;
  }
}

.sd__stack {
  display: grid;
  gap: var(--space-4);
}

.sd__groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--space-3) var(--space-4);
}

.sd__group-title {
  margin-bottom: var(--space-1);
  color: var(--text-faint);
}

.sd__link {
  display: inline-block;
  margin-top: var(--space-2);
  color: var(--text-dim);
}

.sd__link:hover {
  color: var(--teal-hot);
  text-decoration: none;
}
</style>
