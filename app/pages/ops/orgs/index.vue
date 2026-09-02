<script setup lang="ts">
import type { Orgs } from '#shared/analytics/ops'
import type { DataColumn, SortState } from '~/components/ops/DataTable.vue'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

useHead({ title: 'OPS // ORGS' })

const filters = useOpsFilters()
const fmt = useOpsFormat()
const { state, query, linkTo } = filters

type Row = Record<string, unknown>

/** Keys the API can order by; every other column sorts locally over the ≤ 200 rows returned. */
const SERVER_SORTS = new Set(['lastSeen', 'sessions', 'visitors'])
const initial = state.value.sort && SERVER_SORTS.has(state.value.sort) ? state.value.sort : 'lastSeen'
const sort = ref<SortState>({ key: initial, dir: state.value.dir === 'asc' ? 'asc' : 'desc' })

const q = computed(() => ({ ...query.value, sort: sort.value.key, dir: sort.value.dir }))

const { data, status, error } = useOpsFetch<Orgs>('/api/ops/orgs', { query: q })

const compare = computed(() => state.value.compare && (data.value?.orgs ?? []).some(o => o.prevSessions !== undefined))

function onSort(s: SortState) {
  if (SERVER_SORTS.has(s.key)) sort.value = s
}

const columns = computed<DataColumn[]>(() => {
  const cols: DataColumn[] = [
    { key: 'kind', label: 'KIND', format: v => String(v).toUpperCase(), width: '5em' },
    { key: 'org', label: 'ORGANIZATION', ellipsis: true },
    { key: 'sessions', label: 'SESSIONS' },
  ]
  if (compare.value) {
    cols.push({
      key: 'prevSessions',
      label: 'PREV',
      title: 'sessions in the previous period · change',
      numeric: true,
      format: (v, row) => {
        const d = fmt.delta(row.sessions, v)
        return d ? `${fmt.num(v)} · ${d.text}` : fmt.num(v)
      },
    })
  }
  cols.push(
    { key: 'visitors', label: 'VISITORS' },
    { key: 'returningVisitors', label: 'RETURNING', title: 'visitors whose sessions were flagged returning' },
    { key: 'pageviews', label: 'PAGES READ' },
    { key: 'avgActiveMs', label: 'AVG ACTIVE', format: v => fmt.mmss(v), numeric: true },
    { key: 'mailHandoffs', label: 'MAIL', title: 'mail handoffs (form composed a mailto)' },
    { key: 'mailtoClicks', label: 'MAILTO' },
    { key: 'emailCopies', label: 'EMAIL COPY' },
    { key: 'prints', label: 'PRINT' },
    { key: 'countries', label: 'COUNTRIES', sortable: false },
    { key: 'cities', label: 'CITIES', sortable: false },
    { key: 'firstSeen', label: 'FIRST SEEN', format: v => fmt.dateTime(v), numeric: true, align: 'left' },
    { key: 'lastSeen', label: 'LAST SEEN', format: v => fmt.dateTime(v), numeric: true, align: 'left' },
    { key: 'hasReplay', label: 'REPLAY', format: v => (v ? 'YES' : 'NO'), align: 'center' },
    { key: 'asns', label: 'ASN', format: v => (Array.isArray(v) && v.length ? v.join(', ') : '—'), sortable: false, ellipsis: true },
    { key: 'rdnsHosts', label: 'RDNS', format: v => (Array.isArray(v) && v.length ? v.join(' ') : '—'), sortable: false, ellipsis: true },
  )
  return cols
})

const rows = computed<Row[]>(() => (data.value?.orgs ?? []) as unknown as Row[])

function orgTo(row: Row): string {
  return linkTo('/ops/orgs/detail', { org: String(row.org ?? '') })
}

function sessionsTo(row: Row): string {
  return linkTo('/ops/sessions', { org: String(row.org ?? '') })
}

function chips(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : []
}
</script>

<template>
  <div class="og">
    <FilterBar show-hide-isp />

    <p v-if="error" class="og__fault">{{ opsFault(error, 'orgs') }}</p>
    <p v-else-if="!data && status === 'pending'" class="og__poll label">... POLLING</p>

    <template v-if="data">
      <div class="og__bar">
        <span class="og__note label">
          {{ fmt.num(data.orgs.length) }} ORGANIZATION{{ data.orgs.length === 1 ? '' : 'S' }} · GROUPED BY AS ORGANIZATION
          <template v-if="state.hideIsp"> · ISP / CLOUD HIDDEN</template>
        </span>
        <ExportButton entity="sessions" />
      </div>

      <Panel title="ORGANIZATIONS // WHO IS LOOKING">
        <DataTable
          :columns="columns"
          :rows="rows"
          row-key="org"
          row-testid="org-row"
          :sort="sort"
          :row-to="orgTo"
          empty="NO DATA // ORGS"
          dense
          @sort="onSort"
        >
          <template #cell-kind="{ value }">
            <span class="og__kind label" :class="`og__kind--${String(value)}`">{{ String(value).toUpperCase() }}</span>
          </template>
          <template #cell-sessions="{ row, value }">
            <NuxtLink :to="sessionsTo(row)" class="og__link" :title="`sessions from ${String(row.org)}`" @click.stop>{{ fmt.num(value) }}</NuxtLink>
          </template>
          <template #cell-countries="{ value }">
            <span class="og__chips">
              <span v-for="c in chips(value)" :key="c" class="og__chip label">{{ c }}</span>
              <span v-if="chips(value).length === 0">—</span>
            </span>
          </template>
          <template #cell-cities="{ value }">
            <span class="og__chips">
              <span v-for="c in chips(value)" :key="c" class="og__chip label">{{ c }}</span>
              <span v-if="chips(value).length === 0">—</span>
            </span>
          </template>
          <template #cell-hasReplay="{ value }">
            <StatusLamp :color="value ? 'teal' : 'off'" :pulse="false" />
          </template>
        </DataTable>
        <p class="og__note label">
          KIND = ORG · ISP · CLOUD · UNKNOWN FROM THE AS NAME · SORT BY SESSIONS / VISITORS / LAST SEEN IS SERVER-SIDE, OTHERS SORT THE PAGE
        </p>
      </Panel>
    </template>
  </div>
</template>

<style scoped>
.og {
  display: grid;
  gap: var(--space-4);
}

.og__poll {
  color: var(--text-faint);
}

.og__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.og__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.og__note {
  margin-top: var(--space-2);
  color: var(--text-faint);
}

.og__kind {
  display: inline-block;
  padding: 0 var(--space-1);
  border: 1px solid var(--hairline-lit);
  color: var(--text-dim);
  line-height: 1.6;
}

.og__kind--org {
  border-color: var(--teal);
  color: var(--teal-hot);
}

.og__link {
  color: var(--teal-hot);
}

.og__chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.og__chip {
  padding: 0 var(--space-1);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
  line-height: 1.6;
  white-space: nowrap;
}
</style>
