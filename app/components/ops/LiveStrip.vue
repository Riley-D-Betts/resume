<script setup lang="ts">
import type { Live, LiveSession } from '#shared/analytics/ops'

/**
 * LIVE // LAST 5 MIN — polls `/api/ops/live` every 10 s while the tab is
 * visible. A green lamp marks sessions with input in the last 60 s (the
 * ACTIVE NOW definition, contract D22); the rest of the strip is the 5-min
 * tail. Click a row → the session.
 */
const props = withDefaults(
  defineProps<{
    bots?: boolean
    pollMs?: number
    /** Rows shown (the API caps at 50). */
    limit?: number
    testid?: string
  }>(),
  { bots: false, pollMs: 10_000, limit: 12, testid: 'live-strip' },
)

const emit = defineEmits<{ live: [data: Live] }>()

const fmt = useOpsFormat()
const query = computed(() => (props.bots ? { bots: '1' } : {}))
const { data, status, error, refresh } = useOpsFetch<Live>('/api/ops/live', { query })

const now = ref(Date.now())
watch(data, d => {
  now.value = Date.now()
  if (d) emit('live', d)
})

let timer: ReturnType<typeof setInterval> | undefined
function tick() {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
  void refresh()
}
function onVisible() {
  if (document.visibilityState === 'visible') void refresh()
}
onMounted(() => {
  timer = setInterval(tick, props.pollMs)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
})

const rows = computed<LiveSession[]>(() => (data.value?.sessions ?? []).slice(0, props.limit))
const activeNow = computed(() => data.value?.activeNow ?? 0)

function isActive(s: LiveSession): boolean {
  return now.value - s.lastSeenAt <= 60_000
}

function geo(s: LiveSession): string {
  const parts = [s.country ?? '??']
  if (s.city) parts.push(s.city)
  return parts.join(' / ')
}
</script>

<template>
  <div class="live" :data-testid="testid">
    <div class="live__head">
      <span class="label live__title">
        <StatusLamp :color="activeNow > 0 ? 'green' : 'off'" :pulse="activeNow > 0" />
        LIVE // LAST 5 MIN · {{ fmt.num(activeNow) }} ACTIVE (60 S)
      </span>
      <span class="label live__sub">
        <template v-if="error">LINK FAULT // {{ error.statusCode ?? '' }} LIVE</template>
        <template v-else-if="status === 'pending' && !data">... POLLING</template>
        <template v-else>ACTIVE = INPUT IN LAST 60 S · {{ fmt.num(data?.sessions.length ?? 0) }} IN 5 MIN</template>
      </span>
    </div>
    <div v-if="data && rows.length === 0" class="live__empty label">NO ONE HERE // LAST 5 MIN</div>
    <div v-else-if="rows.length" class="live__rows">
      <NuxtLink v-for="s in rows" :key="s.sid" :to="`/ops/sessions/${s.sid}`" class="live__row" data-testid="live-row">
        <span class="live__lamp"><StatusLamp :color="isActive(s) ? 'green' : 'off'" :pulse="isActive(s)" /></span>
        <span class="live__path" :title="s.path ?? ''">{{ s.path ?? '—' }}</span>
        <span class="live__geo">{{ geo(s) }}</span>
        <span class="live__org" :title="s.asOrg ?? ''">{{ s.asOrg ?? '—' }}</span>
        <span class="live__dev">{{ s.deviceType ?? '?' }} · {{ s.browser ?? '?' }}</span>
        <span class="live__t" :title="`${s.pageviews} pages · active ${fmt.mmss(s.activeMs)} · last seen ${fmt.ago(s.lastSeenAt, now)} ago`">
          {{ s.pageviews }}p · {{ fmt.mmss(s.activeMs) }}
        </span>
        <span class="live__badges"><IntentBadges :flags="s.intent" :replay="s.hasReplay" :max="3" /></span>
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped>
.live {
  min-width: 0;
}

.live__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-bottom: var(--space-2);
}

.live__title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text);
}

.live__sub {
  color: var(--text-faint);
}

.live__empty {
  padding: var(--space-2) 0;
  color: var(--text-faint);
}

.live__rows {
  display: grid;
  gap: 1px;
}

.live__row {
  display: grid;
  grid-template-columns: 14px minmax(6em, 1.2fr) minmax(6em, 1fr) minmax(6em, 1.4fr) minmax(6em, 1fr) auto auto;
  align-items: center;
  gap: var(--space-2);
  padding: 2px 0;
  border-bottom: 1px solid var(--hairline);
  color: var(--text);
  font-size: var(--fs-micro);
  font-variant-numeric: tabular-nums;
  text-decoration: none;
}

.live__row:hover {
  background: var(--bg-2);
  text-decoration: none;
}

.live__row > span {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.live__lamp {
  display: inline-flex;
  align-items: center;
}

.live__path {
  color: var(--teal-hot);
}

.live__geo,
.live__dev,
.live__t {
  color: var(--text-dim);
}

@media (max-width: 860px) {
  .live__row {
    grid-template-columns: 14px minmax(6em, 1.2fr) minmax(6em, 1fr) auto;
  }

  .live__org,
  .live__dev,
  .live__badges {
    display: none;
  }
}
</style>
