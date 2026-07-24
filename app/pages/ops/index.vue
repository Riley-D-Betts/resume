<script setup lang="ts">
definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

useHead({ title: 'OPS // OVERVIEW' })

type Range = '24h' | '7d' | '30d' | 'all'
const RANGES: Range[] = ['24h', '7d', '30d', 'all']

const range = ref<Range>('7d')
const bots = ref(false)

const query = computed(() => ({
  range: range.value,
  ...(bots.value ? { bots: '1' } : {}),
}))

interface RecentSession {
  sid: string
  started_at: number
  country: string | null
  city: string | null
  device_type: string | null
  browser: string | null
  duration_ms: number
  has_replay: number
}

interface Overview {
  visitsToday: number
  activeNow: number
  uniques: number
  avgActiveMs: number
  replay: { count: number; bytes: number }
  series: { day: string; n: number }[]
  topOutbound: { name: string; n: number }[]
  recent: RecentSession[]
}

interface KN {
  k: string
  n: number
}

interface Aggregates {
  referrers: KN[]
  countries: KN[]
  cities: KN[]
  devices: KN[]
  browsers: KN[]
  languages: KN[]
  sectionDwell: { section: string; avgMs: number; n: number }[]
  scrollFunnel: { pct: number; sessions: number }[]
  errors: { ts: number; payload: Record<string, unknown> | null }[]
}

const {
  data: overview,
  status: oStatus,
  error: oError,
  refresh: refreshOverview,
} = useFetch<Overview>('/api/ops/overview', { query })

const {
  data: aggregates,
  status: aStatus,
  error: aError,
} = useFetch<Aggregates>('/api/ops/aggregates', { query })

// ACTIVE NOW should tick while the console is open
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    void refreshOverview()
  }, 15_000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

// -- formatting --------------------------------------------------------
function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function mb(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1)
}

const timeFmt = new Intl.DateTimeFormat(undefined, {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const errTimeFmt = new Intl.DateTimeFormat(undefined, {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const dwellRows = computed(() =>
  (aggregates.value?.sectionDwell ?? []).map(d => ({
    k: d.section,
    n: d.avgMs,
    display: `${(d.avgMs / 1000).toFixed(1)}s · ${d.n}x`,
  })),
)

const funnelRows = computed(() =>
  (aggregates.value?.scrollFunnel ?? []).map(f => ({
    k: `${f.pct}%`,
    n: f.sessions,
  })),
)

const outboundRows = computed(() =>
  (overview.value?.topOutbound ?? []).map(o => ({ k: o.name, n: o.n })),
)

const errors = computed(() => aggregates.value?.errors ?? [])

function errLine(payload: Record<string, unknown> | null): string {
  if (!payload) return '(no payload)'
  const msg = typeof payload.msg === 'string' ? payload.msg : '(no message)'
  const src = typeof payload.src === 'string' && payload.src ? ` — ${payload.src}` : ''
  const line = payload.line !== undefined && payload.line !== null ? `:${payload.line}` : ''
  return `${msg}${src}${line}`
}
</script>

<template>
  <div class="ov">
    <!-- controls -->
    <div class="ov__controls">
      <div class="ov__ranges" role="group" aria-label="Time range">
        <button
          v-for="r in RANGES"
          :key="r"
          type="button"
          class="ov__range label"
          :class="{ 'ov__range--on': range === r }"
          @click="range = r"
        >
          {{ r.toUpperCase() }}
        </button>
      </div>
      <button
        type="button"
        class="ov__range ov__bots label"
        :class="{ 'ov__range--on': bots }"
        :aria-pressed="bots"
        @click="bots = !bots"
      >
        INCLUDE BOTS
      </button>
    </div>

    <p v-if="oError" class="ov__fault">LINK FAULT // {{ oError.statusCode ?? '' }} OVERVIEW UNAVAILABLE</p>
    <p v-else-if="!overview && oStatus === 'pending'" class="ov__poll label">... POLLING</p>

    <template v-if="overview">
      <!-- stat cards -->
      <div class="ov__stats">
        <StatCard label="VISITS TODAY" :value="overview.visitsToday" />
        <StatCard
          label="ACTIVE NOW"
          :value="overview.activeNow"
          :lamp="overview.activeNow > 0 ? 'green' : 'off'"
          :pulse="overview.activeNow > 0"
        />
        <StatCard label="UNIQUES" :value="overview.uniques" :sub="`RANGE ${range.toUpperCase()}`" />
        <StatCard label="AVG ACTIVE TIME" :value="mmss(overview.avgActiveMs)" sub="MM:SS" />
        <StatCard
          label="REPLAYS"
          :value="overview.replay.count"
          :sub="`${mb(overview.replay.bytes)} MB ON DISK`"
          :lamp="overview.replay.count > 0 ? 'teal' : 'off'"
        />
      </div>

      <!-- 30-day series -->
      <Panel title="SESSIONS // LAST 30 DAYS" class="ov__block">
        <Sparkline :data="overview.series" />
      </Panel>
    </template>

    <p v-if="aError" class="ov__fault">LINK FAULT // AGGREGATES UNAVAILABLE</p>
    <p v-else-if="!aggregates && aStatus === 'pending'" class="ov__poll label">... POLLING</p>

    <div v-if="overview || aggregates" class="ov__grid">
      <Panel v-if="overview" title="TOP OUTBOUND TARGETS" teal class="ov__wide">
        <BarRows :rows="outboundRows" />
      </Panel>

      <Panel v-if="aggregates" title="REFERRERS">
        <BarRows :rows="aggregates.referrers" />
      </Panel>

      <Panel v-if="aggregates" title="GEO">
        <div class="ov__cols">
          <div>
            <div class="label ov__colhead">COUNTRIES</div>
            <BarRows :rows="aggregates.countries" />
          </div>
          <div>
            <div class="label ov__colhead">CITIES</div>
            <BarRows :rows="aggregates.cities" />
          </div>
        </div>
      </Panel>

      <Panel v-if="aggregates" title="DEVICE / BROWSER / LANG">
        <div class="ov__cols ov__cols--3">
          <div>
            <div class="label ov__colhead">DEVICE</div>
            <BarRows :rows="aggregates.devices" />
          </div>
          <div>
            <div class="label ov__colhead">BROWSER</div>
            <BarRows :rows="aggregates.browsers" />
          </div>
          <div>
            <div class="label ov__colhead">LANG</div>
            <BarRows :rows="aggregates.languages" />
          </div>
        </div>
      </Panel>

      <Panel v-if="aggregates" title="SECTION DWELL // AVG">
        <BarRows :rows="dwellRows" />
      </Panel>

      <Panel v-if="aggregates" title="SCROLL FUNNEL">
        <BarRows :rows="funnelRows" />
      </Panel>

      <Panel v-if="overview" title="RECENT SESSIONS" class="ov__wide">
        <div v-if="overview.recent.length === 0" class="label ov__nodata">NO DATA</div>
        <NuxtLink
          v-for="s in overview.recent"
          :key="s.sid"
          :to="`/ops/sessions/${s.sid}`"
          class="ov__recent"
        >
          <span class="ov__recent-t">{{ timeFmt.format(s.started_at) }}</span>
          <span>{{ s.country ?? '??' }}<template v-if="s.city"> / {{ s.city }}</template></span>
          <span class="ov__recent-dim">{{ s.device_type ?? '?' }} · {{ s.browser ?? '?' }}</span>
          <span class="ov__recent-t">{{ mmss(s.duration_ms) }}</span>
          <StatusLamp :color="s.has_replay ? 'teal' : 'off'" :pulse="false" />
        </NuxtLink>
      </Panel>

      <Panel v-if="aggregates" title="JS ERRORS" class="ov__wide">
        <details class="ov__errors" :open="errors.length > 0">
          <summary class="label">
            {{ errors.length }} FAULT{{ errors.length === 1 ? '' : 'S' }} LOGGED
          </summary>
          <div v-if="errors.length === 0" class="label ov__nodata">CLEAN BOARD</div>
          <div v-for="(e, i) in errors" :key="i" class="ov__error">
            <span class="ov__recent-t">{{ errTimeFmt.format(e.ts) }}</span>
            <span class="ov__error-msg">{{ errLine(e.payload) }}</span>
          </div>
        </details>
      </Panel>
    </div>
  </div>
</template>

<style scoped>
.ov {
  display: grid;
  gap: var(--space-4);
}

.ov__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.ov__ranges {
  display: flex;
  gap: var(--space-1);
}

.ov__range {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
  transition: border-color 0.2s, color 0.2s;
}

.ov__range:hover {
  border-color: var(--hairline-lit);
  color: var(--text);
}

.ov__range--on {
  border-color: var(--teal);
  color: var(--teal-hot);
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

.ov__cols--3 {
  grid-template-columns: repeat(3, 1fr);
}

@media (max-width: 560px) {
  .ov__cols,
  .ov__cols--3 {
    grid-template-columns: 1fr;
  }
}

.ov__colhead {
  margin-bottom: var(--space-2);
  color: var(--text-faint);
}

.ov__nodata {
  color: var(--text-faint);
  padding: var(--space-2) 0;
}

.ov__recent {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--hairline);
  color: var(--text);
  font-size: var(--fs-data);
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

.ov__recent-dim {
  color: var(--text-dim);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
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
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-3);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--hairline);
  font-size: var(--fs-micro);
}

.ov__error-msg {
  color: var(--red);
  overflow-wrap: anywhere;
}
</style>
