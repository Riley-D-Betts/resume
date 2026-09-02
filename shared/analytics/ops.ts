// shared/analytics/ops.ts — response and query types of the /api/ops read API
// (contract §D.1 / §D.2 + plan deltas A24 / A28 / A46 / A48; owned by WP4).
// WP5a/WP5b code against these types.
//
// PURE MODULE: no Nuxt auto-imports, no `enum`, no parameter properties,
// `import type` only, relative imports with explicit `.ts` extensions.

import type { EventType, IntentFlag, NavKind } from './events.ts'

// ---------------------------------------------------------------------------
// Query surface (contract D.1). Every value arrives as a query-string string;
// `server/utils/opsFilters.ts` parses + clamps it.
// ---------------------------------------------------------------------------

export type OpsRange = '24h' | '7d' | '30d' | '90d' | 'all' | 'custom'

export interface OpsQuery {
  range?: OpsRange
  /** Epoch ms, `range=custom` only. */
  from?: string
  to?: string
  /** IANA zone of the owner (validated via Intl.DateTimeFormat); default 'UTC'. */
  tz?: string
  bots?: '1'
  /** Exact `as_org`; `(unknown)` matches NULL / ''. */
  org?: string
  asn?: string
  /** Any visited page (page_visits EXISTS). */
  path?: string
  /** entry_path exact. */
  entry?: string
  /** Matches country code (exact, case-insensitive) OR region / city substring (audit A46). */
  country?: string
  device?: string
  browser?: string
  os?: string
  returning?: '1' | '0'
  replay?: '1'
  webdriver?: '1' | '0'
  /** Comma list of IntentFlag, OR-ed. */
  intent?: string
  /** LIKE across as_org, city, referrer, entry_path, rdns_host (clamped to 40 UTF-8 bytes). */
  q?: string
  compare?: '1'
  /** Orgs view: hide kind ∈ isp | cloud. */
  hideIsp?: '1'
  sort?: string
  dir?: 'asc' | 'desc'
  limit?: string
  /** Offset paging — visitors list only (≤ 5 000). */
  offset?: string
  /** Keyset cursor: exports (`x-rb-next` echo) and session events (event id). */
  after?: string
  /** Sessions list keyset (audit A24): the sort value of the last row seen … */
  before?: string
  /** … and its sid. */
  beforeSid?: string
  /** `full` adds ip / ua to the sessions projection. */
  fields?: 'full'
  /** Session events: comma list of EventType. */
  types?: string
  /** Performance view dimension. */
  dim?: 'device' | 'browser' | 'os' | 'country' | 'path' | 'protocol'
  /** Flows: sequence depth (2..5, default 3). */
  depth?: string
  /** Export entity / format. */
  entity?: ExportEntity
  format?: ExportFormat
}

export interface OpsWindow {
  start: number
  end: number
  prevStart: number
  prevEnd: number
  tz: string
  range: OpsRange
}

// ---------------------------------------------------------------------------
// Shared atoms
// ---------------------------------------------------------------------------

export interface KN {
  k: string
  n: number
}

export type OrgKind = 'org' | 'isp' | 'cloud' | 'unknown'

export interface DayPoint {
  /** Owner-tz calendar day, YYYY-MM-DD. */
  day: string
  n: number
}

export interface HeatCell {
  /** 0 = Sunday, owner tz. */
  dow: number
  hour: number
  n: number
}

// ---------------------------------------------------------------------------
// Row shapes (snake_case = the D1 column)
// ---------------------------------------------------------------------------

/** Explicit projection returned by `/api/ops/sessions` (no ip / ua unless `fields=full`). */
export interface SessionRow {
  sid: string
  vid: string
  started_at: number
  last_seen_at: number
  /** Heartbeat time, 15 s steps — labelled HEARTBEAT TIME (15 S STEPS), never "active". */
  duration_ms: number
  browser: string | null
  browser_ver: string | null
  os: string | null
  device_type: string | null
  country: string | null
  region: string | null
  city: string | null
  referrer: string | null
  entry_path: string | null
  exit_path: string | null
  last_path: string | null
  pageviews: number
  max_scroll_pct: number
  is_bot: number
  has_replay: number
  is_returning: number
  visit_n: number
  nav_kind: NavKind | null
  asn: number | null
  as_org: string | null
  is_webdriver: number
  is_tor: number
  gpc: number
  prints: number
  copies: number
  email_copies: number
  form_started: number
  form_submitted: number
  finds: number
  searches: number
  exit_intents: number
  rage_clicks: number
  dead_clicks: number
  errors: number
  outbounds: number
  mailto_clicks: number
  eggs: number
  events_n: number
  /** Σ page_visits.active_ms for the sid (query-time; the one "active time"). */
  active_ms: number
  /** `fields=full` only. */
  ip?: string | null
  ua?: string | null
}

/** `SELECT *` on sessions + the two 1:1 side rows. */
export interface SessionFull extends SessionRow {
  ip: string | null
  ua: string | null
  screen_w: number | null
  screen_h: number | null
  viewport_w: number | null
  viewport_h: number | null
  dpr: number | null
  lang: string | null
  tz: string | null
  lat: number | null
  lon: number | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  dnt: number
  save_data: number
  selects: number
  right_clicks: number
  hovers: number
  subtabs: number
  hidden_ms: number
  blurs: number
  ptr_n: number
  touch_n: number
  key_n: number
  first_interaction_ms: number | null
  net: SessionNetRow | null
  env: SessionEnvRow | null
}

export interface SessionNetRow {
  sid: string
  created_at: number
  colo: string | null
  http_protocol: string | null
  tls_version: string | null
  tls_cipher: string | null
  client_rtt_ms: number | null
  rtt_kind: string | null
  request_priority: string | null
  accept_encoding: string | null
  tls_ciphers_sha1: string | null
  tls_ext_sha1: string | null
  tls_hello_len: number | null
  cf_ray: string | null
  continent: string | null
  region_code: string | null
  postal_code: string | null
  metro_code: string | null
  cf_tz: string | null
  is_eu: number | null
  bot_score: number | null
  verified_bot: number | null
  verified_bot_category: string | null
  ja3_hash: string | null
  ja4: string | null
  client_trust_score: number | null
  accept_language: string | null
  ch_ua: string | null
  ch_mobile: number | null
  ch_platform: string | null
  fetch_site: string | null
  fetch_mode: string | null
  fetch_dest: string | null
  fetch_user: number | null
  doc_referer: string | null
  early_data: number | null
  client_tz_offset_min: number | null
  cf_tz_offset_min: number | null
  rdns_host: string | null
}

export interface SessionEnvRow {
  sid: string
  created_at: number
  webdriver: number | null
  ua_brands: string | null
  ua_mobile: number | null
  ua_platform: string | null
  ua_arch: string | null
  ua_bitness: string | null
  ua_model: string | null
  ua_platform_ver: string | null
  ua_full_versions: string | null
  ua_form_factors: string | null
  ua_wow64: number | null
  languages: string | null
  max_touch_points: number | null
  pdf_viewer: number | null
  cookies_enabled: number | null
  gpc_js: number | null
  dnt_js: number | null
  gpu_vendor: string | null
  gpu_renderer: string | null
  webgpu_vendor: string | null
  webgpu_arch: string | null
  webgpu_device: string | null
  webgpu_desc: string | null
  battery_level: number | null
  battery_charging: number | null
  storage_quota_mb: number | null
  storage_usage_mb: number | null
  media_audioinput: number | null
  media_videoinput: number | null
  media_audiooutput: number | null
  color_scheme: string | null
  reduced_motion: number | null
  contrast: string | null
  forced_colors: number | null
  inverted_colors: number | null
  reduced_transparency: number | null
  avail_w: number | null
  avail_h: number | null
  color_depth: number | null
  orientation: string | null
  js_heap_limit_mb: number | null
  js_heap_used_mb: number | null
  net_type: string | null
  net_effective: string | null
  net_downlink: number | null
  net_rtt: number | null
  net_save_data: number | null
  voices: number | null
  tz_name: string | null
  tz_offset_min: number | null
  intl_locale: string | null
  display_mode: string | null
  outer_w: number | null
  outer_h: number | null
  inner_w: number | null
  inner_h: number | null
  device_memory: number | null
  cores: number | null
  platform: string | null
  touch: number | null
}

export interface PageVisitRow {
  pvid: string
  sid: string
  path: string
  entered_at: number
  left_at: number | null
  from_path: string | null
  nav_kind: NavKind | null
  soft_nav_ms: number | null
  active_ms: number
  hidden_ms: number
  max_scroll_pct: number
  scroll_px: number
  scroll_reversals: number
  max_scroll_vel: number | null
  sections_seen: number
  clicks: number
  text_len: number | null
  console_errors: number
  /** 'spa' | 'unload' | 'hidden'. */
  leave_reason: string | null
}

export interface PagePerfRow {
  pvid: string
  sid: string
  ts: number
  path: string
  ttfb_ms: number | null
  fcp_ms: number | null
  lcp_ms: number | null
  lcp_sel: string | null
  lcp_size: number | null
  cls: number | null
  inp_ms: number | null
  dns_ms: number | null
  connect_ms: number | null
  tls_ms: number | null
  request_ms: number | null
  response_ms: number | null
  dom_interactive_ms: number | null
  dcl_ms: number | null
  load_ms: number | null
  transfer_bytes: number | null
  encoded_bytes: number | null
  decoded_bytes: number | null
  redirects: number | null
  protocol: string | null
  nav_type: string | null
  res_count: number | null
  res_bytes: number | null
  res_cached: number | null
  /** JSON `{script,css,font,img,fetch,other}`. */
  res_by_type: string | null
  /** JSON `PerfResource[]` (≤ 5). */
  res_slowest: string | null
  long_tasks: number | null
  long_task_ms: number | null
  long_task_max_ms: number | null
  loaf_count: number | null
  loaf_ms: number | null
  loaf_max_ms: number | null
  loaf_script: string | null
  soft_nav_ms: number | null
}

export interface VisitorRow {
  vid: string
  first_seen_at: number
  last_seen_at: number
  visit_count: number
  first_referrer: string | null
  first_utm_source: string | null
  first_utm_medium: string | null
  first_utm_campaign: string | null
  first_as_org: string | null
  first_country: string | null
  first_entry_path: string | null
  last_as_org: string | null
  last_country: string | null
}

export interface EventRow {
  id: number
  ts: number
  type: EventType
  name: string | null
  /** null on rows written before 0003 — display `COALESCE(path, entry_path)`. */
  path: string | null
  /** JSON string or null (the UI parses; the server never re-serialises). */
  payload: string | null
}

// ---------------------------------------------------------------------------
// Aggregates (contract D.2)
// ---------------------------------------------------------------------------

export interface Stats {
  sessions: number
  visitors: number
  returningPct: number
  pageviews: number
  /** Σ page_visits.active_ms per session, averaged. */
  avgActiveMs: number
  bounceRate: number
  engagedRate: number
  /** form_submitted — the page composed a mailto (label MAIL HANDOFFS, never "sent"). */
  mailHandoffs: number
  mailtoClicks: number
  emailCopies: number
  /** Sessions in the window that started today (owner tz); 0 for `prev`. */
  visitsToday: number
}

export interface IntentTiles {
  prints: number
  copies: number
  emailCopies: number
  selects: number
  finds: number
  searches: number
  exitIntents: number
  rageClicks: number
  deadClicks: number
  formStarted: number
  mailHandoffs: number
  mailtoClicks: number
}

export type IntentCounts = Partial<Record<IntentFlag, number>>

export interface RecentSession {
  sid: string
  startedAt: number
  lastSeenAt: number
  country: string | null
  city: string | null
  asOrg: string | null
  deviceType: string | null
  browser: string | null
  entryPath: string | null
  pageviews: number
  /** Σ page_visits.active_ms. */
  activeMs: number
  /** HEARTBEAT TIME (15 s steps). */
  durationMs: number
  isBot: boolean
  hasReplay: boolean
  intent: IntentFlag[]
}

export interface SeriesPoint {
  day: string
  sessions: number
  pageviews: number
  visitors: number
  /** = sessions (kept for the pre-WP5b Sparkline, which reads `{ day, n }`). */
  n: number
}

export interface Overview {
  stats: Stats
  /** Previous period, `compare=1`. */
  prev?: Stats
  /** Owner-tz days; range=all is bounded to the last 365 days. */
  series: SeriesPoint[]
  /** Previous period series (sessions dashed on COMPARE), `compare=1`. */
  prevSeries?: SeriesPoint[]
  heatmap: HeatCell[]
  topOrgs: (KN & { kind: OrgKind })[]
  topPages: KN[]
  /** Referrers grouped by host (audit A49). */
  referrers: KN[]
  entryPaths: KN[]
  exitPaths: KN[]
  intent: IntentTiles
  /** Error events in range: the count (audit A48), plus the newest ≤ 20 rows. */
  errors: { total: number; recent: EventRow[] }
  recent: RecentSession[]
  /** Respects range + bots and joins sessions (audit A28). */
  replay: { count: number; bytes: number }
  d1: {
    sessions: number
    /** MAX(id) — labelled ≈. */
    eventsApprox: number
    /** MAX(rowid) — labelled ≈. */
    pageVisitsApprox: number
    /** page_count × page_size, null when the pragma is unavailable. */
    sizeBytes: number | null
  }
  /** Sessions with input in the last 60 s (also on /api/ops/live, uncached). */
  activeNow: number
  /** Legacy aliases for the pre-WP5b overview page. */
  visitsToday: number
  uniques: number
  avgActiveMs: number
}

export interface LiveSession {
  sid: string
  startedAt: number
  lastSeenAt: number
  /** sessions.last_path. */
  path: string | null
  country: string | null
  city: string | null
  asOrg: string | null
  deviceType: string | null
  browser: string | null
  pageviews: number
  activeMs: number
  hasReplay: boolean
  isBot: boolean
  intent: IntentFlag[]
}

export interface Live {
  /** Sessions with input in the last 60 s (label ACTIVE NOW // INPUT IN LAST 60 S). */
  activeNow: number
  /** Last 5 min, ≤ 50, newest first. Sessions older than 6 h drop out (D10). */
  sessions: LiveSession[]
  now: number
}

export type SegmentDim = 'device' | 'browser' | 'country' | 'referrerHost'

export interface Segment {
  dim: SegmentDim
  key: string
  sessions: number
  engagedPct: number
  avgActiveMs: number
  /** form_submitted > 0 OR mailto_clicks > 0. */
  contactPct: number
}

/** Existing keys kept (pre-WP5b overview) + the contract's additions. Over a sample of ≤ 5 000 newest sessions. */
export interface Aggregates {
  /** By host (B11). */
  referrers: KN[]
  countries: KN[]
  cities: KN[]
  devices: KN[]
  browsers: KN[]
  /** sessions.lang. */
  languages: KN[]
  os: KN[]
  orgs: KN[]
  entryPaths: KN[]
  exitPaths: KN[]
  /** First tag of the Accept-Language header (session_net). */
  languagesRanked: KN[]
  segments: Segment[]
  sectionDwell: { section: string; avgMs: number; n: number }[]
  scrollFunnel: { pct: number; sessions: number }[]
  /** Newest ≤ 20 js_error rows (payload parsed) — the pre-WP5b overview shape. */
  errors: { ts: number; payload: Record<string, unknown> | null }[]
  sampled: { n: number; total: number }
}

export interface PageStat {
  path: string
  pageviews: number
  sessions: number
  entries: number
  exits: number
  avgActiveMs: number
  p50ActiveMs: number
  avgScrollPct: number
  /** Bounced sessions with entry_path = path ÷ sessions entering at path. */
  bounceRate: number
  errors: number
  /** TEXT CHARS / ACTIVE SEC — higher = skimming or bouncing; null without text_len. */
  textCps: number | null
  prev?: { pageviews: number; avgActiveMs: number }
}

export interface SectionStat {
  path: string
  section: string
  avgDwellMs: number
  n: number
  sessions: number
}

export interface Pages {
  pages: PageStat[]
  sections: SectionStat[]
  /** MIN(page_visits.entered_at) — "PAGE-LEVEL DATA SINCE". */
  since: number | null
}

export interface PageDetail {
  path: string
  series: { day: string; pageviews: number }[]
  sections: SectionStat[]
  /** Sessions whose max scroll on the page reached the milestone. */
  scrollFunnel: { pct: number; sessions: number }[]
  next: KN[]
  prev: KN[]
  clicks: { sel: string; text: string; n: number }[]
  /** 5 s buckets of active_ms, '60s+' last. */
  dwellHist: { bucket: string; n: number }[]
  /** ≤ 50. */
  recent: PageVisitRow[]
}

export type FunnelStep = 'entered' | 'viewed /contact' | 'form focus' | 'mail handoff'

export interface Flows {
  /** from = '(entry)' for landing visits; to = '(exit)' edges come from sessions.exit_path. */
  edges: { from: string; to: string; n: number }[]
  /** Top 20 path prefixes of `depth` (consecutive duplicates collapsed), from ≤ 1 000 newest sessions. */
  sequences: { seq: string[]; n: number }[]
  funnel: { step: FunnelStep; sessions: number }[]
  sampled: { sids: number; total: number }
}

export interface OrgRow {
  org: string
  kind: OrgKind
  asns: number[]
  sessions: number
  visitors: number
  returningVisitors: number
  pageviews: number
  avgActiveMs: number
  mailHandoffs: number
  mailtoClicks: number
  emailCopies: number
  prints: number
  /** ≤ 10 each. */
  countries: string[]
  cities: string[]
  firstSeen: number
  lastSeen: number
  hasReplay: boolean
  rdnsHosts: string[]
  prevSessions?: number
}

export interface Orgs {
  orgs: OrgRow[]
}

export interface OrgDetail {
  org: string
  kind: OrgKind
  asns: number[]
  totals: Stats
  intent: IntentTiles
  series: { day: string; sessions: number }[]
  /** ≤ 100. */
  sessions: SessionRow[]
  visitors: { vid: string; sessions: number; firstSeen: number; lastSeen: number }[]
  pages: KN[]
  countries: KN[]
  rdnsHosts: KN[]
}

export type RecencyBucket = '<1d' | '1-7d' | '7-30d' | '30-90d' | '90d+'
export type FreqBucket = '1' | '2-3' | '4-9' | '10+'

export interface VisitorSummary {
  vid: string
  visitCount: number
  firstSeen: number
  lastSeen: number
  firstAsOrg: string | null
  lastAsOrg: string | null
  firstCountry: string | null
  lastCountry: string | null
  firstReferrer: string | null
  firstEntryPath: string | null
  /** Σ page_visits.active_ms over the visitor's sessions in range. */
  totalActiveMs: number
  sessionsInRange: number
  pagesRead: number
  intent: IntentCounts
  hasReplay: boolean
  recencyDays: number
  freqBucket: FreqBucket
}

export interface Visitors {
  total: number
  rows: VisitorSummary[]
  offset: number
  limit: number
}

export interface VisitorDetail {
  visitor: VisitorRow
  /** Newest first, ≤ 100. */
  sessions: SessionRow[]
  /** Newest first, ≤ 300. */
  pageVisits: PageVisitRow[]
  /** Intent-type events, newest first, ≤ 200. */
  intents: EventRow[]
}

/** Visitors with ≥ 1 session in the window; recency relative to window.end; frequency = visit_count. */
export interface Cohorts {
  recency: { bucket: RecencyBucket; n: number }[]
  frequency: { bucket: FreqBucket; n: number }[]
  /** [recency 5][frequency 4]. */
  matrix: number[][]
  returningShare: number
  heatmap: HeatCell[]
  visitors: number
}

export interface Intent {
  tiles: IntentTiles
  prev?: IntentTiles
  /** focus → input → field → submit (+ invalid / reset / abandon); distinct sessions per step. */
  formFunnel: { step: string; sessions: number }[]
  subjects: KN[]
  /** ≤ 100. */
  copies: {
    ts: number
    sid: string
    snippet: string
    hasEmail: boolean
    path: string | null
    section: string | null
    org: string | null
    country: string | null
  }[]
  searches: KN[]
  /** Find-in-page by path. */
  finds: KN[]
  rage: { sel: string; text: string; n: number }[]
  dead: { sel: string; text: string; n: number }[]
  exitByPage: KN[]
  hoverKeys: { key: string; n: number; avgMs: number }[]
  prints: { ts: number; sid: string; path: string | null; org: string | null }[]
  /** Any intent flag, newest first, ≤ 100. */
  sessions: SessionRow[]
}

export type PerfMetric = 'ttfb' | 'fcp' | 'lcp' | 'cls' | 'inp' | 'dcl' | 'load' | 'softNav'

export interface Percentiles {
  /** `null` when the partition is empty (`n = 0`) — never a fake 0 (R4-M1). */
  p50: number | null
  p75: number | null
  p95: number | null
  n: number
}

export interface Performance {
  dim: NonNullable<OpsQuery['dim']>
  /** PER DOCUMENT LOAD (softNav: PER SPA NAV). */
  vitals: ({ metric: PerfMetric } & Percentiles)[]
  /** Top 12 keys of `dim` by sample size. */
  byDim: ({ key: string; metric: PerfMetric } & Percentiles)[]
  /** SAMPLE n / N — the ≤ 5 000 newest page_perf rows in range. */
  sampled: { n: number; total: number }
  lcpSeries: { day: string; p75: number; n: number }[]
  /** `overflow` marks the last, open-ended bin (everything at or above `from`). */
  hist: { metric: PerfMetric; bins: { from: number; to: number; n: number; overflow?: boolean }[] }[]
  navBreakdown: { phase: string; p50: number }[]
  lcpElements: { sel: string; n: number; p75: number }[]
  resources: {
    avgCount: number
    avgBytes: number
    avgCached: number
    /** From the newest 500 rows' res_slowest. */
    slowest: { name: string; n: number; p75Ms: number }[]
  }
  longTasks: { pagesWithAny: number; avgTotalMs: number; p95Longest: number }
  loaf: { pagesWithAny: number; avgTotalMs: number; p95Longest: number }
  rtt: { bucket: string; n: number }[]
  protocol: KN[]
  tls: KN[]
  cipher: KN[]
  colo: KN[]
}

export type TechDim =
  | 'gpuVendor'
  | 'gpuRenderer'
  | 'webgpu'
  | 'arch'
  | 'bitness'
  | 'platformVer'
  | 'formFactors'
  | 'model'
  | 'brands'
  | 'colorScheme'
  | 'reducedMotion'
  | 'contrast'
  | 'forcedColors'
  | 'touchPoints'
  | 'screens'
  | 'dpr'
  | 'viewports'
  | 'languages'
  | 'acceptLanguage'
  | 'netEffective'
  | 'netType'
  | 'downlink'
  | 'saveData'
  | 'display'
  | 'pdfViewer'
  | 'chUa'
  | 'acceptEncoding'
  | 'protocol'
  | 'tls'
  | 'cipher'
  | 'colo'

export interface Share {
  n: number
  total: number
}

/** Top 12 + Other per dimension over ≤ 5 000 newest sessions. Never groups by ja3_hash / ja4 / tls_*_sha1. */
export type Technology = Record<TechDim, KN[]> & {
  webdriver: Share
  gpc: Share
  dnt: Share
  cookiesOff: number
  /** client_tz_offset_min ≠ cf_tz_offset_min (TZ OFFSET MISMATCH); total = sessions with both offsets. */
  tzMismatch: Share
  battery: { avgLevel: number; chargingPct: number; n: number }
  storageQuota: KN[]
  voices: KN[]
  media: { avgAudioIn: number; avgVideoIn: number; avgAudioOut: number }
  memory: { avgLimitMb: number; avgUsedMb: number }
  sampled: { n: number; total: number }
}

export interface ErrorGroup {
  kind: 'js' | 'resource' | 'console'
  msg: string
  src: string | null
  n: number
  sessions: number
  firstSeen: number
  lastSeen: number
  browsers: KN[]
  paths: KN[]
  sampleStack: string | null
  sampleSid: string
  /** Previous period count, `compare=1`. */
  prev?: number
}

export interface Errors {
  groups: ErrorGroup[]
  series: DayPoint[]
  /** ≤ 50. */
  recent: EventRow[]
  sampled: { n: number; total: number }
}

/** Keyset cursor of the sessions list (audit A24): echo as `before` + `beforeSid`. */
export interface SessionsCursor {
  before: number
  beforeSid: string
}

export interface SessionsPage {
  /** Only on the first page (no `before`); null afterwards. */
  total: number | null
  rows: SessionRow[]
  /** Next-page cursor; null at the end. */
  next: SessionsCursor | null
}

/** `flagged` = the session carries is_bot with no honeypot row and no bot UA (R4-L13). */
export type BotReason = 'ua' | 'honeypot' | 'verified' | 'flagged' | null

export interface SessionDetail {
  session: SessionFull
  visitor: { visitCount: number; firstSeen: number; lastSeen: number; otherSessions: number } | null
  pages: PageVisitRow[]
  perf: PagePerfRow[]
  /** First page (keyset by id, D8). */
  events: EventRow[]
  nextAfter: number | null
  derived: {
    tzMismatch: boolean
    botReason: BotReason
    /** The session's UA when botReason = 'honeypot', so collateral is diagnosable. */
    honeypotUa: string | null
    intentFlags: IntentFlag[]
    /** Σ page_visits.active_ms. */
    activeMs: number
  }
}

export interface SessionEvents {
  events: EventRow[]
  nextAfter: number | null
}

export interface Filters {
  orgs: KN[]
  countries: KN[]
  devices: KN[]
  browsers: KN[]
  oses: KN[]
  paths: KN[]
}

export interface SchemaColumn {
  name: string
  type: string
  notnull: boolean
  pk: boolean
}

export interface SchemaTable {
  name: string
  /** MAX(rowid) — labelled ≈. */
  rowsApprox: number
  columns: SchemaColumn[]
  indexes: { name: string; sql: string | null }[]
}

export interface Schema {
  tables: SchemaTable[]
}

export interface SqlRequest {
  sql: string
  /** 1..1000, default 200. */
  limit?: number
}

export interface SqlResult {
  columns: string[]
  rows: unknown[][]
  rowCount: number
  truncated: boolean
  durationMs: number
  rowsRead: number | null
  explain: boolean
  /** e.g. "alias duplicate columns", "response capped at 1 MB". */
  note?: string
}

/** 400 / 504 body of `/api/ops/sql` (D1 error text passes through). */
export interface SqlError {
  error: string
}

export interface CookbookEntry {
  title: string
  sql: string
  note?: string
}

export type ExportEntity = 'sessions' | 'visitors' | 'page_visits' | 'page_perf' | 'events'
export type ExportFormat = 'csv' | 'ndjson'

/** One rrweb recording (per document load), played sequentially by the UI. */
export interface ReplaySegment {
  rid: string
  /** replay_chunks_v2.page_started_at of the segment's seq 0. */
  startedAt: number
  /** rrweb events, chunks concatenated in seq order. */
  events: unknown[]
}

export interface ReplaySegments {
  segments: ReplaySegment[]
  /** Chunks read vs. rows in the ledger (the R2 subrequest budget stops at 45). */
  chunks: { read: number; total: number }
  truncated: boolean
}

/** 422 body of `/api/ops/replay/[id]` when the inflate budget is exceeded. */
export interface ReplayError {
  error: string
}
