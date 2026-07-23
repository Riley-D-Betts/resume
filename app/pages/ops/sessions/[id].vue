<script setup lang="ts">
import type { StatusReadout } from '~/data/resume'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

const route = useRoute()
const sid = computed(() => String(route.params.id ?? ''))

useHead({ title: 'OPS // SESSION' })

interface SessionDetail {
  sid: string
  vid: string
  started_at: number
  last_seen_at: number
  duration_ms: number
  ip: string | null
  ua: string | null
  browser: string | null
  browser_ver: string | null
  os: string | null
  device_type: string | null
  screen_w: number | null
  screen_h: number | null
  viewport_w: number | null
  viewport_h: number | null
  dpr: number | null
  lang: string | null
  tz: string | null
  country: string | null
  region: string | null
  city: string | null
  lat: number | null
  lon: number | null
  referrer: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  entry_path: string | null
  pageviews: number
  max_scroll_pct: number
  is_bot: number
  has_replay: number
}

interface SessionEvent {
  ts: number
  type: string
  name: string | null
  payload: Record<string, unknown> | null
}

const { data, status, error } = useFetch<{ session: SessionDetail; events: SessionEvent[] }>(
  () => `/api/ops/sessions/${sid.value}`,
)

const tsFmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function dash(v: string | number | null | undefined): string {
  return v === null || v === undefined || v === '' ? '—' : String(v)
}

const meta = computed<StatusReadout[]>(() => {
  const s = data.value?.session
  if (!s) return []
  return [
    { label: 'SID', value: s.sid },
    { label: 'VID', value: s.vid },
    { label: 'STARTED', value: tsFmt.format(s.started_at) },
    { label: 'LAST SEEN', value: tsFmt.format(s.last_seen_at) },
    { label: 'ACTIVE', value: mmss(s.duration_ms) },
    { label: 'IP', value: dash(s.ip) },
    { label: 'UA', value: dash(s.ua) },
    { label: 'BROWSER', value: `${dash(s.browser)} ${s.browser_ver ?? ''}`.trim() },
    { label: 'OS', value: dash(s.os) },
    { label: 'DEVICE', value: dash(s.device_type) },
    {
      label: 'SCREEN',
      value: s.screen_w ? `${s.screen_w}×${s.screen_h} @${s.dpr ?? 1}x` : '—',
    },
    {
      label: 'VIEWPORT',
      value: s.viewport_w ? `${s.viewport_w}×${s.viewport_h}` : '—',
    },
    { label: 'LANG', value: dash(s.lang) },
    { label: 'TZ', value: dash(s.tz) },
    {
      label: 'GEO',
      value:
        [s.country, s.region, s.city].filter(Boolean).join(' / ') || '—',
    },
    {
      label: 'COORDS',
      value:
        s.lat !== null && s.lon !== null ? `${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}` : '—',
    },
    { label: 'REFERRER', value: dash(s.referrer) },
    { label: 'UTM SRC', value: dash(s.utm_source) },
    { label: 'UTM MED', value: dash(s.utm_medium) },
    { label: 'UTM CAMP', value: dash(s.utm_campaign) },
    { label: 'UTM TERM', value: dash(s.utm_term) },
    { label: 'UTM CONT', value: dash(s.utm_content) },
    { label: 'ENTRY', value: dash(s.entry_path) },
    { label: 'PAGEVIEWS', value: String(s.pageviews) },
    { label: 'MAX SCROLL', value: `${s.max_scroll_pct}%` },
    s.is_bot
      ? { label: 'BOT', value: 'FLAGGED', lamp: 'amber' as const }
      : { label: 'BOT', value: 'NO' },
    s.has_replay
      ? { label: 'REPLAY', value: 'CAPTURED', lamp: 'teal' as const }
      : { label: 'REPLAY', value: 'NONE' },
  ]
})
</script>

<template>
  <div class="sd">
    <NuxtLink to="/ops/sessions" class="sd__back label">&larr; SESSION LOG</NuxtLink>

    <p v-if="error" class="sd__fault">
      {{ error.statusCode === 404 ? 'UNKNOWN SESSION // NO RECORD' : 'LINK FAULT // SESSION UNAVAILABLE' }}
    </p>
    <p v-else-if="status === 'pending'" class="sd__poll label">... POLLING</p>

    <template v-if="data">
      <Panel :title="`SESSION // ${sid.slice(0, 8).toUpperCase()}`">
        <div class="sd__meta">
          <Readout v-for="r in meta" :key="r.label" :readout="r" />
        </div>
      </Panel>

      <div class="sd__cols">
        <Panel title="EVENT TIMELINE">
          <EventTimeline :events="data.events" :start-ts="data.session.started_at" />
        </Panel>
        <Panel title="REPLAY" :teal="Boolean(data.session.has_replay)">
          <ReplayPlayer :sid="sid" />
        </Panel>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sd {
  display: grid;
  gap: var(--space-4);
}

.sd__back {
  color: var(--text-dim);
  justify-self: start;
}

.sd__back:hover {
  color: var(--teal-hot);
  text-decoration: none;
}

.sd__poll {
  color: var(--text-faint);
}

.sd__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.sd__meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  column-gap: var(--space-4);
}

.sd__cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-3);
  align-items: start;
}

@media (max-width: 960px) {
  .sd__cols {
    grid-template-columns: 1fr;
  }
}
</style>
