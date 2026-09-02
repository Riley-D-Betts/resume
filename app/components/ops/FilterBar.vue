<script setup lang="ts">
import { INTENT_FLAGS } from '#shared/analytics/events'
import type { IntentFlag } from '#shared/analytics/events'
import type { Filters, KN, OpsRange } from '#shared/analytics/ops'

/**
 * The one filter row above every view (contract E.4), bound to
 * `useOpsFilters()` so every change round-trips through the URL:
 * range chips (+ custom from / to), COMPARE, selects fed by
 * `/api/ops/filters` (ORG / PATH / COUNTRY / DEVICE / BROWSER / OS),
 * RETURNING, HAS REPLAY, WEBDRIVER, INCLUDE BOTS, intent chips, free-text Q,
 * and HIDE ISP/CLOUD on the orgs view (`showHideIsp`).
 */
const props = withDefaults(
  defineProps<{
    showHideIsp?: boolean
    showQ?: boolean
    showCompare?: boolean
    showIntent?: boolean
    showSelects?: boolean
    showBots?: boolean
    showReturning?: boolean
    showReplay?: boolean
    showWebdriver?: boolean
    qPlaceholder?: string
    testid?: string
  }>(),
  {
    showHideIsp: false,
    showQ: true,
    showCompare: true,
    showIntent: true,
    showSelects: true,
    showBots: true,
    showReturning: true,
    showReplay: true,
    showWebdriver: true,
    qPlaceholder: 'Q // org, city, referrer, path, rdns',
    testid: 'filter-bar',
  },
)

const filters = useOpsFilters()
const { state, windowQuery, activeCount, ranges } = filters

const { data: options } = useOpsFetch<Filters>('/api/ops/filters', { query: windowQuery, immediate: props.showSelects, watch: props.showSelects })

const INTENT_WORDS: Record<IntentFlag, string> = {
  print: 'PRINT',
  copy: 'COPY',
  email: 'EMAIL',
  form: 'FORM',
  submit: 'MAIL',
  find: 'FIND',
  search: 'SEARCH',
  exit: 'EXIT',
  rage: 'RAGE',
  dead: 'DEAD',
  error: 'ERR',
  outbound: 'OUT',
  egg: 'EGG',
}

const RANGE_WORDS: Record<OpsRange, string> = { '24h': '24H', '7d': '7D', '30d': '30D', '90d': '90D', all: 'ALL', custom: 'CUSTOM' }

// -- custom range -----------------------------------------------------
function toLocalInput(ms: string): string {
  const n = Number(ms)
  if (!ms || !Number.isFinite(n)) return ''
  const d = new Date(n)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function fromLocalInput(v: string): string {
  if (!v) return ''
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? String(t) : ''
}

const customFrom = computed({
  get: () => toLocalInput(state.value.from),
  set: v => filters.set({ range: 'custom', from: fromLocalInput(v) }),
})
const customTo = computed({
  get: () => toLocalInput(state.value.to),
  set: v => filters.set({ range: 'custom', to: fromLocalInput(v) }),
})

function pickRange(r: OpsRange) {
  if (r === 'custom') {
    const now = Date.now()
    filters.setRange('custom', state.value.from || String(now - 7 * 86_400_000), state.value.to || String(now))
  } else filters.setRange(r)
}

// -- selects ----------------------------------------------------------
type SelectKey = 'org' | 'path' | 'country' | 'device' | 'browser' | 'os'
const SELECTS: { key: SelectKey; label: string; from: keyof Filters }[] = [
  { key: 'org', label: 'ORG', from: 'orgs' },
  { key: 'path', label: 'PATH', from: 'paths' },
  { key: 'country', label: 'COUNTRY', from: 'countries' },
  { key: 'device', label: 'DEVICE', from: 'devices' },
  { key: 'browser', label: 'BROWSER', from: 'browsers' },
  { key: 'os', label: 'OS', from: 'oses' },
]

function optionsFor(s: (typeof SELECTS)[number]): KN[] {
  const list = (options.value?.[s.from] ?? []) as KN[]
  const cur = state.value[s.key]
  if (cur && !list.some(o => o.k === cur)) return [{ k: cur, n: 0 }, ...list]
  return list
}

function setSelect(key: SelectKey, e: Event) {
  filters.set({ [key]: (e.target as HTMLSelectElement).value } as Partial<typeof state.value>)
}

// -- tri-state toggles ------------------------------------------------
function cycleTri(key: 'returning' | 'webdriver') {
  const cur = state.value[key]
  filters.set({ [key]: cur === '' ? '1' : cur === '1' ? '0' : '' } as Partial<typeof state.value>)
}

function triWord(v: '' | '1' | '0'): string {
  return v === '1' ? 'YES' : v === '0' ? 'NO' : 'ANY'
}

// -- q (debounced) ----------------------------------------------------
const q = ref(state.value.q)
watch(
  () => state.value.q,
  v => {
    if (v !== q.value) q.value = v
  },
)
let qTimer: ReturnType<typeof setTimeout> | undefined
watch(q, v => {
  if (qTimer) clearTimeout(qTimer)
  qTimer = setTimeout(() => filters.set({ q: v.trim() }), 350)
})
onBeforeUnmount(() => {
  if (qTimer) clearTimeout(qTimer)
})
</script>

<template>
  <div class="fb" :data-testid="testid" role="group" aria-label="Filters">
    <div class="fb__group" role="group" aria-label="Time range">
      <button
        v-for="r in ranges"
        :key="r"
        type="button"
        class="fb__chip label"
        :class="{ 'fb__chip--on': state.range === r }"
        :aria-pressed="state.range === r"
        @click="pickRange(r)"
      >
        {{ RANGE_WORDS[r] }}
      </button>
      <template v-if="state.range === 'custom'">
        <input v-model="customFrom" type="datetime-local" class="fb__input" data-testid="range-custom-from" aria-label="From" />
        <span class="label fb__arrow">→</span>
        <input v-model="customTo" type="datetime-local" class="fb__input" data-testid="range-custom-to" aria-label="To" />
      </template>
      <button
        v-if="showCompare"
        type="button"
        class="fb__chip label"
        :class="{ 'fb__chip--on': state.compare }"
        :aria-pressed="state.compare"
        data-testid="compare-toggle"
        title="Show the previous period: deltas on tiles, dashed prior series"
        @click="filters.set({ compare: !state.compare })"
      >
        COMPARE
      </button>
    </div>

    <div v-if="showSelects" class="fb__group">
      <label v-for="s in SELECTS" :key="s.key" class="fb__select label">
        <span class="fb__select-l">{{ s.label }}</span>
        <select :value="state[s.key]" class="fb__sel" :data-testid="`filter-${s.key}`" @change="setSelect(s.key, $event)">
          <option value="">ANY</option>
          <option v-for="o in optionsFor(s)" :key="o.k" :value="o.k">{{ o.k }}{{ o.n ? ` (${o.n})` : '' }}</option>
        </select>
      </label>
    </div>

    <div class="fb__group">
      <button
        v-if="showReturning"
        type="button"
        class="fb__chip label"
        :class="{ 'fb__chip--on': state.returning !== '' }"
        data-testid="filter-returning"
        title="VISITORS: visit_count &gt; 1 · every other view: the session's is_returning flag"
        @click="cycleTri('returning')"
      >
        RETURNING // {{ triWord(state.returning) }}
      </button>
      <button
        v-if="showReplay"
        type="button"
        class="fb__chip label"
        :class="{ 'fb__chip--on': state.replay }"
        :aria-pressed="state.replay"
        data-testid="filter-replay"
        @click="filters.set({ replay: !state.replay })"
      >
        HAS REPLAY
      </button>
      <button
        v-if="showWebdriver"
        type="button"
        class="fb__chip label"
        :class="{ 'fb__chip--on': state.webdriver !== '' }"
        data-testid="filter-webdriver"
        title="navigator.webdriver — automation, kept separate from bots"
        @click="cycleTri('webdriver')"
      >
        WEBDRIVER // {{ triWord(state.webdriver) }}
      </button>
      <button
        v-if="showBots"
        type="button"
        class="fb__chip label"
        :class="{ 'fb__chip--on': state.bots }"
        :aria-pressed="state.bots"
        data-testid="filter-bots"
        @click="filters.set({ bots: !state.bots })"
      >
        INCLUDE BOTS
      </button>
      <button
        v-if="showHideIsp"
        type="button"
        class="fb__chip label"
        :class="{ 'fb__chip--on': state.hideIsp }"
        :aria-pressed="state.hideIsp"
        data-testid="filter-hide-isp"
        title="hide organisations classified as ISP or cloud"
        @click="filters.set({ hideIsp: !state.hideIsp })"
      >
        HIDE ISP/CLOUD
      </button>
    </div>

    <div v-if="showIntent" class="fb__group" role="group" aria-label="Intent flags">
      <button
        v-for="f in INTENT_FLAGS"
        :key="f"
        type="button"
        class="fb__chip fb__chip--intent label"
        :class="{ 'fb__chip--on': state.intent.includes(f) }"
        :aria-pressed="state.intent.includes(f)"
        data-testid="intent-chip"
        :data-flag="f"
        @click="filters.toggleIntent(f)"
      >
        {{ INTENT_WORDS[f] }}
      </button>
    </div>

    <div class="fb__group fb__group--end">
      <input v-if="showQ" v-model="q" type="search" class="fb__input fb__q" :placeholder="qPlaceholder" data-testid="filter-q" aria-label="Search" />
      <button v-if="activeCount > 0" type="button" class="fb__chip fb__reset label" data-testid="filter-reset" @click="filters.reset()">RESET</button>
    </div>
  </div>
</template>

<style scoped>
.fb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--hairline);
}

.fb__group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
}

.fb__group--end {
  margin-left: auto;
  gap: var(--space-2);
}

.fb__chip {
  padding: 2px var(--space-2);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
  white-space: nowrap;
}

.fb__chip:hover {
  color: var(--teal-hot);
  border-color: var(--hairline-lit);
}

.fb__chip--on {
  color: var(--teal-hot);
  border-color: var(--teal);
  background: var(--bg-teal);
}

.fb__chip--intent {
  padding: 1px 5px;
}

.fb__reset {
  color: var(--amber);
}

.fb__arrow {
  color: var(--text-faint);
  padding: 0 var(--space-1);
}

.fb__input,
.fb__sel {
  font: inherit;
  font-size: var(--fs-micro);
  letter-spacing: 0.06em;
  color: var(--text);
  background: var(--bg-1);
  border: 1px solid var(--hairline);
  padding: 2px var(--space-2);
  color-scheme: dark;
}

.fb__input:focus,
.fb__sel:focus {
  outline: none;
  border-color: var(--teal);
}

.fb__q {
  width: 16em;
  max-width: 60vw;
}

.fb__select {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-right: var(--space-2);
}

.fb__select-l {
  color: var(--text-faint);
}

.fb__sel {
  max-width: 11em;
  text-transform: none;
  letter-spacing: 0;
}
</style>
