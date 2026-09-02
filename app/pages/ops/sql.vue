<script setup lang="ts">
import type { ExportEntity, SqlResult } from '#shared/analytics/ops'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

useHead({ title: 'OPS // SQL' })

const fmt = useOpsFormat()

const ENTITIES: ExportEntity[] = ['sessions', 'visitors', 'page_visits', 'page_perf', 'events']

/** SchemaBrowser `insert` → SqlConsole `insert` (exposed). */
const sqlConsole = ref<{ insert: (text: string) => void; setSql: (text: string) => void; run: (explain?: boolean) => Promise<void> } | null>(null)

function onInsert(text: string) {
  sqlConsole.value?.insert(text)
}

const last = ref<SqlResult | null>(null)
function onRan(r: SqlResult) {
  last.value = r
}
</script>

<template>
  <div class="sq">
    <FilterBar :show-q="false" :show-compare="false" :show-intent="false" />

    <p class="sq__note label">
      READ-ONLY // SELECT · WITH · EXPLAIN QUERY PLAN — WRAPPED IN A LIMIT, 10 S TIMEOUT, ROWS-WRITTEN CANARY · THE FILTER BAR ONLY SCOPES THE EXPORTS BELOW
    </p>

    <div class="sq__cols">
      <Panel title="SCHEMA // ≈ ROW COUNTS">
        <SchemaBrowser @insert="onInsert" />
      </Panel>
      <Panel title="SQL CONSOLE">
        <SqlConsole ref="sqlConsole" @ran="onRan" />
        <p v-if="last" class="sq__note label">
          LAST RUN // {{ fmt.num(last.rowCount) }} ROW{{ last.rowCount === 1 ? '' : 'S' }} · {{ fmt.num(last.durationMs) }} MS
          <template v-if="last.rowsRead !== null"> · {{ fmt.num(last.rowsRead) }} ROWS READ</template>
          <template v-if="last.truncated"> · TRUNCATED AT LIMIT</template>
          <template v-if="last.explain"> · EXPLAIN</template>
        </p>
      </Panel>
    </div>

    <Panel title="EXPORT // CURRENT FILTERS · ≤ 200 000 ROWS · ASSEMBLED IN THE BROWSER">
      <div class="sq__exports">
        <div v-for="e in ENTITIES" :key="e" class="sq__export">
          <span class="sq__entity label">{{ e.toUpperCase() }}</span>
          <ExportButton :entity="e" format="csv" label="CSV" />
          <ExportButton :entity="e" format="ndjson" label="NDJSON" />
        </div>
      </div>
      <p class="sq__note label">SERVER PAGES ≤ 1 000 ROWS VIA X-RB-NEXT CURSORS · CSV HEADER ONCE · FORMULA CELLS DEFUSED</p>
    </Panel>
  </div>
</template>

<style scoped>
.sq {
  display: grid;
  gap: var(--space-4);
}

.sq__note {
  color: var(--text-faint);
}

.sq__cols {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(0, 3fr);
  gap: var(--space-4) var(--space-3);
  align-items: start;
}

@media (max-width: 860px) {
  .sq__cols {
    grid-template-columns: 1fr;
  }
}

.sq__exports {
  display: grid;
  gap: var(--space-2);
}

.sq__export {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--hairline);
}

.sq__export:last-child {
  border-bottom: none;
}

.sq__entity {
  min-width: 9em;
  color: var(--text-dim);
}
</style>
