<script setup lang="ts">
definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

useHead({ title: 'OPS // SESSIONS' })

type Range = '24h' | '7d' | '30d' | 'all'
const RANGES: Range[] = ['24h', '7d', '30d', 'all']
const LIMIT = 50

const range = ref<Range>('7d')
const bots = ref(false)
const country = ref('')
const replayOnly = ref(false)

interface SessionRow {
  sid: string
  started_at: number
  duration_ms: number
  country: string | null
  city: string | null
  device_type: string | null
  browser: string | null
  max_scroll_pct: number
  pageviews: number
  is_bot: number
  has_replay: number
}

const rows = ref<SessionRow[]>([])
const total = ref(0)
const offset = ref(0)
const loading = ref(false)
const fault = ref(false)

async function load(reset: boolean) {
  loading.value = true
  fault.value = false
  if (reset) offset.value = 0
  try {
    const res = await $fetch<{ total: number; rows: SessionRow[] }>('/api/ops/sessions', {
      query: {
        range: range.value,
        limit: LIMIT,
        offset: offset.value,
        ...(bots.value ? { bots: '1' } : {}),
        ...(replayOnly.value ? { replay: '1' } : {}),
        ...(country.value.trim() ? { country: country.value.trim() } : {}),
      },
    })
    total.value = res.total
    rows.value = reset ? res.rows : [...rows.value, ...res.rows]
    offset.value += res.rows.length
  } catch {
    fault.value = true
  } finally {
    loading.value = false
  }
}

watch([range, bots, replayOnly], () => {
  void load(true)
})

let countryTimer: ReturnType<typeof setTimeout> | undefined
watch(country, () => {
  if (countryTimer) clearTimeout(countryTimer)
  countryTimer = setTimeout(() => {
    void load(true)
  }, 350)
})
onBeforeUnmount(() => {
  if (countryTimer) clearTimeout(countryTimer)
})

onMounted(() => {
  void load(true)
})

const timeFmt = new Intl.DateTimeFormat(undefined, {
  year: '2-digit',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function open(sid: string) {
  void navigateTo(`/ops/sessions/${sid}`)
}
</script>

<template>
  <div class="sx">
    <!-- filter bar -->
    <div class="sx__filters">
      <div class="sx__ranges" role="group" aria-label="Time range">
        <button
          v-for="r in RANGES"
          :key="r"
          type="button"
          class="sx__toggle label"
          :class="{ 'sx__toggle--on': range === r }"
          @click="range = r"
        >
          {{ r.toUpperCase() }}
        </button>
      </div>
      <input
        v-model="country"
        class="sx__country"
        type="text"
        placeholder="COUNTRY…"
        spellcheck="false"
        aria-label="Filter by country"
      >
      <button
        type="button"
        class="sx__toggle label"
        :class="{ 'sx__toggle--on': replayOnly }"
        :aria-pressed="replayOnly"
        @click="replayOnly = !replayOnly"
      >
        HAS REPLAY
      </button>
      <button
        type="button"
        class="sx__toggle label"
        :class="{ 'sx__toggle--on': bots }"
        :aria-pressed="bots"
        @click="bots = !bots"
      >
        INCLUDE BOTS
      </button>
      <span class="sx__count label">{{ total }} SESSION{{ total === 1 ? '' : 'S' }}</span>
    </div>

    <p v-if="fault" class="sx__fault">LINK FAULT // SESSIONS UNAVAILABLE</p>

    <!-- table -->
    <Panel title="SESSION LOG">
      <div class="sx__head label">
        <span>TIME</span>
        <span>GEO</span>
        <span>CLIENT</span>
        <span class="sx__num">ACTIVE</span>
        <span class="sx__num">SCROLL</span>
        <span class="sx__num">PAGES</span>
        <span>REPLAY</span>
      </div>

      <button
        v-for="s in rows"
        :key="s.sid"
        type="button"
        class="sx__row"
        data-testid="session-row"
        @click="open(s.sid)"
      >
        <span class="sx__t">{{ timeFmt.format(s.started_at) }}</span>
        <span class="sx__cell">
          {{ s.country ?? '??' }}<template v-if="s.city"> / {{ s.city }}</template>
        </span>
        <span class="sx__cell sx__dim">{{ s.device_type ?? '?' }} · {{ s.browser ?? '?' }}</span>
        <span class="sx__num sx__t">{{ mmss(s.duration_ms) }}</span>
        <span class="sx__num sx__t">{{ s.max_scroll_pct }}%</span>
        <span class="sx__num sx__t">{{ s.pageviews }}</span>
        <span class="sx__lamp"><StatusLamp :color="s.has_replay ? 'teal' : 'off'" :pulse="false" /></span>
      </button>

      <div v-if="!loading && rows.length === 0 && !fault" class="sx__empty label">
        NO SESSIONS IN RANGE
      </div>
      <div v-if="loading" class="sx__empty label">... POLLING</div>

      <button
        v-if="rows.length < total"
        type="button"
        class="sx__more label"
        :disabled="loading"
        @click="load(false)"
      >
        LOAD MORE // {{ rows.length }} OF {{ total }}
      </button>
    </Panel>
  </div>
</template>

<style scoped>
.sx {
  display: grid;
  gap: var(--space-3);
}

.sx__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.sx__ranges {
  display: flex;
  gap: var(--space-1);
}

.sx__toggle {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
  transition: border-color 0.2s, color 0.2s;
}

.sx__toggle:hover {
  border-color: var(--hairline-lit);
  color: var(--text);
}

.sx__toggle--on {
  border-color: var(--teal);
  color: var(--teal-hot);
}

.sx__country {
  font: inherit;
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  color: var(--text);
  background: var(--bg-1);
  border: 1px solid var(--hairline);
  padding: var(--space-1) var(--space-2);
  width: 11em;
  text-transform: uppercase;
}

.sx__country:focus {
  outline: none;
  border-color: var(--teal-hot);
}

.sx__count {
  margin-left: auto;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.sx__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
}

.sx__head,
.sx__row {
  display: grid;
  grid-template-columns: 8.5em minmax(0, 1fr) minmax(0, 1fr) 4.5em 4em 3.5em 3.5em;
  gap: var(--space-2);
  align-items: center;
  text-align: left;
}

.sx__head {
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--hairline-lit);
  color: var(--text-faint);
}

.sx__row {
  width: 100%;
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--hairline);
  font-size: var(--fs-data);
  color: var(--text);
  transition: background 0.15s;
}

.sx__row:hover {
  background: var(--bg-2);
}

.sx__cell {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sx__dim {
  color: var(--text-dim);
}

.sx__t {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.sx__num {
  text-align: right;
}

.sx__lamp {
  display: flex;
  justify-content: center;
}

.sx__empty {
  padding: var(--space-3) 0;
  color: var(--text-faint);
}

.sx__more {
  width: 100%;
  margin-top: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
  transition: border-color 0.2s, color 0.2s;
}

.sx__more:hover:not(:disabled) {
  border-color: var(--teal);
  color: var(--teal-hot);
}

.sx__more:disabled {
  opacity: 0.5;
  cursor: default;
}

@media (max-width: 760px) {
  .sx__head,
  .sx__row {
    grid-template-columns: 7em minmax(0, 1fr) 4.5em 3.5em;
  }

  .sx__head :nth-child(3),
  .sx__head :nth-child(5),
  .sx__head :nth-child(6),
  .sx__row :nth-child(3),
  .sx__row :nth-child(5),
  .sx__row :nth-child(6) {
    display: none;
  }
}
</style>
