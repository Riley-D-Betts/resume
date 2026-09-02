<script setup lang="ts">
import type { Schema, SchemaTable } from '#shared/analytics/ops'

/**
 * Tables → columns / indexes from `/api/ops/schema`, with `≈ n` row
 * estimates (MAX(rowid), so a label, not a count). Clicking a table emits a
 * `SELECT * FROM <table>` template; clicking a column emits its name.
 */
withDefaults(defineProps<{ testid?: string }>(), { testid: 'sql-schema' })

const emit = defineEmits<{ insert: [text: string] }>()

const fmt = useOpsFormat()
const { data, status, error, refresh } = useOpsFetch<Schema>('/api/ops/schema')

const open = ref<Set<string>>(new Set())

function toggle(name: string) {
  const s = new Set(open.value)
  if (s.has(name)) s.delete(name)
  else s.add(name)
  open.value = s
}

function rowsOf(t: SchemaTable & { rows?: number }): number | null {
  const v = t.rowsApprox ?? t.rows
  return typeof v === 'number' ? v : null
}

function template(t: SchemaTable): string {
  return `SELECT *\nFROM ${t.name}\n`
}
</script>

<template>
  <div class="sb" :data-testid="testid">
    <div class="sb__head">
      <span class="label">SCHEMA</span>
      <button type="button" class="sb__btn label" title="reload (cached 5 min server-side)" @click="refresh()">↻</button>
    </div>
    <div v-if="error" class="sb__msg sb__msg--err label">LINK FAULT // {{ error.statusCode ?? '' }} SCHEMA</div>
    <div v-else-if="status === 'pending' && !data" class="sb__msg label">... POLLING</div>
    <div v-else-if="data && data.tables.length === 0" class="sb__msg label">NO TABLES</div>
    <ul v-else-if="data" class="sb__list">
      <li v-for="t in data.tables" :key="t.name" class="sb__table" data-testid="schema-table">
        <div class="sb__row">
          <button type="button" class="sb__toggle" :aria-expanded="open.has(t.name)" @click="toggle(t.name)">
            <span class="sb__caret" aria-hidden="true">{{ open.has(t.name) ? '▾' : '▸' }}</span>
            <span class="sb__name">{{ t.name }}</span>
          </button>
          <span class="sb__rows label" title="≈ MAX(rowid), not a COUNT">≈ {{ rowsOf(t) === null ? '?' : fmt.num(rowsOf(t)) }}</span>
          <button type="button" class="sb__btn label" title="insert SELECT * FROM template" @click="emit('insert', template(t))">SELECT *</button>
        </div>
        <div v-if="open.has(t.name)" class="sb__detail">
          <button
            v-for="c in t.columns"
            :key="c.name"
            type="button"
            class="sb__col"
            :title="`${c.type || '?'}${c.pk ? ' · PK' : ''}${c.notnull ? ' · NOT NULL' : ''} — click to insert`"
            @click="emit('insert', c.name)"
          >
            <span class="sb__col-name">{{ c.name }}</span>
            <span class="sb__col-type label">{{ c.type || '?' }}{{ c.pk ? ' PK' : '' }}</span>
          </button>
          <div v-if="t.indexes.length" class="sb__idx">
            <div class="label sb__idx-h">INDEXES</div>
            <div v-for="ix in t.indexes" :key="ix.name" class="sb__idx-row" :title="ix.sql ?? ''">{{ ix.name }}</div>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.sb {
  min-width: 0;
  font-size: var(--fs-data);
}

.sb__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-2);
}

.sb__msg {
  color: var(--text-faint);
  padding: var(--space-2) 0;
}

.sb__msg--err {
  color: var(--red);
}

.sb__list {
  list-style: none;
  display: grid;
  gap: 1px;
}

.sb__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 2px 0;
  border-bottom: 1px solid var(--hairline);
}

.sb__toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  flex: 1;
  min-width: 0;
  text-align: left;
  color: var(--text);
}

.sb__toggle:hover .sb__name {
  color: var(--teal-hot);
}

.sb__caret {
  color: var(--text-faint);
  width: 1em;
}

.sb__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb__rows {
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.sb__btn {
  color: var(--text-faint);
  white-space: nowrap;
}

.sb__btn:hover {
  color: var(--teal-hot);
}

.sb__detail {
  padding: var(--space-1) 0 var(--space-2) 1.4em;
  display: grid;
  gap: 1px;
}

.sb__col {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 1px 0;
  text-align: left;
  color: var(--text-dim);
  font-size: var(--fs-micro);
}

.sb__col:hover .sb__col-name {
  color: var(--teal-hot);
}

.sb__col-name {
  color: var(--text);
}

.sb__col-type {
  color: var(--text-faint);
  white-space: nowrap;
}

.sb__idx {
  margin-top: var(--space-1);
}

.sb__idx-h {
  color: var(--text-faint);
}

.sb__idx-row {
  color: var(--text-dim);
  font-size: var(--fs-micro);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
