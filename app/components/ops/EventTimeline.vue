<script setup lang="ts">
import type { SessionEvents } from '#shared/analytics/ops'

export interface TimelineEvent {
  id?: number
  ts: number
  type: string
  name: string | null
  path?: string | null
  /** parsed object, a JSON string (EventRow), or null */
  payload: Record<string, unknown> | string | null
}

/**
 * Event log for one session. Rows are sorted by `(ts, id)` before render
 * (beacon / fetch envelopes land out of order — contract D8); LOAD MORE
 * fetches `/api/ops/sessions/<sid>/events?after=<nextAfter>` and appends.
 * Glyph column: ⚑ intent · ✖ errors · ↗ outbound · · everything else.
 */
const props = withDefaults(
  defineProps<{
    events: TimelineEvent[]
    /** session started_at — offsets are rendered relative to this */
    startTs: number
    /** needed for LOAD MORE */
    sid?: string
    /** keyset cursor from the detail response; null / undefined = no more */
    nextAfter?: number | null
    /** page size for LOAD MORE */
    pageSize?: number
    testid?: string
  }>(),
  { sid: undefined, nextAfter: null, pageSize: 500, testid: 'event-timeline' },
)

const emit = defineEmits<{ loaded: [events: TimelineEvent[], nextAfter: number | null] }>()

const INTENT = new Set(['print', 'copy', 'select', 'form', 'find', 'site_search', 'exit_intent', 'easter_egg', 'hover', 'rage_click', 'dead_click'])
const ERROR = new Set(['js_error', 'resource_error', 'console_error', 'replay_chunk_lost'])

const extra = ref<TimelineEvent[]>([])
const cursor = ref<number | null>(props.nextAfter)
watch(
  () => props.nextAfter,
  v => {
    cursor.value = v ?? null
  },
)
watch(
  () => props.events,
  () => {
    extra.value = []
  },
)

const all = computed<TimelineEvent[]>(() =>
  [...props.events, ...extra.value].sort((a, b) => a.ts - b.ts || (a.id ?? 0) - (b.id ?? 0)),
)

const types = computed(() => {
  const counts = new Map<string, number>()
  for (const e of all.value) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([type, n]) => ({ type, n }))
})

const active = ref<Set<string>>(new Set())
function toggleType(t: string) {
  const s = new Set(active.value)
  if (s.has(t)) s.delete(t)
  else s.add(t)
  active.value = s
}

const shown = computed(() => (active.value.size ? all.value.filter(e => active.value.has(e.type)) : all.value))

const expanded = ref<Set<string>>(new Set())
function keyOf(e: TimelineEvent, i: number): string {
  return e.id !== undefined ? `id-${e.id}` : `i-${i}-${e.ts}`
}
function toggleRow(k: string) {
  const s = new Set(expanded.value)
  if (s.has(k)) s.delete(k)
  else s.add(k)
  expanded.value = s
}

/** '+mm:ss.t' offset from session start (tenths). */
function offset(ts: number): string {
  const d = Math.max(0, ts - props.startTs)
  const mm = String(Math.floor(d / 60_000)).padStart(2, '0')
  const ss = String(Math.floor((d % 60_000) / 1000)).padStart(2, '0')
  const t = Math.floor((d % 1000) / 100)
  return `+${mm}:${ss}.${t}`
}

function parsed(p: TimelineEvent['payload']): Record<string, unknown> | null {
  if (!p) return null
  if (typeof p === 'object') return p
  try {
    const v = JSON.parse(p) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : { value: v }
  } catch {
    return { raw: p }
  }
}

/** 'k=v k=v' one-liner, hard-capped so a fat payload can't wreck the row. */
function compact(p: TimelineEvent['payload']): string {
  const obj = parsed(p)
  if (!obj) return ''
  const out: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    out.push(`${k}=${s.length > 60 ? `${s.slice(0, 57)}…` : s}`)
  }
  const joined = out.join(' ')
  return joined.length > 160 ? `${joined.slice(0, 157)}…` : joined
}

function pretty(p: TimelineEvent['payload']): string {
  const obj = parsed(p)
  return obj ? JSON.stringify(obj, null, 2) : '(no payload)'
}

function glyph(type: string): string {
  if (ERROR.has(type)) return '✖'
  if (type === 'outbound') return '↗'
  if (INTENT.has(type)) return '⚑'
  return '·'
}

function isError(type: string): boolean {
  return ERROR.has(type)
}

function errMessage(e: TimelineEvent): string {
  const obj = parsed(e.payload)
  const m = obj?.msg ?? obj?.src ?? obj?.tag
  return typeof m === 'string' ? m : ''
}

// -- LOAD MORE --------------------------------------------------------
const loading = ref(false)
const fault = ref<string | null>(null)

async function loadMore() {
  if (!props.sid || cursor.value === null || loading.value) return
  loading.value = true
  fault.value = null
  try {
    const res = await opsFetch<SessionEvents>(`/api/ops/sessions/${encodeURIComponent(props.sid)}/events`, {
      query: { after: cursor.value, limit: props.pageSize },
    })
    const seen = new Set([...props.events, ...extra.value].map(e => e.id).filter(id => id !== undefined))
    const fresh = (res.events ?? []).filter(e => e.id === undefined || !seen.has(e.id)) as TimelineEvent[]
    extra.value = [...extra.value, ...fresh]
    cursor.value = res.nextAfter ?? null
    emit('loaded', fresh, cursor.value)
  } catch (err) {
    const e = err as { statusCode?: number | null }
    fault.value = `LINK FAULT // ${e.statusCode ?? ''} EVENTS`
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="tl" :data-testid="testid">
    <div v-if="all.length === 0" class="tl__empty label">NO EVENTS RECORDED</div>
    <div v-if="types.length > 1" class="tl__filters" role="group" aria-label="Event types">
      <button
        v-for="t in types"
        :key="t.type"
        type="button"
        class="tl__chip label"
        :class="{ 'tl__chip--on': active.has(t.type) }"
        :aria-pressed="active.has(t.type)"
        data-testid="timeline-filter"
        @click="toggleType(t.type)"
      >
        {{ t.type }} <span class="tl__chip-n">{{ t.n }}</span>
      </button>
      <button v-if="active.size" type="button" class="tl__chip tl__chip--clear label" @click="active = new Set()">ALL</button>
    </div>
    <div v-if="all.length" class="tl__rows">
      <template v-for="(e, i) in shown" :key="keyOf(e, i)">
        <div class="tl__row" :class="{ 'tl__row--err': isError(e.type), 'tl__row--open': expanded.has(keyOf(e, i)) }" @click="toggleRow(keyOf(e, i))">
          <span class="tl__g" aria-hidden="true">{{ glyph(e.type) }}</span>
          <span class="tl__t">{{ offset(e.ts) }}</span>
          <span class="tl__type">{{ e.type }}</span>
          <span class="tl__name">{{ e.name ?? '' }}</span>
          <span class="tl__path" :title="e.path ?? ''">{{ e.path ?? '' }}</span>
          <span class="tl__p" :class="{ 'tl__p--err': isError(e.type) }">{{ isError(e.type) && errMessage(e) ? errMessage(e) : compact(e.payload) }}</span>
        </div>
        <pre v-if="expanded.has(keyOf(e, i))" class="tl__pre">{{ pretty(e.payload) }}</pre>
      </template>
    </div>
    <div v-if="fault" class="tl__fault label">{{ fault }}</div>
    <div v-if="sid && cursor !== null" class="tl__more">
      <button type="button" class="tl__more-btn label" data-testid="timeline-more" :disabled="loading" @click="loadMore">
        {{ loading ? '... POLLING' : `LOAD MORE // ${all.length} SHOWN` }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tl {
  font-size: var(--fs-micro);
  line-height: 1.9;
  font-variant-numeric: tabular-nums;
}

.tl__empty {
  color: var(--text-faint);
  padding: var(--space-2) 0;
}

.tl__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-bottom: var(--space-2);
}

.tl__chip {
  padding: 0 var(--space-2);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
  text-transform: none;
  letter-spacing: 0.04em;
}

.tl__chip:hover {
  color: var(--teal-hot);
  border-color: var(--hairline-lit);
}

.tl__chip--on {
  color: var(--teal-hot);
  border-color: var(--teal);
  background: var(--bg-teal);
}

.tl__chip--clear {
  color: var(--amber);
}

.tl__chip-n {
  color: var(--text-faint);
}

.tl__rows {
  max-height: 560px;
  overflow-y: auto;
}

.tl__row {
  display: grid;
  grid-template-columns: 1.2em 6em 8.5em minmax(4em, auto) minmax(4em, 0.6fr) minmax(0, 1.4fr);
  gap: var(--space-2);
  align-items: baseline;
  border-bottom: 1px solid var(--hairline);
  white-space: nowrap;
  cursor: pointer;
}

.tl__row:hover {
  background: var(--bg-2);
}

.tl__row--open {
  border-bottom: none;
}

.tl__g {
  color: var(--text);
  text-align: center;
}

.tl__t {
  color: var(--text-dim);
}

.tl__type {
  color: var(--text);
  letter-spacing: 0.06em;
}

.tl__name,
.tl__path {
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
}

.tl__p {
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* the one status colour: a fault row's message, always beside the ✖ glyph */
.tl__p--err,
.tl__row--err .tl__g {
  color: var(--red);
}

.tl__pre {
  margin: 0 0 var(--space-1) 1.2em;
  padding: var(--space-1) var(--space-2);
  border-left: 1px solid var(--hairline-lit);
  border-bottom: 1px solid var(--hairline);
  color: var(--text-dim);
  font: inherit;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.tl__fault {
  color: var(--red);
  padding: var(--space-1) 0;
}

.tl__more {
  display: flex;
  justify-content: center;
  padding: var(--space-2) 0 0;
}

.tl__more-btn {
  padding: 2px var(--space-3);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
}

.tl__more-btn:hover:not(:disabled) {
  color: var(--teal-hot);
  border-color: var(--hairline-lit);
}

.tl__more-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
