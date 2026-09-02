import { effectScope } from 'vue'
import type { EffectScope } from 'vue'
import type { LocationQuery, LocationQueryRaw } from 'vue-router'
import { INTENT_FLAGS } from '#shared/analytics/events'
import type { IntentFlag } from '#shared/analytics/events'
import type { OpsQuery, OpsRange } from '#shared/analytics/ops'
import { ownerTz } from './useOpsFormat'

/**
 * The one filter state every /ops view shares (contract E.3).
 *
 * - Synced both ways with `route.query` via `router.replace`, so every view is
 *   a shareable URL. THE URL WINS whenever any filter key is present;
 *   `localStorage.rbops_filters` (range / from / to / compare / bots) only
 *   seeds an EMPTY query.
 * - `query` is what pages hand to `useOpsFetch` — the filters plus the
 *   owner's `tz`, so day/hour buckets land in the right zone (audit A4).
 * - `linkTo(page, extra)` builds drill-down links that carry the filters.
 */

export const OPS_RANGES = ['24h', '7d', '30d', 'all', 'custom'] as const
const ALL_RANGES: readonly OpsRange[] = ['24h', '7d', '30d', '90d', 'all', 'custom']
export const DEFAULT_RANGE: OpsRange = '7d'

export interface OpsFilterState {
  range: OpsRange
  /** Epoch ms as a string, `range = custom` only. */
  from: string
  to: string
  compare: boolean
  bots: boolean
  org: string
  path: string
  country: string
  device: string
  browser: string
  os: string
  returning: '' | '1' | '0'
  replay: boolean
  webdriver: '' | '1' | '0'
  intent: IntentFlag[]
  hideIsp: boolean
  sort: string
  dir: '' | 'asc' | 'desc'
  q: string
}

const FILTER_KEYS = [
  'range',
  'from',
  'to',
  'compare',
  'bots',
  'org',
  'path',
  'country',
  'device',
  'browser',
  'os',
  'returning',
  'replay',
  'webdriver',
  'intent',
  'hideIsp',
  'sort',
  'dir',
  'q',
] as const

type FilterKey = (typeof FILTER_KEYS)[number]
const SEED_KEYS: FilterKey[] = ['range', 'from', 'to', 'compare', 'bots']
const STORAGE_KEY = 'rbops_filters'

export function defaultFilters(): OpsFilterState {
  return {
    range: DEFAULT_RANGE,
    from: '',
    to: '',
    compare: false,
    bots: false,
    org: '',
    path: '',
    country: '',
    device: '',
    browser: '',
    os: '',
    returning: '',
    replay: false,
    webdriver: '',
    intent: [],
    hideIsp: false,
    sort: '',
    dir: '',
    q: '',
  }
}

function first(v: unknown): string {
  if (Array.isArray(v)) return first(v[0])
  return typeof v === 'string' ? v : ''
}

function isRange(v: string): v is OpsRange {
  return (ALL_RANGES as readonly string[]).includes(v)
}

function isFlag(v: string): v is IntentFlag {
  return (INTENT_FLAGS as readonly string[]).includes(v)
}

/** Parse a query (or seed object) into a partial state — unknown values dropped. */
export function parseFilters(q: Record<string, unknown>): Partial<OpsFilterState> {
  const out: Partial<OpsFilterState> = {}
  const range = first(q.range)
  if (isRange(range)) out.range = range
  const from = first(q.from)
  if (/^\d{1,16}$/.test(from)) out.from = from
  const to = first(q.to)
  if (/^\d{1,16}$/.test(to)) out.to = to
  if (first(q.compare) === '1' || q.compare === true) out.compare = true
  if (first(q.bots) === '1' || q.bots === true) out.bots = true
  for (const k of ['org', 'path', 'country', 'device', 'browser', 'os', 'sort', 'q'] as const) {
    const v = first(q[k])
    if (v) out[k] = v.slice(0, 200)
  }
  const returning = first(q.returning)
  if (returning === '1' || returning === '0') out.returning = returning
  if (first(q.replay) === '1' || q.replay === true) out.replay = true
  const webdriver = first(q.webdriver)
  if (webdriver === '1' || webdriver === '0') out.webdriver = webdriver
  const intent = first(q.intent)
  if (intent) out.intent = intent.split(',').map(s => s.trim()).filter(isFlag)
  else if (Array.isArray(q.intent)) out.intent = (q.intent as unknown[]).map(String).filter(isFlag)
  if (first(q.hideIsp) === '1' || q.hideIsp === true) out.hideIsp = true
  const dir = first(q.dir)
  if (dir === 'asc' || dir === 'desc') out.dir = dir
  return out
}

/** Serialise the non-default filters (what goes into the URL / a link). */
export function serializeFilters(s: OpsFilterState): Record<string, string> {
  const out: Record<string, string> = {}
  if (s.range !== DEFAULT_RANGE) out.range = s.range
  if (s.range === 'custom') {
    if (s.from) out.from = s.from
    if (s.to) out.to = s.to
  }
  if (s.compare) out.compare = '1'
  if (s.bots) out.bots = '1'
  for (const k of ['org', 'path', 'country', 'device', 'browser', 'os'] as const) if (s[k]) out[k] = s[k]
  if (s.returning) out.returning = s.returning
  if (s.replay) out.replay = '1'
  if (s.webdriver) out.webdriver = s.webdriver
  if (s.intent.length) out.intent = s.intent.join(',')
  if (s.hideIsp) out.hideIsp = '1'
  if (s.sort) out.sort = s.sort
  if (s.dir) out.dir = s.dir
  if (s.q) out.q = s.q
  return out
}

function hasFilterKeys(q: LocationQuery): boolean {
  return FILTER_KEYS.some(k => q[k] !== undefined)
}

function filterPart(q: LocationQuery): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of FILTER_KEYS) {
    const v = first(q[k])
    if (v) out[k] = v
  }
  return out
}

function restPart(q: LocationQuery): LocationQueryRaw {
  const out: LocationQueryRaw = {}
  for (const [k, v] of Object.entries(q)) {
    if ((FILTER_KEYS as readonly string[]).includes(k) || k === 'tz') continue
    out[k] = v
  }
  return out
}

function sameQuery(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  if (ka.length !== kb.length) return false
  return ka.every((k, i) => k === kb[i] && a[k] === b[k])
}

function loadSeed(): Partial<OpsFilterState> {
  if (!import.meta.client) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const p = parseFilters(parsed as Record<string, unknown>)
    const seed: Partial<OpsFilterState> = {}
    for (const k of SEED_KEYS) if (p[k] !== undefined) (seed as Record<string, unknown>)[k] = p[k]
    return seed
  } catch {
    return {}
  }
}

function saveSeed(s: OpsFilterState): void {
  if (!import.meta.client) return
  try {
    const ser = serializeFilters(s)
    const seed: Record<string, string> = {}
    for (const k of SEED_KEYS) if (ser[k]) seed[k] = ser[k]
    if (Object.keys(seed).length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage may be unavailable — the URL still carries the filters
  }
}

function buildQs(q: Record<string, string>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== '') p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** One detached sync scope for the whole console (client only). */
let syncScope: EffectScope | null = null

export function useOpsFilters() {
  const state = useState<OpsFilterState>('rbops-filters', defaultFilters)
  const route = useRoute()
  const router = useRouter()
  const tz = ownerTz()

  function applyFromRoute(): void {
    const q = route.query
    const next = defaultFilters()
    if (hasFilterKeys(q)) Object.assign(next, parseFilters(q as Record<string, unknown>))
    else Object.assign(next, loadSeed())
    if (next.range === 'custom' && !next.from && !next.to) next.range = DEFAULT_RANGE
    if (!sameQuery(serializeFilters(state.value), serializeFilters(next))) state.value = next
  }

  if (import.meta.client && !syncScope) {
    syncScope = effectScope(true)
    syncScope.run(() => {
      // URL → state (initial load, back/forward, drill-down links, nav strip).
      watch(
        () => route.fullPath,
        () => {
          if (!route.path.startsWith('/ops')) return
          if (sameQuery(filterPart(route.query), serializeFilters(state.value))) return
          applyFromRoute()
        },
        { immediate: true },
      )
      // state → URL (+ seed) whenever a filter changes.
      watch(
        () => serializeFilters(state.value),
        ser => {
          saveSeed(state.value)
          if (!route.path.startsWith('/ops') || route.path === '/ops/login') return
          if (sameQuery(filterPart(route.query), ser)) return
          router.replace({ path: route.path, query: { ...restPart(route.query), ...ser } }).catch(() => {})
        },
        { deep: true },
      )
    })
  }

  /** Filters + `tz` — what the API endpoints take. `range` is always explicit. */
  const query = computed<OpsQuery & Record<string, string>>(() => ({
    range: state.value.range,
    ...serializeFilters(state.value),
    tz,
  }))

  /** The window-only subset (`/api/ops/filters`, `/api/ops/live`). */
  const windowQuery = computed<Record<string, string>>(() => {
    const s = state.value
    return {
      range: s.range,
      ...(s.range === 'custom' && s.from ? { from: s.from } : {}),
      ...(s.range === 'custom' && s.to ? { to: s.to } : {}),
      ...(s.bots ? { bots: '1' } : {}),
      tz,
    }
  })

  /** Number of active non-default filters (range counts when ≠ default). */
  const activeCount = computed(() => {
    const ser = serializeFilters(state.value)
    return Object.keys(ser).filter(k => !['from', 'to', 'sort', 'dir'].includes(k)).length
  })

  function set(patch: Partial<OpsFilterState>): void {
    state.value = { ...state.value, ...patch }
  }

  function setRange(range: OpsRange, from?: string | number, to?: string | number): void {
    set({
      range,
      from: range === 'custom' && from !== undefined ? String(from) : range === 'custom' ? state.value.from : '',
      to: range === 'custom' && to !== undefined ? String(to) : range === 'custom' ? state.value.to : '',
    })
  }

  function toggleIntent(flag: IntentFlag): void {
    const cur = state.value.intent
    set({ intent: cur.includes(flag) ? cur.filter(f => f !== flag) : [...cur, flag] })
  }

  function reset(): void {
    state.value = defaultFilters()
  }

  /**
   * `/ops/sessions?org=Acme&range=30d` — the current filters plus `extra`
   * (a null / '' value in `extra` removes that key).
   */
  function linkTo(page: string, extra: Partial<Record<string, string | number | null | undefined>> = {}): string {
    const q: Record<string, string> = { ...serializeFilters(state.value) }
    for (const [k, v] of Object.entries(extra)) {
      if (v === null || v === undefined || v === '') delete q[k]
      else q[k] = String(v)
    }
    return `${page}${buildQs(q)}`
  }

  return {
    state,
    query,
    windowQuery,
    activeCount,
    tz,
    set,
    setRange,
    toggleIntent,
    reset,
    linkTo,
    ranges: OPS_RANGES,
  }
}
