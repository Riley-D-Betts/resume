<script setup lang="ts">
/**
 * WP5a KITCHEN SINK — renders every /ops component with inline fixtures so
 * the build gate can smoke-render them before the real pages exist.
 * WP6 DELETES THIS FILE BEFORE MERGE.
 */
import type { HeatCell, PageVisitRow } from '#shared/analytics/ops'
import type { BarRow } from '~/components/ops/BarRows.vue'
import type { EnvSession } from '~/components/ops/EnvPanel.vue'
import type { TimelineEvent } from '~/components/ops/EventTimeline.vue'
import type { LineSeries } from '~/components/ops/LineChart.vue'
import type { ReplaySegment } from '~/components/ops/ReplayPlayer.client.vue'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })
useHead({ title: 'OPS // KIT' })

const fmt = useOpsFormat()
const filters = useOpsFilters()

const DAY = 86_400_000
const now = Date.now()
const days = Array.from({ length: 14 }, (_, i) => fmt.date(now - (13 - i) * DAY))

const sparkData = days.map((day, i) => ({ day, n: 4 + ((i * 7) % 11) }))

const lineSeries: LineSeries[] = [
  { key: 'sessions', label: 'SESSIONS', points: days.map((x, i) => ({ x, y: 4 + ((i * 7) % 11) })) },
  { key: 'pageviews', label: 'PAGEVIEWS', points: days.map((x, i) => ({ x, y: 9 + ((i * 5) % 17) })) },
  { key: 'visitors', label: 'VISITORS', points: days.map((x, i) => ({ x, y: i === 6 ? null : 3 + ((i * 3) % 7) })) },
]
const linePrev: LineSeries[] = [
  { key: 'sessions', label: 'SESSIONS', points: days.map((x, i) => ({ x: fmt.date(now - (27 - i) * DAY), y: 3 + ((i * 5) % 9) })) },
]

const columnBins = Array.from({ length: 12 }, (_, i) => ({ label: `${i * 250}`, n: Math.round(40 * Math.exp(-((i - 3) ** 2) / 6)) + (i % 3) }))

const heat: HeatCell[] = []
for (let dow = 0; dow < 7; dow++) for (let hour = 0; hour < 24; hour++) heat.push({ dow, hour, n: (dow * 7 + hour * 3) % 13 === 0 ? 0 : ((dow + 1) * (hour + 2)) % 9 })

const funnel = [
  { label: 'FOCUS', n: 42 },
  { label: 'INPUT', n: 31 },
  { label: 'FIELD', n: 22 },
  { label: 'MAIL HANDOFF', n: 9 },
]
const funnelAside = [
  { label: 'INVALID', n: 4 },
  { label: 'RESET', n: 2 },
  { label: 'ABANDON', n: 13 },
]

const tiles = [
  { metric: 'lcp', p50: 1420, p75: 2210, p95: 4100, n: 312, sub: 'PER DOCUMENT LOAD' },
  { metric: 'inp', p50: 48, p75: 120, p95: 380, n: 240 },
  { metric: 'cls', p50: 0.01, p75: 0.04, p95: 0.31, n: 312 },
  { metric: 'ttfb', p50: 210, p75: 620, p95: 1900, n: 312 },
  { metric: 'fcp', p50: 900, p75: 1600, p95: 3200, n: 312 },
  { metric: 'softNav', p50: 60, p75: 110, p95: 300, n: 800, sub: 'PER SPA NAV' },
]

const bars = [
  { k: 'Idaho State University', n: 14 },
  { k: 'Comcast Cable', n: 11 },
  { k: 'Micron Technology', n: 8 },
  { k: 'Google LLC', n: 5 },
  { k: '(unknown)', n: 3 },
]

const tableColumns = [
  { key: 'path', label: 'PATH' },
  { key: 'pageviews', label: 'PAGEVIEWS' },
  { key: 'avgActiveMs', label: 'AVG ACTIVE', format: (v: unknown) => fmt.mmss(v) },
  { key: 'bounceRate', label: 'BOUNCE', format: (v: unknown) => fmt.pct(v, 1) },
  { key: 'textCps', label: 'TEXT CHARS / ACTIVE SEC', title: 'higher = skimming or bouncing', format: (v: unknown) => fmt.num(v, 1) },
]
const tableRows = [
  { path: '/', pageviews: 120, avgActiveMs: 42_000, bounceRate: 38.2, textCps: 12.4 },
  { path: '/employee', pageviews: 64, avgActiveMs: 91_000, bounceRate: 12.5, textCps: 8.1 },
  { path: '/positions', pageviews: 51, avgActiveMs: 70_500, bounceRate: 9.9, textCps: 9.7 },
  { path: '/projects', pageviews: 47, avgActiveMs: 66_000, bounceRate: 11.0, textCps: null },
  { path: '/contact', pageviews: 23, avgActiveMs: 38_000, bounceRate: 20.1, textCps: 30.2 },
]

const sessionRow = {
  sid: 'kit-session-00000001',
  prints: 1,
  copies: 2,
  email_copies: 1,
  form_started: 1,
  form_submitted: 0,
  mailto_clicks: 1,
  finds: 0,
  searches: 1,
  exit_intents: 1,
  rage_clicks: 0,
  dead_clicks: 1,
  errors: 1,
  eggs: 0,
  has_replay: 1,
  is_webdriver: 0,
  is_tor: 0,
}

const pages: (Partial<PageVisitRow> & { path: string; entered_at: number })[] = [
  { pvid: 'p1', path: '/', entered_at: now - 600_000, left_at: now - 540_000, nav_kind: 'initial', active_ms: 40_000, hidden_ms: 5_000, max_scroll_pct: 80, sections_seen: 4, clicks: 3, leave_reason: 'spa' },
  { pvid: 'p2', path: '/employee', entered_at: now - 540_000, left_at: now - 300_000, nav_kind: 'spa', soft_nav_ms: 80, active_ms: 150_000, hidden_ms: 60_000, max_scroll_pct: 100, sections_seen: 7, clicks: 5, leave_reason: 'spa' },
  { pvid: 'p3', path: '/contact', entered_at: now - 300_000, left_at: null, nav_kind: 'spa', soft_nav_ms: 45, active_ms: 30_000, hidden_ms: 0, max_scroll_pct: 60, sections_seen: 2, clicks: 4, leave_reason: null },
]

const session: EnvSession = {
  ip: '203.0.113.42',
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
  asn: 13335,
  as_org: 'Cloudflare, Inc.',
  nav_kind: 'initial',
  screen_w: 1920,
  screen_h: 1080,
  viewport_w: 1440,
  viewport_h: 900,
  dpr: 2,
  lang: 'en-US',
  tz: 'America/Boise',
  gpc: 0,
  dnt: 1,
  save_data: 0,
  is_webdriver: 0,
  is_tor: 0,
  is_bot: 1,
  net: {
    colo: 'SEA',
    http_protocol: 'HTTP/3',
    tls_version: 'TLSv1.3',
    tls_cipher: 'AEAD-AES128-GCM-SHA256',
    client_rtt_ms: 24,
    rtt_kind: 'quic',
    accept_encoding: 'gzip, deflate, br, zstd',
    cf_ray: '8c1d2e3f4a5b6c7d-SEA',
    doc_referer: 'https://www.linkedin.com/',
    fetch_site: 'cross-site',
    fetch_mode: 'navigate',
    fetch_dest: 'document',
    fetch_user: 1,
    ch_ua: '"Chromium";v="128", "Not;A=Brand";v="24"',
    ch_mobile: 0,
    ch_platform: 'macOS',
    accept_language: 'en-US,en;q=0.9',
    client_tz_offset_min: -360,
    cf_tz_offset_min: -420,
    cf_tz: 'America/Los_Angeles',
    is_eu: 0,
    bot_score: 92,
    verified_bot: 0,
  },
  env: {
    webdriver: 0,
    ua_brands: 'Chromium/128;Google Chrome/128',
    ua_arch: 'arm',
    ua_bitness: '64',
    ua_platform_ver: '14.5.0',
    languages: 'en-US,en',
    max_touch_points: 0,
    pdf_viewer: 1,
    cookies_enabled: 1,
    gpu_vendor: 'Apple',
    gpu_renderer: 'Apple M2',
    color_scheme: 'dark',
    reduced_motion: 0,
    net_effective: '4g',
    net_downlink: 10,
    device_memory: 8,
    cores: 8,
    js_heap_used_mb: 42,
    js_heap_limit_mb: 4096,
    battery_level: 0.83,
    battery_charging: 1,
    storage_usage_mb: 12,
    storage_quota_mb: 60_000,
    voices: 178,
    display_mode: 'browser',
  },
}

const events: TimelineEvent[] = [
  { id: 3, ts: now - 600_000 + 300, type: 'pageview', name: '/', path: '/', payload: { kind: 'initial' } },
  { id: 1, ts: now - 600_000, type: 'first_interaction', name: null, path: '/', payload: '{"ms":1200,"kind":"pointer"}' },
  { id: 2, ts: now - 600_000 + 300, type: 'section_enter', name: 'masthead', path: '/', payload: null },
  { id: 4, ts: now - 590_000, type: 'copy', name: null, path: '/employee', payload: { len: 24, snippet: 'riley@…', hasEmail: true, sel: 'a.email' } },
  { id: 5, ts: now - 580_000, type: 'outbound', name: 'github.com', path: '/employee', payload: { href: 'https://github.com/…', newTab: true } },
  { id: 6, ts: now - 570_000, type: 'js_error', name: null, path: '/employee', payload: { msg: 'TypeError: x is not a function', src: '/_nuxt/entry.js', line: 12 } },
  { id: 7, ts: now - 560_000, type: 'print', name: null, path: '/employee', payload: { phase: 'before' } },
]

const segments: ReplaySegment[] = [
  {
    rid: 'kit-rid-1',
    startedAt: now - 600_000,
    events: [
      { type: 4, data: { href: 'about:blank', width: 800, height: 600 }, timestamp: now - 600_000 },
      { type: 2, data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { left: 0, top: 0 } }, timestamp: now - 599_900 },
      { type: 3, data: { source: 1, positions: [] }, timestamp: now - 599_000 },
    ] as ReplaySegment['events'],
  },
  { rid: 'kit-rid-2', startedAt: now - 300_000, events: [] },
]

const sqlConsole = ref<{ insert: (text: string) => void } | null>(null)
</script>

<template>
  <div class="kit">
    <h1 class="label kit__h">OPS // COMPONENT KIT (WP5a — deleted by WP6)</h1>

    <FilterBar show-hide-isp />
    <p class="label kit__q">QUERY → {{ filters.query.value }}</p>

    <Panel title="LIVE STRIP">
      <LiveStrip :bots="filters.state.value.bots" />
    </Panel>

    <div class="kit__stats">
      <StatCard label="SESSIONS" :value="fmt.num(1284)" :prev="1100" sub="RANGE 7D" />
      <StatCard label="RETURNING %" value="23.4%" :delta="{ abs: -2.1, pct: -8.2 }" hint="visitors with visit_count > 1" />
      <StatCard label="ACTIVE NOW" :value="2" lamp="green" pulse sub="INPUT IN LAST 60 S" />
      <StatCard label="REPLAYS" :value="41" lamp="teal" sub="12.3 MB ON DISK" to="/ops/sessions?replay=1" />
      <StatCard label="ERRORS" :value="7" :prev="7" />
    </div>

    <Panel title="SESSIONS // LAST 30 DAYS">
      <Sparkline :data="sparkData" />
    </Panel>

    <Panel title="LINE CHART // 3 SERIES + PREV">
      <LineChart :series="lineSeries" :prev="linePrev" aria-label="Sessions, pageviews and visitors per day" />
    </Panel>

    <div class="kit__grid">
      <Panel title="COLUMN CHART // LCP HISTOGRAM">
        <ColumnChart :bins="columnBins" aria-label="LCP histogram" key-label="MS" />
      </Panel>
      <Panel title="HEATMAP // DAY × HOUR">
        <Heatmap :heat="heat" aria-label="Sessions by weekday and hour" />
      </Panel>
      <Panel title="FUNNEL // CONTACT FORM">
        <FunnelSteps :steps="funnel" :aside="funnelAside" />
      </Panel>
      <Panel title="BAR ROWS // TOP ORGS">
        <BarRows :rows="bars" table-toggle fold-other :to="(r: BarRow) => filters.linkTo('/ops/sessions', { org: r.k })" />
      </Panel>
    </div>

    <Panel title="PERCENTILE TILES">
      <PercentileTiles :tiles="tiles" />
    </Panel>

    <Panel title="DATA TABLE // PAGES">
      <DataTable :columns="tableColumns" :rows="tableRows" row-key="path" row-testid="page-row" :sort="{ key: 'pageviews', dir: 'desc' }" :row-to="(r: Record<string, unknown>) => `/ops/pages/detail?path=${encodeURIComponent(String(r.path))}`" />
    </Panel>

    <Panel title="INTENT BADGES">
      <IntentBadges :session="sessionRow" />
      <br />
      <IntentBadges :flags="['print', 'submit', 'egg']" replay webdriver tor :max="4" />
    </Panel>

    <Panel title="PATH TIMELINE">
      <PathTimeline :pages="pages" :start-ts="now - 600_000" :path-to="(p: string) => `/ops/pages/detail?path=${encodeURIComponent(p)}`" />
    </Panel>

    <Panel title="ENV PANEL">
      <EnvPanel :session="session" :derived="{ tzMismatch: true, botReason: 'honeypot', honeypotUa: session.ua }" />
    </Panel>

    <Panel title="EVENT TIMELINE">
      <EventTimeline :events="events" :start-ts="now - 600_000" sid="kit-session-00000001" :next-after="7" />
    </Panel>

    <Panel title="EXPORT">
      <ExportButton entity="sessions" />
      <ExportButton entity="events" format="ndjson" />
    </Panel>

    <div class="kit__sql">
      <Panel title="SCHEMA">
        <SchemaBrowser @insert="(t: string) => sqlConsole?.insert(t)" />
      </Panel>
      <Panel title="SQL CONSOLE">
        <SqlConsole ref="sqlConsole" initial-sql="SELECT as_org, COUNT(*) AS n FROM sessions GROUP BY 1 ORDER BY n DESC" />
      </Panel>
    </div>

    <Panel title="REPLAY PLAYER // SEGMENTS" teal>
      <ReplayPlayer :segments="segments" />
    </Panel>
  </div>
</template>

<style scoped>
.kit {
  display: grid;
  gap: var(--space-4);
}

.kit__h {
  color: var(--amber);
}

.kit__q {
  color: var(--text-faint);
  text-transform: none;
  overflow-wrap: anywhere;
}

.kit__stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-2);
}

.kit__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: var(--space-4) var(--space-3);
}

.kit__sql {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(0, 3fr);
  gap: var(--space-4) var(--space-3);
}

@media (max-width: 860px) {
  .kit__sql {
    grid-template-columns: 1fr;
  }
}
</style>
