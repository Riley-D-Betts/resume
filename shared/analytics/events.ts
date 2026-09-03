// shared/analytics/events.ts — the analytics wire contract (v2), shared by the
// client tracker, the ingest handler, the ops console and the unit tests.
//
// PURE MODULE: no Nuxt auto-imports, no `enum`, no constructor parameter
// properties, `import type` only, relative imports with explicit `.ts`
// extensions — `node --test` runs it with Node's native type stripping.
// App code imports it as `#shared/analytics/events`.

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/** Current wire version. v1 envelopes (single-page tracker) are still accepted. */
export const WIRE_VERSION = 2

export interface WireEnvelope {
  v: 1 | 2
  vid: string
  sid: string
  /** Validated, no longer stored — the server derives `is_returning` (contract B8). */
  returning: boolean
  /** Pathname at flush; the v1 fallback for a missing per-event `u`. */
  url: string
  events: WireEvent[]
}

export interface WireEventBase {
  /** Client clock, ms since epoch; kept for event order only (server owns `started_at`). */
  t: number
  type: EventType
  name: string | null
  /** Pathname at emit, ≤ 200 chars (K4). */
  u: string
}

// ---------------------------------------------------------------------------
// Event catalogue — exactly 31 types, in this order (contract B.4 + plan delta
// `replay_chunk_lost`). The server whitelist, PAGE_CAPS and the ops console
// derive from this tuple.
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  'pageview',
  'page_leave',
  'heartbeat',
  'visibility',
  'section_enter',
  'section_exit',
  'scroll_depth',
  'click',
  'rage_click',
  'dead_click',
  'outbound',
  'print',
  'copy',
  'select',
  'form',
  'find',
  'site_search',
  'exit_intent',
  'viewport',
  'first_interaction',
  'hover',
  'subtab',
  'env',
  'vitals',
  'perf',
  'js_error',
  'resource_error',
  'console_error',
  'easter_egg',
  'replay_stopped',
  'replay_chunk_lost',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

// ---------------------------------------------------------------------------
// Payloads (contract B.4 / B.5). Clamps are applied client-side and re-applied
// by the server (contract C.2).
// ---------------------------------------------------------------------------

export type NavKind = 'initial' | 'reload' | 'back_forward' | 'prerender' | 'spa' | 'spa_back' | 'bfcache'

/** Document-request facts captured by the SSR middleware (initial loads only). */
export interface DocFacts {
  site: 'none' | 'same-origin' | 'same-site' | 'cross-site' | null
  mode: string | null
  dest: string | null
  user: boolean
  referer: string | null
  ray: string | null
  earlyData: boolean
}

export interface UtmP {
  source: string | null
  medium: string | null
  campaign: string | null
  term: string | null
  content: string | null
}

export interface PageviewP {
  /** Page-visit id: pinned `docPvid` for the document load, fresh per SPA visit. */
  pvid: string
  /** Pathname of the visit; the initial one is `location.pathname` captured at init (A31). */
  path: string
  from: string | null
  kind: NavKind
  /** spa / spa_back only. */
  softNavMs?: number
  // -- initial document loads only (kind ∈ initial | reload | back_forward | prerender) --
  referrer?: string
  utm?: UtmP
  screen?: { w: number; h: number; dpr: number }
  viewport?: { w: number; h: number }
  tz?: string
  /** `-new Date().getTimezoneOffset()`, minutes east of UTC, −900..900. */
  tzOffsetMin?: number
  lang?: string
  nav?: DocFacts | null
}

export interface PageLeaveP {
  pvid: string
  path: string
  enteredAt: number
  activeMs: number
  hiddenMs: number
  blurs: number
  maxScrollPct: number
  scrollPx: number
  scrollReversals: number
  maxScrollVel: number
  sectionsSeen: number
  clicks: number
  ptr: number
  touch: number
  key: number
  consoleErrors: number
  /** `main.innerText.length` measured at idle after `page:finish`; null when unmeasured. */
  textLen: number | null
  reason: 'spa' | 'unload'
}

/** Counted server-side (15 s steps) and MAX-merged into page_visits; never stored as a row. */
export interface HeartbeatP {
  pvid: string
  activeMs: number
  maxScrollPct: number
}

export interface VisibilityP {
  state: 'hidden' | 'visible'
  ms: number
  pvid?: string
  activeMs?: number
  maxScrollPct?: number
}

/** `section_enter` carries no payload (the name is the section). */
export interface SectionExitP {
  dwellMs: number
  pvid: string
}

export interface ScrollDepthP {
  pct: 25 | 50 | 75 | 90 | 100
}

export interface ClickP {
  sel: string
  text: string
  x: number
  y: number
  section?: string
  zone?: string
  tag: string
  button: 0 | 1 | 2
  kind: 'pointer' | 'touch' | 'pen' | 'keyboard'
  href?: string
  mod: boolean
}

export interface RageClickP {
  n: number
  sel: string
  x: number
  y: number
  section?: string
}

export interface DeadClickP {
  sel: string
  text: string
  section?: string
}

/** name = host | 'mailto' | 'tel'. */
export interface OutboundP {
  href: string
  label: string
  section?: string
  zone?: string
  button: 0 | 1
  newTab: boolean
}

export interface PrintP {
  phase: 'before' | 'after'
  ms?: number
}

/** Never captured inside input / textarea / [contenteditable] (contract D18). */
export interface CopyP {
  len: number
  /** ≤ 80 chars. */
  snippet: string
  hasEmail: boolean
  section?: string
  sel: string
}

export interface SelectP {
  len: number
  hasEmail: boolean
  section?: string
}

/** Contact-form funnel. NEVER values; `submit` = the page composed a mailto and handed off. */
export interface FormP {
  step: 'focus' | 'input' | 'field' | 'submit' | 'invalid' | 'reset' | 'abandon'
  field?: 'author' | 'subject' | 'body'
  subject?: string
  bodyLen?: number
  authorFilled?: boolean
  msSinceFocus?: number
}

export interface SiteSearchP {
  /** Lowercased, ≤ 40 chars. */
  q: string
  results: number
  chosen?: string
}

export interface ExitIntentP {
  x: number
  y: number
}

export interface ViewportP {
  w: number
  h: number
  scale: number
  dpr: number
  orientation: string
  cause: 'resize' | 'zoom' | 'pinch' | 'orientation'
}

export interface FirstInteractionP {
  ms: number
  kind: 'pointer' | 'touch' | 'keyboard' | 'wheel'
}

/** name = hover key (`email | github | contact-cta | kpi:<slug>`). */
export interface HoverP {
  ms: number
}

/** name = tab label. */
export interface SubtabP {
  index: number
}

/** Once per document load; `pvid` is always the docPvid. */
export interface VitalsP {
  pvid: string
  ttfb?: number
  fcp?: number
  lcp?: number
  lcpSel?: string
  lcpSize?: number
  /** Max session window (≤ 1 s gap, ≤ 5 s span) — audit A29. */
  cls: number
  /** `interactionId > 0` entries only (contract B6). */
  inp?: number
}

export interface PerfNav {
  dns: number
  connect: number
  tls: number
  request: number
  response: number
  domInteractive: number
  dcl: number
  /** null when perf is forced before the load event has fired. */
  load: number | null
  transfer: number
  encoded: number
  decoded: number
  redirects: number
  protocol: string
  type: string
}

export interface PerfResource {
  /** Same-origin `/path`, cross-origin `host/path`; ≤ 120 chars. */
  name: string
  dur: number
  size: number
  type: string
}

export interface PerfResources {
  count: number
  bytes: number
  cached: number
  byType: { script: number; css: number; font: number; img: number; fetch: number; other: number }
  /** ≤ 5 entries. */
  slowest: PerfResource[]
}

export interface PerfTasks {
  count: number
  totalMs: number
  longestMs: number
}

/** Once per document load; `pvid` is always the docPvid. */
export interface PerfP {
  pvid: string
  nav: PerfNav
  resources: PerfResources
  longTasks: PerfTasks
  loaf?: PerfTasks & { script?: string }
}

export interface JsErrorP {
  msg: string
  src: string
  line?: number
  stack: string
}

export interface ResourceErrorP {
  tag: string
  src: string
  sel: string
}

export interface ConsoleErrorP {
  msg: string
}

/** The one-shot environment probe (contract B.5); latest non-null wins on merge. */
export interface EnvP {
  webdriver: boolean
  /** Low-entropy UA-CH: brands as "Chromium/126;Google Chrome/126" (≤ 200). */
  uad: { brands: string; mobile: boolean; platform: string } | null
  /** `getHighEntropyValues`: fullVersionList ≤ 300, formFactors ≤ 60. */
  uadHi: {
    architecture: string
    bitness: string
    model: string
    platformVersion: string
    fullVersionList: string
    formFactors: string
    wow64: boolean
  } | null
  /** "en-US,en,de" ≤ 120. */
  languages: string
  maxTouchPoints: number
  pdfViewer: boolean
  cookies: boolean
  gpc: boolean
  dnt: boolean
  /** WEBGL_debug_renderer_info on a 1×1 offscreen canvas, released via WEBGL_lose_context. */
  gpu: { vendor: string; renderer: string } | null
  /** adapter.info ?? requestAdapterInfo(), 1 s timeout, skipped under saveData. */
  webgpu: { vendor: string; architecture: string; device: string; description: string } | null
  /** level 0..100. */
  battery: { level: number; charging: boolean } | null
  storage: { quotaMb: number; usageMb: number } | null
  /** enumerateDevices counts only; labels never read. */
  media: { audioinput: number; videoinput: number; audiooutput: number } | null
  prefers: {
    scheme: 'dark' | 'light' | 'none'
    reducedMotion: boolean
    contrast: 'more' | 'less' | 'custom' | 'none'
    forcedColors: boolean
    invertedColors: boolean
    reducedTransparency: boolean
  }
  screen: { availW: number; availH: number; colorDepth: number; orientation: string }
  /** performance.memory (Chrome only). */
  memory: { limitMb: number; usedMb: number } | null
  net: { type: string; effectiveType: string; downlink: number; rtt: number; saveData: boolean } | null
  /** speechSynthesis voices; null when the list is still empty at probe time. */
  voices: number | null
  tz: { name: string; offsetMin: number }
  locale: string
  display: 'standalone' | 'browser' | 'minimal-ui' | 'fullscreen'
  outer: { w: number; h: number }
  inner: { w: number; h: number }
  deviceMemory: number | null
  cores: number | null
  platform: string
  touch: boolean
}

export interface ReplayStoppedP {
  reason: string
}

/** A replay chunk upload failed after its bounded retry (plan delta A14). */
export interface ReplayChunkLostP {
  seq: number
  rid: string
  /** HTTP status of the last attempt; null when the request never completed. */
  status: number | null
}

// ---------------------------------------------------------------------------
// Discriminated union. Payload-less types carry `p?: undefined` so `ev.p` is
// addressable on the whole union without narrowing.
// ---------------------------------------------------------------------------

export type WireEvent = WireEventBase &
  (
    | { type: 'pageview'; p: PageviewP }
    | { type: 'page_leave'; p: PageLeaveP }
    | { type: 'heartbeat'; p: HeartbeatP }
    | { type: 'visibility'; p: VisibilityP }
    | { type: 'section_enter'; p?: undefined }
    | { type: 'section_exit'; p: SectionExitP }
    | { type: 'scroll_depth'; p: ScrollDepthP }
    | { type: 'click'; p: ClickP }
    | { type: 'rage_click'; p: RageClickP }
    | { type: 'dead_click'; p: DeadClickP }
    | { type: 'outbound'; p: OutboundP }
    | { type: 'print'; p: PrintP }
    | { type: 'copy'; p: CopyP }
    | { type: 'select'; p: SelectP }
    | { type: 'form'; p: FormP }
    | { type: 'find'; p?: undefined }
    | { type: 'site_search'; p: SiteSearchP }
    | { type: 'exit_intent'; p: ExitIntentP }
    | { type: 'viewport'; p: ViewportP }
    | { type: 'first_interaction'; p: FirstInteractionP }
    | { type: 'hover'; p: HoverP }
    | { type: 'subtab'; p: SubtabP }
    | { type: 'env'; p: EnvP }
    | { type: 'vitals'; p: VitalsP }
    | { type: 'perf'; p: PerfP }
    | { type: 'js_error'; p: JsErrorP }
    | { type: 'resource_error'; p: ResourceErrorP }
    | { type: 'console_error'; p: ConsoleErrorP }
    | { type: 'easter_egg'; p?: undefined }
    | { type: 'replay_stopped'; p: ReplayStoppedP }
    | { type: 'replay_chunk_lost'; p: ReplayChunkLostP }
  )

/** Payload type for one event type (`WirePayload<'click'>` = `ClickP`). */
export type WirePayload<T extends EventType> = Extract<WireEvent, { type: T }>['p']

// ---------------------------------------------------------------------------
// Caps and constants
// ---------------------------------------------------------------------------

export const SCROLL_MILESTONES = [25, 50, 75, 90, 100] as const

/**
 * Intent flags derived from the session counters.
 * 'email' = email_copies > 0 OR mailto_clicks > 0; 'submit' = form_submitted > 0 OR mailto_clicks > 0.
 */
export const INTENT_FLAGS = [
  'print',
  'copy',
  'email',
  'form',
  'submit',
  'find',
  'search',
  'exit',
  'rage',
  'dead',
  'error',
  'outbound',
  'egg',
] as const

export type IntentFlag = (typeof INTENT_FLAGS)[number]

/**
 * Per-session hard cap on stored `events` rows. The client counts emitted
 * events in `sessionStorage.rb_ev_n` as a courtesy; the server enforces it
 * via `sessions.events_n` (the budget). Beyond it only ESSENTIAL_TYPES pass.
 */
export const SESSION_EVENT_CAP = 400

export const ESSENTIAL_TYPES = [
  'pageview',
  'page_leave',
  'vitals',
  'perf',
  'js_error',
  'form',
  'outbound',
  'heartbeat',
] as const

/**
 * Max events per page visit, per type (client-side; the server re-clamps).
 * Absent = uncapped (pageview, page_leave, heartbeat, section_*, env, vitals,
 * perf, easter_egg, replay_stopped are bounded by their emission rules).
 */
export const PAGE_CAPS: Readonly<Partial<Record<EventType, number>>> = {
  scroll_depth: 5,
  click: 100,
  rage_click: 10,
  dead_click: 20,
  outbound: 50,
  print: 5,
  copy: 20,
  select: 20,
  form: 30,
  find: 5,
  site_search: 20,
  exit_intent: 3,
  visibility: 20,
  viewport: 10,
  hover: 30,
  subtab: 30,
  js_error: 10,
  resource_error: 10,
  console_error: 5,
  replay_chunk_lost: 10,
}

/**
 * `replay_chunks_v2.rid` for rows migrated from the (sid, seq)-keyed
 * `replay_chunks` table. Their R2 objects keep the old `replays/<sid>/<seq>`
 * key layout; new recordings use `replays/<sid>/<rid>/<seq>`.
 */
export const LEGACY_RID = 'legacy'
