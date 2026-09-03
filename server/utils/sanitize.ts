import {
  EVENT_TYPES,
  PAGE_CAPS,
  type DocFacts,
  type EventType,
  type NavKind,
} from '../../shared/analytics/events.ts'
import { HEARTBEAT_MS } from './collectSql.ts'

/**
 * server/utils/sanitize.ts — the /api/collect whitelist (contract C.1–C.3).
 *
 * Every event type in shared/analytics/events.ts (31) has a case below; an
 * unknown type, a bad `t` or a malformed required field drops the event.
 * Strings are clamped, numbers are clamped into plausible ranges (plan delta
 * A33: durations ≤ 6 h, vitals ≤ 120 s, CLS ≤ 10), extension URLs are
 * scrubbed to `<ext>`, and the rollups the batch needs (counters, page-visit
 * and page-perf merges, the env row) are computed in the same pass.
 *
 * heartbeat / env / vitals / perf are merged into typed tables and NEVER
 * become `events` rows (D1 / D2).
 */

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const MAX_BODY_BYTES = 256 * 1024
export const MAX_EVENTS = 100
export const PAYLOAD_CAP_DEFAULT = 4096
export const PAYLOAD_CAP_ENV = 6144
export const PAYLOAD_CAP_PERF = 8192
/** Plausibility ceiling for any client-reported duration (dwell, active, hidden…). */
export const DURATION_MAX_MS = 6 * 60 * 60 * 1000
/** Vitals ceiling (ttfb / fcp / lcp / inp), plan delta A33. */
export const VITAL_MAX_MS = 120_000
export const CLS_MAX = 10
const TS_PAST_MS = 7 * 24 * 60 * 60 * 1000
const TS_FUTURE_MS = 60_000

const ID_RE = /^[0-9a-fA-F-]{16,64}$/
/** Same-origin pathname: one leading slash (never `//host`), no query / fragment / whitespace. */
const PATH_RE = /^\/(?!\/)[^?#\s]*$/
/** A `.` or `..` path segment — traversal that must never reach a stored path (audit R2-L3). */
const DOT_SEGMENT_RE = /(^|\/)\.\.?(\/|$)/
const SECTION_RE = /^[a-z0-9._:-]{1,40}$/i
const HOVER_KEY_RE = /^(email|github|contact-cta|kpi:[a-z0-9-]{1,30})$/
const RAY_RE = /^[0-9a-f]{16}(-[A-Z]{3})?$/
const HOST_RE = /^[a-z0-9.\-[\]:]{1,120}$/i
const MAILTO_TEL_RE = /^(mailto|tel):[^\s]{1,110}$/i
const RESOURCE_NAME_RE = /^[A-Za-z0-9.-]*\/[^?#\s]*$/
const EXT_RE = /(chrome|moz|safari-web|ms-browser)-extension:\/\/[a-z0-9-]+/gi
const EGG_NAMES = new Set(['console', 'konami'])
const SCROLL_PCTS = new Set([25, 50, 75, 90, 100])
const NAV_KINDS: readonly NavKind[] = ['initial', 'reload', 'back_forward', 'prerender', 'spa', 'spa_back', 'bfcache']
const INITIAL_KINDS = new Set<NavKind>(['initial', 'reload', 'back_forward', 'prerender', 'bfcache'])
const KNOWN_TYPES = new Set<string>(EVENT_TYPES)

// ---------------------------------------------------------------------------
// Primitive clamps (exported for the handlers)
// ---------------------------------------------------------------------------

export function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string' || v.length === 0) return null
  return v.length > max ? v.slice(0, max) : v
}

export function asNum(v: unknown, min = -Infinity, max = Infinity): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.min(max, Math.max(min, v))
}

export function asInt(v: unknown, min: number, max: number): number | null {
  const n = asNum(v)
  if (n === null) return null
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Integer INSIDE [min, max], else null — the opposite of `asInt`, which clamps
 * to the nearest edge. Used where an out-of-range value is evidence the field
 * is junk and the edge would be a lie (tz offsets, soft-nav durations, scroll
 * percentages — audit R2-L4).
 */
export function asIntIn(v: unknown, min: number, max: number): number | null {
  const n = asNum(v)
  if (n === null) return null
  const r = Math.round(n)
  return r < min || r > max ? null : r
}

/** Strict boolean → 0/1 for INTEGER columns; anything else → null. */
export function asBool(v: unknown): 0 | 1 | null {
  if (v === true) return 1
  if (v === false) return 0
  return null
}

export function asEnum<T extends string>(v: unknown, values: readonly T[]): T | null {
  return typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : null
}

/**
 * A same-origin pathname: exactly one leading slash (never a protocol-relative
 * `//host` that a reader could turn into an off-site link), no query /
 * fragment / whitespace, no `.` or `..` segment, ≤ max.
 */
export function asPath(v: unknown, max = 200): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > max || !PATH_RE.test(v)) return null
  if (DOT_SEGMENT_RE.test(v)) return null
  return v
}

export function asObj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function isId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v)
}

/** Installed-extension URLs are a fingerprinting vector — never stored. */
export function scrubExt(s: string | null): string | null {
  return s === null ? null : s.replace(EXT_RE, '<ext>')
}

function clampTs(t: number, now: number): number {
  return Math.min(Math.max(t, now - TS_PAST_MS), now + TS_FUTURE_MS)
}

/** Drop null / undefined keys so stored payloads stay small. */
function compact<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined) out[k] = v
  return out
}

// ---------------------------------------------------------------------------
// Rollup shapes
// ---------------------------------------------------------------------------

export interface CleanEvent {
  t: number
  type: EventType
  name: string | null
  payload: string | null
  path: string
}

/** Initial-document facts from the first pageview of the envelope (sessions columns). */
export interface PageviewInfo {
  path: string
  kind: NavKind
  referrer: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
  screenW: number | null
  screenH: number | null
  dpr: number | null
  viewportW: number | null
  viewportH: number | null
  tz: string | null
  tzOffsetMin: number | null
  lang: string | null
}

/** One page_visits upsert (order-independent MAX/MIN/COALESCE merge in SQL). */
export interface PageVisitMerge {
  pvid: string
  path: string
  enteredAt: number
  leftAt: number | null
  fromPath: string | null
  navKind: NavKind | null
  softNavMs: number | null
  activeMs: number
  hiddenMs: number
  maxScrollPct: number
  scrollPx: number
  scrollReversals: number
  maxScrollVel: number | null
  sectionsSeen: number
  clicks: number
  textLen: number | null
  consoleErrors: number
  leaveReason: 'spa' | 'unload' | null
}

/** One page_perf upsert (first-write per column in SQL). */
export interface PagePerfMerge {
  pvid: string
  ts: number
  path: string
  ttfb: number | null
  fcp: number | null
  lcp: number | null
  lcpSel: string | null
  lcpSize: number | null
  cls: number | null
  inp: number | null
  dns: number | null
  connect: number | null
  tls: number | null
  request: number | null
  response: number | null
  domInteractive: number | null
  dcl: number | null
  load: number | null
  transfer: number | null
  encoded: number | null
  decoded: number | null
  redirects: number | null
  protocol: string | null
  navType: string | null
  resCount: number | null
  resBytes: number | null
  resCached: number | null
  resByType: string | null
  resSlowest: string | null
  longTasks: number | null
  longTaskMs: number | null
  longTaskMaxMs: number | null
  loafCount: number | null
  loafMs: number | null
  loafMaxMs: number | null
  loafScript: string | null
  softNavMs: number | null
}

/** session_env values keyed by column name (SESSION_ENV_COLUMNS minus sid / created_at). */
export type EnvRow = Record<string, string | number | null>

export interface Counters {
  prints: number
  copies: number
  emailCopies: number
  selects: number
  formStarted: number
  formSubmitted: number
  finds: number
  searches: number
  exitIntents: number
  rageClicks: number
  deadClicks: number
  rightClicks: number
  errors: number
  outbounds: number
  mailtoClicks: number
  hovers: number
  eggs: number
  subtabs: number
}

export interface Sums {
  hiddenMs: number
  blurs: number
  ptr: number
  touch: number
  key: number
}

export interface ParsedEnvelope {
  v: 1 | 2
  vid: string
  sid: string
  /** Envelope-level pathname (v1 fallback for a missing per-event `u`). */
  url: string
  /** Rows destined for `events` (pre session-cap). */
  events: CleanEvent[]
  /** First pageview of the envelope (initial-load facts when it carries them). */
  pv: PageviewInfo | null
  /** First `pageview.path` → sessions.entry_path (audit A31). */
  entryPath: string | null
  /** Path of the latest-`t` pageview → sessions.exit_path. */
  exitPath: string | null
  /** `u` of the latest-`t` event of ANY type → sessions.last_path (D10). */
  lastPath: string | null
  navKind: NavKind | null
  /** Whitelisted SSR handoff from the first initial pageview's `nav`. */
  docFacts: DocFacts | null
  clientTzOffsetMin: number | null
  pageviews: number
  /** Accepted heartbeats (the handler applies the wall-clock cap, A33). */
  heartbeats: number
  maxScroll: number
  webdriver: boolean
  maxTouchPoints: number | null
  counters: Counters
  sums: Sums
  firstInteractionMs: number | null
  env: EnvRow | null
  pageVisits: Map<string, PageVisitMerge>
  pagePerf: Map<string, PagePerfMerge>
}

/** Nothing in it that would change any row. */
export function isEmptyEnvelope(p: ParsedEnvelope): boolean {
  return (
    p.events.length === 0
    && p.heartbeats === 0
    && p.pageviews === 0
    && p.env === null
    && p.pageVisits.size === 0
    && p.pagePerf.size === 0
  )
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

function visitOf(out: ParsedEnvelope, pvid: string, path: string, ts: number): PageVisitMerge {
  let m = out.pageVisits.get(pvid)
  if (!m) {
    m = {
      pvid, path, enteredAt: ts, leftAt: null, fromPath: null, navKind: null, softNavMs: null,
      activeMs: 0, hiddenMs: 0, maxScrollPct: 0, scrollPx: 0, scrollReversals: 0, maxScrollVel: null,
      sectionsSeen: 0, clicks: 0, textLen: null, consoleErrors: 0, leaveReason: null,
    }
    out.pageVisits.set(pvid, m)
  }
  return m
}

function perfOf(out: ParsedEnvelope, pvid: string, path: string, ts: number): PagePerfMerge {
  let m = out.pagePerf.get(pvid)
  if (!m) {
    m = {
      pvid, ts, path,
      ttfb: null, fcp: null, lcp: null, lcpSel: null, lcpSize: null, cls: null, inp: null,
      dns: null, connect: null, tls: null, request: null, response: null, domInteractive: null, dcl: null, load: null,
      transfer: null, encoded: null, decoded: null, redirects: null, protocol: null, navType: null,
      resCount: null, resBytes: null, resCached: null, resByType: null, resSlowest: null,
      longTasks: null, longTaskMs: null, longTaskMaxMs: null,
      loafCount: null, loafMs: null, loafMaxMs: null, loafScript: null,
      softNavMs: null,
    }
    out.pagePerf.set(pvid, m)
  }
  return m
}

const max = (a: number, b: number | null): number => (b === null ? a : Math.max(a, b))
const maxN = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b))
const first = <T>(a: T | null, b: T | null): T | null => (a === null ? b : a)

function docFactsOf(v: unknown): DocFacts | null {
  if (typeof v !== 'object' || v === null) return null
  const n = asObj(v)
  const ray = clampStr(n.ray, 40)
  return {
    site: asEnum(n.site, ['none', 'same-origin', 'same-site', 'cross-site'] as const),
    mode: clampStr(n.mode, 16),
    dest: clampStr(n.dest, 16),
    user: n.user === true,
    referer: clampStr(n.referer, 300),
    ray: ray && RAY_RE.test(ray) ? ray : null,
    earlyData: n.earlyData === true,
  }
}

function envRowOf(p: Record<string, unknown>): EnvRow {
  const uad = p.uad === null ? null : asObj(p.uad)
  const hi = p.uadHi === null ? null : asObj(p.uadHi)
  const gpu = p.gpu === null ? null : asObj(p.gpu)
  const webgpu = p.webgpu === null ? null : asObj(p.webgpu)
  const battery = p.battery === null ? null : asObj(p.battery)
  const storage = p.storage === null ? null : asObj(p.storage)
  const media = p.media === null ? null : asObj(p.media)
  const prefers = asObj(p.prefers)
  const screen = asObj(p.screen)
  const memory = p.memory === null ? null : asObj(p.memory)
  const net = p.net === null ? null : asObj(p.net)
  const tz = asObj(p.tz)
  const outer = asObj(p.outer)
  const inner = asObj(p.inner)
  const has = (o: Record<string, unknown> | null): o is Record<string, unknown> => o !== null && Object.keys(o).length > 0
  return {
    webdriver: asBool(p.webdriver),
    ua_brands: has(uad) ? clampStr(uad.brands, 200) : null,
    ua_mobile: has(uad) ? asBool(uad.mobile) : null,
    ua_platform: has(uad) ? clampStr(uad.platform, 40) : null,
    ua_arch: has(hi) ? clampStr(hi.architecture, 40) : null,
    ua_bitness: has(hi) ? clampStr(hi.bitness, 8) : null,
    ua_model: has(hi) ? clampStr(hi.model, 80) : null,
    ua_platform_ver: has(hi) ? clampStr(hi.platformVersion, 40) : null,
    ua_full_versions: has(hi) ? clampStr(hi.fullVersionList, 300) : null,
    ua_form_factors: has(hi) ? clampStr(hi.formFactors, 60) : null,
    ua_wow64: has(hi) ? asBool(hi.wow64) : null,
    languages: clampStr(p.languages, 120),
    max_touch_points: asInt(p.maxTouchPoints, 0, 20),
    pdf_viewer: asBool(p.pdfViewer),
    cookies_enabled: asBool(p.cookies),
    gpc_js: asBool(p.gpc),
    dnt_js: asBool(p.dnt),
    gpu_vendor: has(gpu) ? clampStr(gpu.vendor, 80) : null,
    gpu_renderer: has(gpu) ? clampStr(gpu.renderer, 200) : null,
    webgpu_vendor: has(webgpu) ? clampStr(webgpu.vendor, 60) : null,
    webgpu_arch: has(webgpu) ? clampStr(webgpu.architecture, 40) : null,
    webgpu_device: has(webgpu) ? clampStr(webgpu.device, 80) : null,
    webgpu_desc: has(webgpu) ? clampStr(webgpu.description, 200) : null,
    battery_level: has(battery) ? asInt(battery.level, 0, 100) : null,
    battery_charging: has(battery) ? asBool(battery.charging) : null,
    storage_quota_mb: has(storage) ? asInt(storage.quotaMb, 0, 10_000_000) : null,
    storage_usage_mb: has(storage) ? asInt(storage.usageMb, 0, 10_000_000) : null,
    media_audioinput: has(media) ? asInt(media.audioinput, 0, 50) : null,
    media_videoinput: has(media) ? asInt(media.videoinput, 0, 50) : null,
    media_audiooutput: has(media) ? asInt(media.audiooutput, 0, 50) : null,
    color_scheme: asEnum(prefers.scheme, ['dark', 'light', 'none'] as const),
    reduced_motion: asBool(prefers.reducedMotion),
    contrast: asEnum(prefers.contrast, ['more', 'less', 'custom', 'none'] as const),
    forced_colors: asBool(prefers.forcedColors),
    inverted_colors: asBool(prefers.invertedColors),
    reduced_transparency: asBool(prefers.reducedTransparency),
    avail_w: asInt(screen.availW, 0, 20_000),
    avail_h: asInt(screen.availH, 0, 20_000),
    color_depth: asInt(screen.colorDepth, 0, 64),
    orientation: clampStr(screen.orientation, 24),
    js_heap_limit_mb: has(memory) ? asInt(memory.limitMb, 0, 1_000_000) : null,
    js_heap_used_mb: has(memory) ? asInt(memory.usedMb, 0, 1_000_000) : null,
    net_type: has(net) ? clampStr(net.type, 16) : null,
    net_effective: has(net) ? clampStr(net.effectiveType, 12) : null,
    net_downlink: has(net) ? asNum(net.downlink, 0, 10_000) : null,
    net_rtt: has(net) ? asInt(net.rtt, 0, 100_000) : null,
    net_save_data: has(net) ? asBool(net.saveData) : null,
    voices: asInt(p.voices, 0, 1000),
    tz_name: clampStr(tz.name, 64),
    tz_offset_min: asIntIn(tz.offsetMin, -900, 900),
    intl_locale: clampStr(p.locale, 24),
    display_mode: asEnum(p.display, ['standalone', 'browser', 'minimal-ui', 'fullscreen'] as const),
    outer_w: asInt(outer.w, 0, 20_000),
    outer_h: asInt(outer.h, 0, 20_000),
    inner_w: asInt(inner.w, 0, 20_000),
    inner_h: asInt(inner.h, 0, 20_000),
    device_memory: asNum(p.deviceMemory, 0, 64),
    cores: asInt(p.cores, 1, 128),
    platform: clampStr(p.platform, 40),
    touch: asBool(p.touch),
  }
}

// ---------------------------------------------------------------------------
// Per-event whitelist
// ---------------------------------------------------------------------------

interface Ctx {
  now: number
  v: 1 | 2
  fallbackPath: string
  /** Per-type count within this envelope (PAGE_CAPS re-applied per envelope). */
  perType: Map<string, number>
  /** Latest event `t` seen so far (any type) and latest pageview `t`. */
  lastT: number
  lastPvT: number | null
  /** entry_path / nav_kind already came from an INITIAL_KINDS pageview (R2-M3). */
  entryFromInitial: boolean
}

/**
 * Whitelist + clamp one raw event, updating the rollups on `out`.
 * Returns the row to insert into `events`, or null when the event is dropped
 * or merged elsewhere (heartbeat / env / vitals / perf).
 */
function sanitizeEvent(raw: Record<string, unknown>, ctx: Ctx, out: ParsedEnvelope): CleanEvent | null {
  const type = raw.type
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) return null
  const t = asNum(raw.t)
  if (t === null) return null
  const ts = clampTs(t, ctx.now)
  const p = asObj(raw.p)
  const path = asPath(raw.u, 200) ?? ctx.fallbackPath
  const ev = type as EventType

  // Per-envelope per-type cap (client PAGE_CAPS re-applied server-side).
  const cap = PAGE_CAPS[ev]
  if (cap !== undefined) {
    const n = (ctx.perType.get(ev) ?? 0) + 1
    ctx.perType.set(ev, n)
    if (n > cap) return null
  }

  let name: string | null = null
  let payload: Record<string, unknown> | null = null
  let payloadCap = PAYLOAD_CAP_DEFAULT
  let store = true

  switch (ev) {
    case 'pageview': {
      const pvid = isId(p.pvid) ? p.pvid : crypto.randomUUID()
      const pvPath = asPath(p.path, 200) ?? path
      const kind = asEnum(p.kind, NAV_KINDS) ?? 'initial'
      const utm = asObj(p.utm)
      const screen = asObj(p.screen)
      const viewport = asObj(p.viewport)
      const info: PageviewInfo = {
        path: pvPath,
        kind,
        referrer: clampStr(p.referrer, 300),
        utmSource: clampStr(utm.source, 120),
        utmMedium: clampStr(utm.medium, 120),
        utmCampaign: clampStr(utm.campaign, 120),
        utmTerm: clampStr(utm.term, 120),
        utmContent: clampStr(utm.content, 120),
        screenW: asInt(screen.w, 0, 20_000),
        screenH: asInt(screen.h, 0, 20_000),
        dpr: asNum(screen.dpr, 0.1, 10),
        viewportW: asInt(viewport.w, 0, 20_000),
        viewportH: asInt(viewport.h, 0, 20_000),
        tz: clampStr(p.tz, 64),
        tzOffsetMin: asIntIn(p.tzOffsetMin, -900, 900),
        lang: clampStr(p.lang, 24),
      }
      const isInitial = INITIAL_KINDS.has(kind)
      const nav = isInitial ? docFactsOf(p.nav) : null
      const softNavMs = asIntIn(p.softNavMs, 0, 120_000)
      const textLen = asInt(p.textLen, 0, 10_000_000)
      payload = compact({
        pvid,
        path: pvPath,
        from: asPath(p.from, 200),
        kind,
        softNavMs,
        referrer: info.referrer,
        utm: info.utmSource || info.utmMedium || info.utmCampaign || info.utmTerm || info.utmContent
          ? compact({ source: info.utmSource, medium: info.utmMedium, campaign: info.utmCampaign, term: info.utmTerm, content: info.utmContent })
          : null,
        screen: info.screenW !== null ? { w: info.screenW, h: info.screenH, dpr: info.dpr } : null,
        viewport: info.viewportW !== null ? { w: info.viewportW, h: info.viewportH } : null,
        tz: info.tz,
        tzOffsetMin: info.tzOffsetMin,
        lang: info.lang,
        nav,
        textLen,
        // v1 device facts (still accepted into the payload; typed in session_env for v2).
        platform: clampStr(p.platform, 40),
        touch: p.touch === true ? true : null,
        deviceMemory: asNum(p.deviceMemory, 0, 64),
        cores: asInt(p.cores, 1, 128),
        connection: clampStr(p.connection, 24),
      })
      out.pageviews++
      if (!out.pv) out.pv = info
      // entry_path / nav_kind (and visitors.first_entry_path) describe the
      // DOCUMENT the visit started on, so only an initial-load pageview may set
      // them. An SPA pageview is accepted as a fallback only when the envelope
      // cannot carry one — a v1 envelope, or a pageview with no `from` (audit
      // R2-M3): an out-of-order beacon can no longer freeze an SPA path as the
      // landing page.
      if (isInitial) {
        if (!ctx.entryFromInitial) {
          ctx.entryFromInitial = true
          out.entryPath = pvPath
          out.navKind = kind
        }
      } else if (out.entryPath === null && (ctx.v === 1 || p.from === null || p.from === undefined)) {
        out.entryPath = pvPath
        out.navKind = kind
      }
      if (out.clientTzOffsetMin === null) out.clientTzOffsetMin = info.tzOffsetMin
      if (nav && !out.docFacts) out.docFacts = nav
      if (ctx.lastPvT === null || ts >= ctx.lastPvT) {
        ctx.lastPvT = ts
        out.exitPath = pvPath
      }
      const m = visitOf(out, pvid, pvPath, ts)
      m.enteredAt = Math.min(m.enteredAt, ts)
      m.fromPath = first(m.fromPath, asPath(p.from, 200))
      m.navKind = first(m.navKind, kind)
      m.softNavMs = first(m.softNavMs, softNavMs)
      m.textLen = first(m.textLen, textLen)
      // Seed page_perf from the pageview itself so `path` / `ts` describe the
      // document that loaded, not the page that happened to be current when a
      // vitals / perf metric fired (audit R2-M1). First write wins in the map
      // and in the SQL upsert, so a later vitals event for another path merges
      // into THIS row without moving it.
      const pp = perfOf(out, pvid, pvPath, ts)
      pp.path = pvPath
      pp.ts = Math.min(pp.ts, ts)
      if (softNavMs !== null) pp.softNavMs = first(pp.softNavMs, softNavMs)
      break
    }
    case 'page_leave': {
      if (!isId(p.pvid)) return null
      const pvid = p.pvid
      const pvPath = asPath(p.path, 200) ?? path
      const enteredAtRaw = asNum(p.enteredAt)
      // entered_at can never be later than the leave it is reported with (R2-L1).
      const enteredAt = enteredAtRaw === null ? ts : Math.min(clampTs(enteredAtRaw, ctx.now), ts)
      const activeMs = asInt(p.activeMs, 0, DURATION_MAX_MS) ?? 0
      const hiddenMs = asInt(p.hiddenMs, 0, DURATION_MAX_MS) ?? 0
      const blurs = asInt(p.blurs, 0, 10_000) ?? 0
      const maxScrollPct = asIntIn(p.maxScrollPct, 0, 100) ?? 0
      const scrollPx = asInt(p.scrollPx, 0, 10_000_000) ?? 0
      const scrollReversals = asInt(p.scrollReversals, 0, 10_000) ?? 0
      const maxScrollVel = asInt(p.maxScrollVel, 0, 1_000_000)
      const sectionsSeen = asInt(p.sectionsSeen, 0, 10_000) ?? 0
      const clicks = asInt(p.clicks, 0, 10_000) ?? 0
      const ptr = asInt(p.ptr, 0, 10_000) ?? 0
      const touch = asInt(p.touch, 0, 10_000) ?? 0
      const key = asInt(p.key, 0, 10_000) ?? 0
      const consoleErrors = asInt(p.consoleErrors, 0, 10_000) ?? 0
      const textLen = asInt(p.textLen, 0, 10_000_000)
      const reason = asEnum(p.reason, ['spa', 'unload'] as const)
      payload = compact({
        pvid, path: pvPath, enteredAt, activeMs, hiddenMs, blurs, maxScrollPct, scrollPx, scrollReversals,
        maxScrollVel, sectionsSeen, clicks, ptr, touch, key, consoleErrors, textLen, reason,
      })
      out.sums.hiddenMs += hiddenMs
      out.sums.blurs += blurs
      out.sums.ptr += ptr
      out.sums.touch += touch
      out.sums.key += key
      if (maxScrollPct > out.maxScroll) out.maxScroll = maxScrollPct
      const m = visitOf(out, pvid, pvPath, enteredAt)
      m.enteredAt = Math.min(m.enteredAt, enteredAt)
      m.leftAt = maxN(m.leftAt, ts)
      m.activeMs = Math.max(m.activeMs, activeMs)
      m.hiddenMs = Math.max(m.hiddenMs, hiddenMs)
      m.maxScrollPct = Math.max(m.maxScrollPct, maxScrollPct)
      m.scrollPx = Math.max(m.scrollPx, scrollPx)
      m.scrollReversals = Math.max(m.scrollReversals, scrollReversals)
      m.maxScrollVel = maxN(m.maxScrollVel, maxScrollVel)
      m.sectionsSeen = Math.max(m.sectionsSeen, sectionsSeen)
      m.clicks = Math.max(m.clicks, clicks)
      m.textLen = first(m.textLen, textLen)
      m.consoleErrors = Math.max(m.consoleErrors, consoleErrors)
      if (reason) m.leaveReason = reason
      break
    }
    case 'heartbeat': {
      out.heartbeats++
      store = false
      if (isId(p.pvid)) {
        const m = visitOf(out, p.pvid, path, ts)
        m.activeMs = max(m.activeMs, asInt(p.activeMs, 0, DURATION_MAX_MS))
        m.maxScrollPct = max(m.maxScrollPct, asIntIn(p.maxScrollPct, 0, 100))
        if (m.maxScrollPct > out.maxScroll) out.maxScroll = m.maxScrollPct
      }
      break
    }
    case 'visibility': {
      const state = asEnum(p.state, ['hidden', 'visible'] as const)
      if (!state) return null
      const ms = asInt(p.ms, 0, DURATION_MAX_MS)
      const pvid = isId(p.pvid) ? p.pvid : null
      const activeMs = asInt(p.activeMs, 0, DURATION_MAX_MS)
      const maxScrollPct = asIntIn(p.maxScrollPct, 0, 100)
      payload = compact({ state, ms, pvid, activeMs, maxScrollPct })
      if (pvid && state === 'hidden') {
        const m = visitOf(out, pvid, path, ts)
        m.leftAt = maxN(m.leftAt, ts)
        m.activeMs = max(m.activeMs, activeMs)
        m.maxScrollPct = max(m.maxScrollPct, maxScrollPct)
      }
      break
    }
    case 'section_enter': {
      name = clampStr(raw.name, 40)
      if (!name || !SECTION_RE.test(name)) return null
      break
    }
    case 'section_exit': {
      name = clampStr(raw.name, 40)
      if (!name || !SECTION_RE.test(name)) return null
      payload = compact({ dwellMs: asInt(p.dwellMs, 0, DURATION_MAX_MS), pvid: isId(p.pvid) ? p.pvid : null })
      break
    }
    case 'scroll_depth': {
      const pct = asNum(p.pct)
      if (pct === null || !SCROLL_PCTS.has(pct)) return null
      payload = { pct }
      if (pct > out.maxScroll) out.maxScroll = pct
      break
    }
    case 'click': {
      const button = asInt(p.button, 0, 2) ?? 0
      payload = compact({
        sel: clampStr(p.sel, 120),
        text: clampStr(p.text, 60),
        x: asInt(p.x, -100_000, 100_000),
        y: asInt(p.y, -100_000, 100_000),
        section: clampStr(p.section, 40),
        zone: clampStr(p.zone, 20),
        tag: clampStr(p.tag, 12),
        button,
        kind: asEnum(p.kind, ['pointer', 'touch', 'pen', 'keyboard'] as const) ?? 'pointer',
        href: asPath(p.href, 200),
        mod: p.mod === true ? true : null,
      })
      if (button === 2) out.counters.rightClicks++
      break
    }
    case 'rage_click': {
      payload = compact({
        n: asInt(p.n, 3, 100) ?? 3,
        sel: clampStr(p.sel, 120),
        x: asInt(p.x, -100_000, 100_000),
        y: asInt(p.y, -100_000, 100_000),
        section: clampStr(p.section, 40),
      })
      out.counters.rageClicks++
      break
    }
    case 'dead_click': {
      payload = compact({ sel: clampStr(p.sel, 120), text: clampStr(p.text, 60), section: clampStr(p.section, 40) })
      out.counters.deadClicks++
      break
    }
    case 'outbound': {
      const rawName = clampStr(raw.name, 120)
      if (!rawName) return null
      const lower = rawName.toLowerCase()
      const hrefRaw = clampStr(p.href, 300)
      let href: string | null = null
      if (lower === 'mailto' || lower === 'tel') {
        name = lower
        href = hrefRaw && hrefRaw.length <= 120 && MAILTO_TEL_RE.test(hrefRaw) ? hrefRaw : null
      } else {
        if (!HOST_RE.test(rawName)) return null
        name = lower
        href = hrefRaw && /^https?:\/\//i.test(hrefRaw) ? hrefRaw : null
      }
      payload = compact({
        href,
        label: clampStr(p.label, 80),
        section: clampStr(p.section, 40),
        zone: clampStr(p.zone, 20),
        button: asInt(p.button, 0, 1) ?? 0,
        newTab: p.newTab === true ? true : null,
      })
      out.counters.outbounds++
      if (name === 'mailto') out.counters.mailtoClicks++
      break
    }
    case 'print': {
      const phase = asEnum(p.phase, ['before', 'after'] as const)
      if (!phase) return null
      payload = compact({ phase, ms: asInt(p.ms, 0, 3_600_000) })
      if (phase === 'before') out.counters.prints++
      break
    }
    case 'copy': {
      const hasEmail = p.hasEmail === true
      payload = compact({
        len: asInt(p.len, 0, 1_000_000) ?? 0,
        snippet: clampStr(p.snippet, 80),
        hasEmail,
        section: clampStr(p.section, 40),
        sel: clampStr(p.sel, 120),
      })
      out.counters.copies++
      if (hasEmail) out.counters.emailCopies++
      break
    }
    case 'select': {
      payload = compact({ len: asInt(p.len, 0, 1_000_000) ?? 0, hasEmail: p.hasEmail === true, section: clampStr(p.section, 40) })
      out.counters.selects++
      break
    }
    case 'form': {
      // contact.vue names the event after the step; the seed names it 'contact'.
      // Either is fine — the step lives in the payload, so store one name.
      if (raw.name != null && clampStr(raw.name, 20) === null) return null
      name = 'contact'
      const step = asEnum(p.step, ['focus', 'input', 'field', 'submit', 'invalid', 'reset', 'abandon'] as const)
      if (!step) return null
      payload = compact({
        step,
        field: asEnum(p.field, ['author', 'subject', 'body'] as const),
        subject: clampStr(p.subject, 40),
        bodyLen: asInt(p.bodyLen, 0, 100_000),
        authorFilled: asBool(p.authorFilled) === null ? null : p.authorFilled === true,
        msSinceFocus: asInt(p.msSinceFocus, 0, DURATION_MAX_MS),
      })
      if (step === 'focus') out.counters.formStarted++
      if (step === 'submit') out.counters.formSubmitted++
      break
    }
    case 'find': {
      payload = {}
      out.counters.finds++
      break
    }
    case 'site_search': {
      const q = clampStr(p.q, 40)
      payload = compact({ q: q ? q.toLowerCase() : null, results: asInt(p.results, 0, 100), chosen: clampStr(p.chosen, 40) })
      out.counters.searches++
      break
    }
    case 'exit_intent': {
      payload = compact({ x: asInt(p.x, -10_000, 10_000), y: asInt(p.y, -10_000, 10_000) })
      out.counters.exitIntents++
      break
    }
    case 'viewport': {
      const cause = asEnum(p.cause, ['resize', 'zoom', 'pinch', 'orientation'] as const)
      if (!cause) return null
      payload = compact({
        w: asInt(p.w, 0, 20_000),
        h: asInt(p.h, 0, 20_000),
        scale: asNum(p.scale, 0.1, 10),
        dpr: asNum(p.dpr, 0.1, 10),
        orientation: clampStr(p.orientation, 24),
        cause,
      })
      break
    }
    case 'first_interaction': {
      const ms = asInt(p.ms, 0, 3_600_000)
      if (ms === null) return null
      payload = compact({ ms, kind: asEnum(p.kind, ['pointer', 'touch', 'keyboard', 'wheel'] as const) })
      out.firstInteractionMs = out.firstInteractionMs === null ? ms : Math.min(out.firstInteractionMs, ms)
      break
    }
    case 'hover': {
      name = clampStr(raw.name, 40)
      if (!name || !HOVER_KEY_RE.test(name)) return null
      const ms = asInt(p.ms, 300, 600_000)
      if (ms === null) return null
      payload = { ms }
      out.counters.hovers++
      break
    }
    case 'subtab': {
      name = clampStr(raw.name, 40)
      if (!name) return null
      payload = compact({ index: asInt(p.index, 0, 20) })
      out.counters.subtabs++
      break
    }
    case 'env': {
      store = false
      const row = envRowOf(p)
      if (JSON.stringify(row).length <= PAYLOAD_CAP_ENV) {
        if (out.env) {
          for (const [k, v] of Object.entries(row)) if (v !== null) out.env[k] = v
        } else {
          out.env = row
        }
        if (row.webdriver === 1) out.webdriver = true
        if (typeof row.max_touch_points === 'number') out.maxTouchPoints = row.max_touch_points
      }
      break
    }
    case 'vitals': {
      store = false
      if (!isId(p.pvid)) return null
      const pp = perfOf(out, p.pvid, path, ts)
      pp.ttfb = first(pp.ttfb, asInt(p.ttfb, 0, VITAL_MAX_MS))
      pp.fcp = first(pp.fcp, asInt(p.fcp, 0, VITAL_MAX_MS))
      pp.lcp = first(pp.lcp, asInt(p.lcp, 0, VITAL_MAX_MS))
      pp.lcpSel = first(pp.lcpSel, clampStr(p.lcpSel, 120))
      pp.lcpSize = first(pp.lcpSize, asInt(p.lcpSize, 0, 100_000_000))
      pp.cls = first(pp.cls, asNum(p.cls, 0, CLS_MAX))
      pp.inp = first(pp.inp, asInt(p.inp, 0, VITAL_MAX_MS))
      break
    }
    case 'perf': {
      store = false
      payloadCap = PAYLOAD_CAP_PERF
      if (!isId(p.pvid)) return null
      const nav = asObj(p.nav)
      const res = asObj(p.resources)
      const byType = asObj(res.byType)
      const lt = asObj(p.longTasks)
      const loaf = p.loaf === undefined || p.loaf === null ? null : asObj(p.loaf)
      const slowest = Array.isArray(res.slowest)
        ? res.slowest
            .slice(0, 5)
            .map((r) => {
              const o = asObj(r)
              const rName = clampStr(o.name, 120)
              if (!rName || !RESOURCE_NAME_RE.test(rName)) return null
              return compact({
                name: rName,
                dur: asInt(o.dur, 0, 600_000),
                size: asInt(o.size, 0, 1_000_000_000),
                type: clampStr(o.type, 12),
              })
            })
            .filter((r): r is Record<string, unknown> => r !== null)
        : []
      const byTypeRow = Object.keys(byType).length
        ? compact({
            script: asInt(byType.script, 0, 10_000),
            css: asInt(byType.css, 0, 10_000),
            font: asInt(byType.font, 0, 10_000),
            img: asInt(byType.img, 0, 10_000),
            fetch: asInt(byType.fetch, 0, 10_000),
            other: asInt(byType.other, 0, 10_000),
          })
        : null
      const merged: Omit<PagePerfMerge, 'pvid' | 'ts' | 'path' | 'ttfb' | 'fcp' | 'lcp' | 'lcpSel' | 'lcpSize' | 'cls' | 'inp' | 'softNavMs'> = {
        dns: asInt(nav.dns, 0, 600_000),
        connect: asInt(nav.connect, 0, 600_000),
        tls: asInt(nav.tls, 0, 600_000),
        request: asInt(nav.request, 0, 600_000),
        response: asInt(nav.response, 0, 600_000),
        domInteractive: asInt(nav.domInteractive, 0, 600_000),
        dcl: asInt(nav.dcl, 0, 600_000),
        load: asInt(nav.load, 0, 600_000),
        transfer: asInt(nav.transfer, 0, 1_000_000_000),
        encoded: asInt(nav.encoded, 0, 1_000_000_000),
        decoded: asInt(nav.decoded, 0, 1_000_000_000),
        redirects: asInt(nav.redirects, 0, 50),
        protocol: clampStr(nav.protocol, 12),
        navType: clampStr(nav.type, 16),
        resCount: asInt(res.count, 0, 10_000),
        resBytes: asInt(res.bytes, 0, 1_000_000_000),
        resCached: asInt(res.cached, 0, 10_000),
        resByType: byTypeRow ? JSON.stringify(byTypeRow) : null,
        resSlowest: slowest.length ? JSON.stringify(slowest) : null,
        longTasks: asInt(lt.count, 0, 10_000),
        longTaskMs: asInt(lt.totalMs, 0, 600_000),
        longTaskMaxMs: asInt(lt.longestMs, 0, 600_000),
        loafCount: loaf ? asInt(loaf.count, 0, 10_000) : null,
        loafMs: loaf ? asInt(loaf.totalMs, 0, 600_000) : null,
        loafMaxMs: loaf ? asInt(loaf.longestMs, 0, 600_000) : null,
        loafScript: loaf ? clampStr(loaf.script, 120) : null,
      }
      if (JSON.stringify(merged).length > payloadCap) return null
      const pp = perfOf(out, p.pvid, path, ts)
      for (const k of Object.keys(merged) as Array<keyof typeof merged>) {
        if (pp[k] === null && merged[k] !== null) (pp as unknown as Record<string, unknown>)[k] = merged[k]
      }
      break
    }
    case 'js_error': {
      payload = compact({
        msg: scrubExt(clampStr(p.msg, 300)),
        src: scrubExt(clampStr(p.src, 200)),
        line: asInt(p.line, 0, 10_000_000),
        stack: scrubExt(clampStr(p.stack, 1000)),
      })
      out.counters.errors++
      break
    }
    case 'resource_error': {
      payload = compact({ tag: clampStr(p.tag, 10), src: scrubExt(clampStr(p.src, 200)), sel: clampStr(p.sel, 120) })
      out.counters.errors++
      break
    }
    case 'console_error': {
      payload = compact({ msg: scrubExt(clampStr(p.msg, 300)) })
      out.counters.errors++
      break
    }
    case 'easter_egg': {
      name = clampStr(raw.name, 20)
      if (!name || !EGG_NAMES.has(name)) return null
      out.counters.eggs++
      break
    }
    case 'replay_stopped': {
      payload = compact({ reason: clampStr(p.reason, 80) })
      break
    }
    case 'replay_chunk_lost': {
      payload = compact({
        seq: asInt(p.seq, 0, 9999),
        rid: isId(p.rid) ? p.rid : null,
        status: asInt(p.status, 0, 999),
      })
      break
    }
  }

  // last_path: the latest-t event of ANY ACCEPTED type (merged ones included).
  // Updated only here, past every `return null` above, so a dropped event can
  // no longer rewrite sessions.last_path (audit R2-L2).
  if (out.lastPath === null || ts >= ctx.lastT) {
    ctx.lastT = ts
    out.lastPath = path
  }

  if (!store) return null

  let json: string | null = null
  if (payload) {
    json = JSON.stringify(payload)
    if (json.length > payloadCap) json = null
  }
  return { t: ts, type: ev, name, payload: json, path }
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/** Parse + whitelist a raw JSON body. Null = 400. */
export function parseEnvelope(body: unknown, now: number): ParsedEnvelope | null {
  const env = asObj(body)
  const v = env.v === 1 ? 1 : env.v === 2 ? 2 : null
  if (v === null) return null
  const vid = env.vid
  const sid = env.sid
  if (!isId(vid) || !isId(sid)) return null
  if (typeof env.returning !== 'boolean') return null // validated, no longer stored (B8)
  if (typeof env.url !== 'string' || env.url.length === 0 || env.url.length > 300) return null
  if (!Array.isArray(env.events)) return null
  const fallbackPath = asPath(env.url, 200) ?? '/'

  const parsed: ParsedEnvelope = {
    v,
    vid,
    sid,
    url: fallbackPath,
    events: [],
    pv: null,
    entryPath: null,
    exitPath: null,
    lastPath: null,
    navKind: null,
    docFacts: null,
    clientTzOffsetMin: null,
    pageviews: 0,
    heartbeats: 0,
    maxScroll: 0,
    webdriver: false,
    maxTouchPoints: null,
    counters: {
      prints: 0, copies: 0, emailCopies: 0, selects: 0, formStarted: 0, formSubmitted: 0, finds: 0, searches: 0,
      exitIntents: 0, rageClicks: 0, deadClicks: 0, rightClicks: 0, errors: 0, outbounds: 0, mailtoClicks: 0,
      hovers: 0, eggs: 0, subtabs: 0,
    },
    sums: { hiddenMs: 0, blurs: 0, ptr: 0, touch: 0, key: 0 },
    firstInteractionMs: null,
    env: null,
    pageVisits: new Map(),
    pagePerf: new Map(),
  }
  const ctx: Ctx = { now, v, fallbackPath, perType: new Map(), lastT: -Infinity, lastPvT: null, entryFromInitial: false }
  for (const raw of (env.events as unknown[]).slice(0, MAX_EVENTS)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const clean = sanitizeEvent(raw as Record<string, unknown>, ctx, parsed)
    if (clean) parsed.events.push(clean)
  }
  // Per-envelope sum caps (A33): a single envelope can never claim more than
  // 6 h hidden or 10 000 of any input counter.
  parsed.sums.hiddenMs = Math.min(parsed.sums.hiddenMs, DURATION_MAX_MS)
  for (const k of ['blurs', 'ptr', 'touch', 'key'] as const) parsed.sums[k] = Math.min(parsed.sums[k], 10_000)
  return parsed
}
