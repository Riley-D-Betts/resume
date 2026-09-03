<script setup lang="ts">
import type { Intent, SessionRow } from '#shared/analytics/ops'
import type { BarRow } from '~/components/ops/BarRows.vue'
import type { DataColumn } from '~/components/ops/DataTable.vue'
import type { FunnelStepRow } from '~/components/ops/FunnelSteps.vue'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

useHead({ title: 'OPS // INTENT' })

const filters = useOpsFilters()
const fmt = useOpsFormat()
const { state, query, linkTo } = filters

type Row = Record<string, unknown>

const { data, status, error } = useOpsFetch<Intent>('/api/ops/intent', { query })

const compare = computed(() => state.value.compare && Boolean(data.value?.prev))

function d(cur: unknown, prev: unknown) {
  return compare.value ? fmt.delta(cur, prev) : null
}

const tiles = computed(() => {
  const t = data.value?.tiles
  const p = data.value?.prev
  if (!t) return []
  const row = (label: string, key: keyof typeof t, flag: string, hint?: string) => ({
    label,
    value: t[key],
    prev: p?.[key],
    flag,
    hint,
  })
  return [
    row('PRINTS', 'prints', 'print'),
    row('COPIES', 'copies', 'copy'),
    row('EMAIL COPIES', 'emailCopies', 'email', 'copied text containing the email address'),
    row('SELECTS', 'selects', ''),
    row('FINDS', 'finds', 'find', 'Ctrl / ⌘ + F'),
    row('SITE SEARCHES', 'searches', 'search'),
    row('EXIT INTENTS', 'exitIntents', 'exit'),
    row('RAGE CLICKS', 'rageClicks', 'rage'),
    row('DEAD CLICKS', 'deadClicks', 'dead'),
    row('FORM STARTED', 'formStarted', 'form'),
    row('MAIL HANDOFFS', 'mailHandoffs', 'submit', 'contact form composed a mailto (never “sent”)'),
    row('MAILTO CLICKS', 'mailtoClicks', 'email'),
  ]
})

// -- form funnel ---------------------------------------------------------
const STEP_LABEL: Record<string, string> = { focus: 'FOCUS', input: 'INPUT', field: 'FIELD', submit: 'MAIL HANDOFF' }
const MAIN_STEPS = ['focus', 'input', 'field', 'submit']
const ASIDE_STEPS = ['invalid', 'reset', 'abandon']

const funnel = computed<FunnelStepRow[]>(() => {
  const m = new Map((data.value?.formFunnel ?? []).map(f => [f.step, f.sessions]))
  return MAIN_STEPS.map(s => ({ label: STEP_LABEL[s] ?? s.toUpperCase(), n: m.get(s) ?? 0 }))
})

const funnelAside = computed<FunnelStepRow[]>(() => {
  const list = data.value?.formFunnel ?? []
  const known = new Set(MAIN_STEPS)
  return list.filter(f => !known.has(f.step)).sort((a, b) => ASIDE_STEPS.indexOf(a.step) - ASIDE_STEPS.indexOf(b.step)).map(f => ({ label: f.step.toUpperCase(), n: f.sessions }))
})

// -- bar blocks ----------------------------------------------------------
const subjectRows = computed<BarRow[]>(() => data.value?.subjects ?? [])
const searchRows = computed<BarRow[]>(() => data.value?.searches ?? [])
/** `(unknown)` / `??` rows are placeholders: plain text, never a path filter (R4-M9). */
function pageRows(list: { k: string; n: number }[] | undefined): BarRow[] {
  return (list ?? []).map(f => ({ k: f.k, n: f.n, to: f.k.startsWith('/') ? linkTo('/ops/pages/detail', { path: f.k }) : undefined }))
}

const findRows = computed<BarRow[]>(() => pageRows(data.value?.finds))
const exitRows = computed<BarRow[]>(() => pageRows(data.value?.exitByPage))
const hoverRows = computed<BarRow[]>(() =>
  (data.value?.hoverKeys ?? []).map(h => ({ k: h.key, n: h.n, display: `${fmt.num(h.n)} · avg ${fmt.ms(h.avgMs)}` })),
)

// -- tables --------------------------------------------------------------
const copyColumns: DataColumn[] = [
  { key: 'ts', label: 'WHEN', format: v => fmt.dateTimeSec(v), numeric: true, align: 'left' },
  { key: 'who', label: 'ORG / COUNTRY', ellipsis: true },
  { key: 'path', label: 'PAGE', format: v => fmt.str(v), ellipsis: true },
  { key: 'section', label: 'SECTION', format: v => fmt.str(v) },
  { key: 'snippet', label: 'SNIPPET', ellipsis: true },
  { key: 'hasEmail', label: 'EMAIL', format: v => (v ? 'EMAIL' : ''), align: 'center' },
]
const copyRows = computed<Row[]>(() =>
  (data.value?.copies ?? []).map((c, i) => ({
    ...c,
    id: `${c.sid}:${c.ts}:${i}`,
    who: [c.org, c.country].filter(Boolean).join(' / ') || '—',
  })),
)

const selColumns: DataColumn[] = [
  { key: 'sel', label: 'SELECTOR', ellipsis: true },
  { key: 'text', label: 'TEXT', ellipsis: true },
  { key: 'n', label: 'N' },
]
const rageRows = computed<Row[]>(() => (data.value?.rage ?? []) as unknown as Row[])
const deadRows = computed<Row[]>(() => (data.value?.dead ?? []) as unknown as Row[])

const printColumns: DataColumn[] = [
  { key: 'ts', label: 'WHEN', format: v => fmt.dateTimeSec(v), numeric: true, align: 'left' },
  { key: 'org', label: 'ORG', format: v => fmt.str(v), ellipsis: true },
  { key: 'path', label: 'PAGE', format: v => fmt.str(v), ellipsis: true },
  { key: 'sid', label: 'SESSION', format: v => String(v).slice(0, 8).toUpperCase() },
]
const printRows = computed<Row[]>(() => (data.value?.prints ?? []).map((p, i) => ({ ...p, id: `${p.sid}:${p.ts}:${i}` })))

const sessionColumns: DataColumn[] = [
  { key: 'started_at', label: 'TIME', format: v => fmt.dateTime(v), numeric: true, align: 'left' },
  { key: 'as_org', label: 'ORG', format: v => fmt.str(v), ellipsis: true },
  { key: 'geo', label: 'GEO', ellipsis: true },
  { key: 'client', label: 'CLIENT', ellipsis: true },
  { key: 'entry_path', label: 'ENTRY', format: v => fmt.str(v), ellipsis: true },
  { key: 'active_ms', label: 'ACTIVE', format: v => fmt.mmss(v), numeric: true },
  { key: 'pageviews', label: 'PAGES' },
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
  })),
)

const isEmpty = computed(() => {
  const t = data.value?.tiles
  if (!t) return false
  return Object.values(t).every(v => v === 0) && (data.value?.sessions.length ?? 0) === 0
})
</script>

<template>
  <div class="it">
    <FilterBar />

    <p v-if="error" class="it__fault">{{ opsFault(error, 'intent') }}</p>
    <p v-else-if="!data && status === 'pending'" class="it__poll label">... POLLING</p>

    <template v-if="data">
      <div class="it__stats">
        <StatCard
          v-for="t in tiles"
          :key="t.label"
          :label="t.label"
          :value="fmt.num(t.value)"
          :delta="d(t.value, t.prev)"
          :hint="t.hint"
          testid="intent-card"
          :to="t.flag ? linkTo('/ops/sessions', { intent: t.flag }) : undefined"
        />
      </div>

      <p v-if="isEmpty" class="it__empty label">NO DATA // INTENT</p>

      <div class="it__bar">
        <span class="it__note label">TILES = EVENTS IN RANGE · CLICK A TILE FOR THE SESSIONS WITH THAT FLAG</span>
        <ExportButton entity="events" />
      </div>

      <div class="it__grid">
        <Panel title="CONTACT FORM // FOCUS → INPUT → FIELD → MAIL HANDOFF" class="it__wide">
          <FunnelSteps :steps="funnel" :aside="funnelAside" aside-label="ALSO" />
          <p class="it__note label">DISTINCT SESSIONS PER STEP · MAIL HANDOFF = THE PAGE COMPOSED A MAILTO — DELIVERY IS NEVER OBSERVED</p>
        </Panel>

        <Panel title="FORM SUBJECTS">
          <BarRows :rows="subjectRows" table-toggle fold-other key-label="SUBJECT" value-label="SESSIONS" empty="NO DATA // SUBJECTS" />
        </Panel>

        <Panel title="HOVER KEYS // ATTENTION">
          <BarRows :rows="hoverRows" table-toggle key-label="KEY" value-label="HOVERS" empty="NO DATA // HOVERS" />
        </Panel>

        <Panel title="COPIES // WHO COPIED WHAT" class="it__wide">
          <DataTable
            :columns="copyColumns"
            :rows="copyRows"
            row-key="id"
            :sort="{ key: 'ts', dir: 'desc' }"
            :row-to="(r: Row) => linkTo(`/ops/sessions/${String(r.sid)}`)"
            empty="NO DATA // COPIES"
            dense
            :limit="30"
          >
            <template #cell-hasEmail="{ value }">
              <span v-if="value" class="it__word label">EMAIL</span>
            </template>
          </DataTable>
          <p class="it__note label">SNIPPETS ARE ≤ 80 CHARS, NEVER FROM INPUTS</p>
        </Panel>

        <Panel title="SITE SEARCHES">
          <BarRows :rows="searchRows" table-toggle fold-other key-label="TERM" value-label="N" empty="NO DATA // SEARCHES" />
        </Panel>

        <Panel title="FIND IN PAGE // BY PAGE">
          <BarRows :rows="findRows" fold-other key-label="PATH" value-label="N" empty="NO DATA // FINDS" />
        </Panel>

        <Panel title="EXIT INTENTS // BY PAGE">
          <BarRows :rows="exitRows" fold-other key-label="PATH" value-label="N" empty="NO DATA // EXIT INTENTS" />
        </Panel>

        <Panel title="RAGE CLICKS // BY SELECTOR">
          <DataTable :columns="selColumns" :rows="rageRows" :sort="{ key: 'n', dir: 'desc' }" empty="NO DATA // RAGE" dense :limit="15" />
        </Panel>

        <Panel title="DEAD CLICKS // BY SELECTOR">
          <DataTable :columns="selColumns" :rows="deadRows" :sort="{ key: 'n', dir: 'desc' }" empty="NO DATA // DEAD" dense :limit="15" />
        </Panel>

        <Panel title="PRINTS">
          <DataTable
            :columns="printColumns"
            :rows="printRows"
            row-key="id"
            :sort="{ key: 'ts', dir: 'desc' }"
            :row-to="(r: Row) => linkTo(`/ops/sessions/${String(r.sid)}`)"
            empty="NO DATA // PRINTS"
            dense
            :limit="15"
          />
        </Panel>

        <Panel title="SESSIONS WITH ANY INTENT FLAG // NEWEST 100" class="it__wide">
          <DataTable
            :columns="sessionColumns"
            :rows="sessionRows"
            row-key="sid"
            row-testid="session-row"
            :sort="{ key: 'started_at', dir: 'desc' }"
            :row-to="(r: Row) => linkTo(`/ops/sessions/${String(r.sid)}`)"
            empty="NO DATA // SESSIONS"
            dense
            :limit="25"
          >
            <template #cell-intent="{ row }">
              <IntentBadges :session="row" :max="6" />
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
.it {
  display: grid;
  gap: var(--space-4);
}

.it__poll {
  color: var(--text-faint);
}

.it__empty {
  color: var(--text-faint);
}

.it__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.it__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--space-2);
}

.it__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.it__note {
  margin-top: var(--space-2);
  color: var(--text-faint);
}

.it__word {
  padding: 0 var(--space-1);
  border: 1px solid var(--hairline-lit);
  color: var(--text);
}

.it__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-4) var(--space-3);
  align-items: start;
}

.it__wide {
  grid-column: 1 / -1;
}
</style>
