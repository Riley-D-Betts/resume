<script setup lang="ts">
import type { Flows } from '#shared/analytics/ops'
import type { DataColumn } from '~/components/ops/DataTable.vue'
import type { FunnelStepRow } from '~/components/ops/FunnelSteps.vue'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

useHead({ title: 'OPS // FLOWS' })

const filters = useOpsFilters()
const fmt = useOpsFormat()
const { query, linkTo } = filters

type Row = Record<string, unknown>

const DEPTHS = [2, 3, 4, 5] as const
const depth = ref<number>(3)

const q = computed(() => ({ ...query.value, depth: String(depth.value) }))

const { data, status, error } = useOpsFetch<Flows>('/api/ops/flows', { query: q })

const STEP_LABEL: Record<string, string> = {
  'entered': 'ENTERED',
  'viewed /contact': 'VIEWED /CONTACT',
  'form focus': 'FORM FOCUS',
  'mail handoff': 'MAIL HANDOFF',
}

const funnel = computed<FunnelStepRow[]>(() =>
  (data.value?.funnel ?? []).map(f => ({ label: STEP_LABEL[f.step] ?? f.step.toUpperCase(), n: f.sessions })),
)

const edgeColumns: DataColumn[] = [
  { key: 'from', label: 'FROM', ellipsis: true },
  { key: 'to', label: 'TO', ellipsis: true },
  { key: 'n', label: 'TRANSITIONS' },
]
const edgeRows = computed<Row[]>(() => (data.value?.edges ?? []) as unknown as Row[])

function edgeTo(row: Row): string | null {
  const to = String(row.to ?? '')
  const from = String(row.from ?? '')
  const target = !to.startsWith('(') ? to : !from.startsWith('(') ? from : ''
  return target ? linkTo('/ops/pages/detail', { path: target }) : null
}

const seqColumns: DataColumn[] = [
  { key: 'seqText', label: 'SEQUENCE', ellipsis: true },
  { key: 'n', label: 'SESSIONS' },
]
const seqRows = computed<Row[]>(() =>
  (data.value?.sequences ?? []).map(s => ({ seqText: s.seq.join(' › '), n: s.n, first: s.seq[0] ?? '' })),
)

const isEmpty = computed(() => {
  const d = data.value
  return Boolean(d) && (d?.edges.length ?? 0) === 0 && (d?.sequences.length ?? 0) === 0 && (d?.funnel[0]?.sessions ?? 0) === 0
})
</script>

<template>
  <div class="fl">
    <FilterBar :show-compare="false" />

    <p v-if="error" class="fl__fault">{{ opsFault(error, 'flows') }}</p>
    <p v-else-if="!data && status === 'pending'" class="fl__poll label">... POLLING</p>

    <template v-if="data">
      <div class="fl__bar">
        <div class="fl__depths" role="group" aria-label="Sequence depth">
          <span class="label fl__depth-label">SEQUENCE DEPTH</span>
          <button
            v-for="n in DEPTHS"
            :key="n"
            type="button"
            class="fl__chip label"
            :class="{ 'fl__chip--on': depth === n }"
            :aria-pressed="depth === n"
            @click="depth = n"
          >
            {{ n }}
          </button>
        </div>
        <span class="fl__note label">
          SAMPLED // {{ fmt.num(data.sampled.sids) }} OF {{ fmt.num(data.sampled.total) }} NEWEST SESSIONS
        </span>
      </div>

      <p v-if="isEmpty" class="fl__empty label">NO DATA // FLOWS</p>

      <div class="fl__grid">
        <Panel title="FUNNEL // ENTERED → /CONTACT → FORM FOCUS → MAIL HANDOFF" class="fl__wide">
          <FunnelSteps :steps="funnel" />
          <p class="fl__note label">DISTINCT SESSIONS PER STEP · MAIL HANDOFF = FORM SUBMIT OR MAILTO CLICK (NEVER “SENT”)</p>
        </Panel>

        <Panel title="EDGES // PATH → PATH">
          <DataTable
            :columns="edgeColumns"
            :rows="edgeRows"
            :row-key="(r: Row) => `${String(r.from)}→${String(r.to)}`"
            :sort="{ key: 'n', dir: 'desc' }"
            :row-to="edgeTo"
            empty="NO DATA // EDGES"
            dense
            :limit="30"
          />
          <p class="fl__note label">(ENTRY) = LANDING · (EXIT) = LAST PAGE OF THE SESSION</p>
        </Panel>

        <Panel :title="`TOP SEQUENCES // FIRST ${depth} PAGES`">
          <DataTable
            :columns="seqColumns"
            :rows="seqRows"
            row-key="seqText"
            :sort="{ key: 'n', dir: 'desc' }"
            :row-to="(r: Row) => (r.first ? linkTo('/ops/pages/detail', { path: String(r.first) }) : null)"
            empty="NO DATA // SEQUENCES"
            dense
          />
          <p class="fl__note label">CONSECUTIVE DUPLICATES COLLAPSED · TOP 20</p>
        </Panel>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fl {
  display: grid;
  gap: var(--space-4);
}

.fl__poll {
  color: var(--text-faint);
}

.fl__empty {
  color: var(--text-faint);
}

.fl__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.fl__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.fl__depths {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.fl__depth-label {
  margin-right: var(--space-2);
  color: var(--text-faint);
}

.fl__chip {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
  transition: border-color 0.2s, color 0.2s;
}

.fl__chip:hover {
  border-color: var(--hairline-lit);
  color: var(--text);
}

.fl__chip--on {
  border-color: var(--teal);
  color: var(--teal-hot);
}

.fl__note {
  margin-top: var(--space-2);
  color: var(--text-faint);
}

.fl__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-4) var(--space-3);
  align-items: start;
}

.fl__wide {
  grid-column: 1 / -1;
}
</style>
