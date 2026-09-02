// server/utils/opsFilters.ts — the shared query surface of the /ops read API
// (contract D.1 + plan deltas A24 / A46): OpsQuery parsing and clamping, the
// window (owner tz), the join-free `buildWhere(q, alias)` fragment with
// 40-byte LIKE clamps (D1 rejects patterns > 50 bytes), whitelisted sorts,
// the ACTIVE subquery, the bounce / engaged definitions, the session
// projection and the stats aggregate every view shares. PURE: no Nitro
// auto-imports — tests import it by relative path.

import type { IntentFlag } from '../../shared/analytics/events.ts'
import { INTENT_FLAGS } from '../../shared/analytics/events.ts'
import type { IntentTiles, OpsQuery, OpsRange, OpsWindow, Stats } from '../../shared/analytics/ops.ts'
import { TZ_DAY_MS as DAY_MS, isValidTz } from './opsTz.ts'

const RANGE_MS: Record<string, number> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  '90d': 90 * DAY_MS,
}
const MAX_CUSTOM_MS = 400 * DAY_MS
/** LIKE operands are clamped to this many UTF-8 bytes before the `%…%` wrap (D1: ≤ 50 bytes). */
export const LIKE_CLAMP_BYTES = 40

const RANGES: readonly OpsRange[] = ['24h', '7d', '30d', '90d', 'all', 'custom']
const DIMS = ['device', 'browser', 'os', 'country', 'path', 'protocol'] as const
const ENTITIES = ['sessions', 'visitors', 'page_visits', 'page_perf', 'events'] as const
const FORMATS = ['csv', 'ndjson'] as const
const PATH_RE = /^\/[^\s?#]{0,199}$/
const ID_RE = /^[0-9a-fA-F-]{16,64}$/

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function strParam(v: unknown, max = 200): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (s.length === 0) return undefined
  return s.length > max ? s.slice(0, max) : s
}

export function intParam(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(v ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

function flag(v: unknown): '1' | undefined {
  return v === '1' || v === 'true' ? '1' : undefined
}

function bit(v: unknown): '1' | '0' | undefined {
  return v === '1' ? '1' : v === '0' ? '0' : undefined
}

/** Clamp + validate a raw query object into an OpsQuery (unknown keys dropped). */
export function parseOpsQuery(raw: Record<string, unknown>): OpsQuery {
  const q: OpsQuery = {}
  const range = oneOf(raw.range, RANGES)
  if (range) q.range = range
  const from = strParam(raw.from, 20)
  if (from) q.from = from
  const to = strParam(raw.to, 20)
  if (to) q.to = to
  const tz = strParam(raw.tz, 64)
  if (tz && isValidTz(tz)) q.tz = tz
  if (flag(raw.bots)) q.bots = '1'
  const org = strParam(raw.org, 200)
  if (org) q.org = org
  const asn = strParam(raw.asn, 12)
  if (asn && /^\d{1,10}$/.test(asn)) q.asn = asn
  const path = strParam(raw.path, 200)
  if (path && PATH_RE.test(path)) q.path = path
  const entry = strParam(raw.entry, 200)
  if (entry && PATH_RE.test(entry)) q.entry = entry
  const country = strParam(raw.country, 80)
  if (country) q.country = country
  const device = strParam(raw.device, 40)
  if (device) q.device = device
  const browser = strParam(raw.browser, 60)
  if (browser) q.browser = browser
  const os = strParam(raw.os, 60)
  if (os) q.os = os
  const returning = bit(raw.returning)
  if (returning) q.returning = returning
  if (flag(raw.replay)) q.replay = '1'
  const webdriver = bit(raw.webdriver)
  if (webdriver) q.webdriver = webdriver
  const intent = strParam(raw.intent, 200)
  if (intent) q.intent = intent
  const qq = strParam(raw.q, 120)
  if (qq) q.q = qq
  if (flag(raw.compare)) q.compare = '1'
  if (flag(raw.hideIsp)) q.hideIsp = '1'
  const sort = strParam(raw.sort, 40)
  if (sort) q.sort = sort
  const dir = oneOf(raw.dir, ['asc', 'desc'] as const)
  if (dir) q.dir = dir
  const limit = strParam(raw.limit, 10)
  if (limit) q.limit = limit
  const offset = strParam(raw.offset, 10)
  if (offset) q.offset = offset
  const after = strParam(raw.after, 120)
  if (after) q.after = after
  const before = strParam(raw.before, 20)
  if (before) q.before = before
  const beforeSid = strParam(raw.beforeSid, 64)
  if (beforeSid && ID_RE.test(beforeSid)) q.beforeSid = beforeSid
  if (raw.fields === 'full') q.fields = 'full'
  const types = strParam(raw.types, 400)
  if (types) q.types = types
  const dim = oneOf(raw.dim, DIMS)
  if (dim) q.dim = dim
  const depth = strParam(raw.depth, 2)
  if (depth) q.depth = depth
  const entity = oneOf(raw.entity, ENTITIES)
  if (entity) q.entity = entity
  const format = oneOf(raw.format, FORMATS)
  if (format) q.format = format
  return q
}

/** The [start, end) window, its previous period and the owner tz. `all` has an empty previous period. */
export function parseWindow(q: OpsQuery, now = Date.now()): OpsWindow {
  const tz = q.tz && isValidTz(q.tz) ? q.tz : 'UTC'
  let range: OpsRange = q.range ?? '7d'
  let start: number
  let end: number
  if (range === 'custom') {
    const from = Number(q.from)
    const to = Number(q.to)
    if (Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to > from) {
      end = Math.min(to, now + 366 * DAY_MS)
      start = Math.max(from, end - MAX_CUSTOM_MS)
    } else {
      range = '7d'
      end = now
      start = now - (RANGE_MS['7d'] as number)
    }
  } else if (range === 'all') {
    return { start: 0, end: now, prevStart: 0, prevEnd: 0, tz, range }
  } else {
    const span = RANGE_MS[range] ?? (RANGE_MS['7d'] as number)
    end = now
    start = now - span
  }
  const span = end - start
  return { start, end, prevStart: Math.max(0, start - span), prevEnd: start, tz, range }
}

/** The same window shifted to the previous period (for `compare=1`). */
export function prevWindow(w: OpsWindow): OpsWindow {
  return { ...w, start: w.prevStart, end: w.prevEnd, prevStart: 0, prevEnd: 0 }
}

// ---------------------------------------------------------------------------
// LIKE helpers
// ---------------------------------------------------------------------------

function utf8Len(cp: number): number {
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
}

/** Cut `s` on a code-point boundary so it fits in `maxBytes` of UTF-8. */
export function clampBytes(s: string, maxBytes: number): string {
  let bytes = 0
  let out = ''
  for (const ch of s) {
    const len = utf8Len(ch.codePointAt(0) ?? 0)
    if (bytes + len > maxBytes) break
    bytes += len
    out += ch
  }
  return out
}

/** `%…%` pattern: `\ % _` escaped (ESCAPE '\'), operand clamped to LIKE_CLAMP_BYTES. */
export function likePattern(s: string): string {
  let escaped = clampBytes(s.replace(/[\\%_]/g, (m) => `\\${m}`), LIKE_CLAMP_BYTES)
  if (escaped.endsWith('\\') && !escaped.endsWith('\\\\')) escaped = escaped.slice(0, -1)
  return `%${escaped}%`
}

// ---------------------------------------------------------------------------
// Intent flags
// ---------------------------------------------------------------------------

export const INTENT_SQL: Record<IntentFlag, (a: string) => string> = {
  print: (a) => `${a}.prints > 0`,
  copy: (a) => `${a}.copies > 0`,
  email: (a) => `(${a}.email_copies > 0 OR ${a}.mailto_clicks > 0)`,
  form: (a) => `${a}.form_started > 0`,
  submit: (a) => `(${a}.form_submitted > 0 OR ${a}.mailto_clicks > 0)`,
  find: (a) => `${a}.finds > 0`,
  search: (a) => `${a}.searches > 0`,
  exit: (a) => `${a}.exit_intents > 0`,
  rage: (a) => `${a}.rage_clicks > 0`,
  dead: (a) => `${a}.dead_clicks > 0`,
  error: (a) => `${a}.errors > 0`,
  outbound: (a) => `${a}.outbounds > 0`,
  egg: (a) => `${a}.eggs > 0`,
}

/** `(any intent counter > 0)` for `alias`. */
export function anyIntentSql(a = 's'): string {
  return `(${INTENT_FLAGS.map((f) => INTENT_SQL[f](a)).join(' OR ')})`
}

export interface IntentCounters {
  prints?: unknown
  copies?: unknown
  email_copies?: unknown
  mailto_clicks?: unknown
  form_started?: unknown
  form_submitted?: unknown
  finds?: unknown
  searches?: unknown
  exit_intents?: unknown
  rage_clicks?: unknown
  dead_clicks?: unknown
  errors?: unknown
  outbounds?: unknown
  eggs?: unknown
}

function gt0(v: unknown): boolean {
  return typeof v === 'number' ? v > 0 : Number(v) > 0
}

/** Intent flags of a session row (contract: email/submit fold mailto clicks in). */
export function intentFlagsOf(r: IntentCounters): IntentFlag[] {
  const out: IntentFlag[] = []
  if (gt0(r.prints)) out.push('print')
  if (gt0(r.copies)) out.push('copy')
  if (gt0(r.email_copies) || gt0(r.mailto_clicks)) out.push('email')
  if (gt0(r.form_started)) out.push('form')
  if (gt0(r.form_submitted) || gt0(r.mailto_clicks)) out.push('submit')
  if (gt0(r.finds)) out.push('find')
  if (gt0(r.searches)) out.push('search')
  if (gt0(r.exit_intents)) out.push('exit')
  if (gt0(r.rage_clicks)) out.push('rage')
  if (gt0(r.dead_clicks)) out.push('dead')
  if (gt0(r.errors)) out.push('error')
  if (gt0(r.outbounds)) out.push('outbound')
  if (gt0(r.eggs)) out.push('egg')
  return out
}

// ---------------------------------------------------------------------------
// WHERE
// ---------------------------------------------------------------------------

export interface WhereParts {
  /** Never empty — `1 = 1` when nothing applies. */
  sql: string
  args: unknown[]
}

export interface WhereOptions {
  /** Add the `started_at` window bounds (default true). */
  window?: boolean
  /** Honour `q.returning` (default true; the visitors list maps it to visit_count instead). */
  returning?: boolean
  /** Honour `q.bots` (default true). */
  bots?: boolean
}

/**
 * Join-free predicate over `sessions <alias>`: window, bots, org, asn, path
 * (page_visits EXISTS), entry, country (code = ? OR region / city LIKE),
 * device / browser / os, returning, replay, webdriver, intent (OR-ed) and the
 * free-text `q` (as_org / city / referrer / entry_path / rdns_host LIKE).
 */
export function buildWhere(q: OpsQuery, w: OpsWindow, alias = 's', opts: WhereOptions = {}): WhereParts {
  const a = alias
  const cond: string[] = []
  const args: unknown[] = []
  if (opts.window !== false) {
    cond.push(`${a}.started_at >= ? AND ${a}.started_at < ?`)
    args.push(w.start, w.end)
  }
  if (opts.bots !== false && q.bots !== '1') cond.push(`${a}.is_bot = 0`)
  if (q.org) {
    if (q.org === '(unknown)') cond.push(`(${a}.as_org IS NULL OR ${a}.as_org = '')`)
    else {
      cond.push(`${a}.as_org = ?`)
      args.push(q.org)
    }
  }
  if (q.asn) {
    cond.push(`${a}.asn = ?`)
    args.push(Number(q.asn))
  }
  if (q.path) {
    cond.push(`EXISTS (SELECT 1 FROM page_visits pv_f WHERE pv_f.sid = ${a}.sid AND pv_f.path = ?)`)
    args.push(q.path)
  }
  if (q.entry) {
    cond.push(`${a}.entry_path = ?`)
    args.push(q.entry)
  }
  if (q.country) {
    const pat = likePattern(q.country)
    cond.push(`(UPPER(${a}.country) = ? OR ${a}.region LIKE ? ESCAPE '\\' OR ${a}.city LIKE ? ESCAPE '\\')`)
    args.push(q.country.toUpperCase(), pat, pat)
  }
  if (q.device) {
    cond.push(`${a}.device_type = ?`)
    args.push(q.device)
  }
  if (q.browser) {
    cond.push(`${a}.browser = ?`)
    args.push(q.browser)
  }
  if (q.os) {
    cond.push(`${a}.os = ?`)
    args.push(q.os)
  }
  if (opts.returning !== false && q.returning) cond.push(`${a}.is_returning = ${q.returning === '1' ? 1 : 0}`)
  if (q.replay === '1') cond.push(`${a}.has_replay = 1`)
  if (q.webdriver) cond.push(`${a}.is_webdriver = ${q.webdriver === '1' ? 1 : 0}`)
  if (q.intent) {
    const flags = q.intent
      .split(',')
      .map((f) => f.trim())
      .filter((f): f is IntentFlag => (INTENT_FLAGS as readonly string[]).includes(f))
    if (flags.length > 0) cond.push(`(${flags.map((f) => INTENT_SQL[f](a)).join(' OR ')})`)
  }
  if (q.q) {
    const pat = likePattern(q.q)
    cond.push(
      `(${a}.as_org LIKE ? ESCAPE '\\' OR ${a}.city LIKE ? ESCAPE '\\' OR ${a}.referrer LIKE ? ESCAPE '\\' OR ${a}.entry_path LIKE ? ESCAPE '\\'`
        + ` OR EXISTS (SELECT 1 FROM session_net n_f WHERE n_f.sid = ${a}.sid AND n_f.rdns_host LIKE ? ESCAPE '\\'))`,
    )
    args.push(pat, pat, pat, pat, pat)
  }
  return { sql: cond.length > 0 ? cond.join(' AND ') : '1 = 1', args }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export interface SortSpec {
  key: string
  /** SQL expression / alias. */
  col: string
  dir: 'ASC' | 'DESC'
}

/** Whitelisted sort: `allowed` maps query keys to SQL; unknown keys fall back to `def`. */
export function sortSpec(q: OpsQuery, allowed: Record<string, string>, def: string, defDir: 'asc' | 'desc' = 'desc'): SortSpec {
  const key = q.sort && Object.hasOwn(allowed, q.sort) ? q.sort : def
  const dir = (q.dir ?? defDir) === 'asc' ? 'ASC' : 'DESC'
  return { key, col: allowed[key] as string, dir }
}

// ---------------------------------------------------------------------------
// SQL fragments
// ---------------------------------------------------------------------------

/** Σ page_visits.active_ms for the session (one index lookup per row via idx_page_visits_sid). */
export function activeSql(a = 's'): string {
  return `(SELECT COALESCE(SUM(pv_a.active_ms), 0) FROM page_visits pv_a WHERE pv_a.sid = ${a}.sid)`
}

/** bounce = pageviews <= 1 AND ACTIVE < 15000 (expects an `active_ms` column in scope). */
export const BOUNCE_SQL = '(pageviews <= 1 AND active_ms < 15000)'
/** engaged = pageviews >= 2 OR ACTIVE >= 60000 OR form_submitted > 0 OR mailto_clicks > 0. */
export const ENGAGED_SQL = '(pageviews >= 2 OR active_ms >= 60000 OR form_submitted > 0 OR mailto_clicks > 0)'

export const SESSION_COLUMNS: readonly string[] = [
  'sid',
  'vid',
  'started_at',
  'last_seen_at',
  'duration_ms',
  'browser',
  'browser_ver',
  'os',
  'device_type',
  'country',
  'region',
  'city',
  'referrer',
  'entry_path',
  'exit_path',
  'last_path',
  'pageviews',
  'max_scroll_pct',
  'is_bot',
  'has_replay',
  'is_returning',
  'visit_n',
  'nav_kind',
  'asn',
  'as_org',
  'is_webdriver',
  'is_tor',
  'gpc',
  'prints',
  'copies',
  'email_copies',
  'form_started',
  'form_submitted',
  'finds',
  'searches',
  'exit_intents',
  'rage_clicks',
  'dead_clicks',
  'errors',
  'outbounds',
  'mailto_clicks',
  'eggs',
  'events_n',
]

/** The explicit SessionRow projection (+ ip / ua with `full`) and the ACTIVE subquery. */
export function sessionProjection(a = 's', full = false): string {
  const cols = SESSION_COLUMNS.map((c) => `${a}.${c}`)
  if (full) cols.push(`${a}.ip`, `${a}.ua`)
  cols.push(`${activeSql(a)} AS active_ms`)
  return cols.join(', ')
}

/** Referrer host, extracted in SQL (B11 / A49): scheme stripped, cut at the first `/`, '(direct)' when empty. */
export function referrerHostSql(col: string): string {
  const raw = `COALESCE(NULLIF(${col}, ''), '(direct)')`
  const x = `CASE WHEN instr(${raw}, '://') > 0 THEN substr(${raw}, instr(${raw}, '://') + 3) ELSE ${raw} END`
  return `lower(CASE WHEN instr(${x}, '/') > 0 THEN substr(${x}, 1, instr(${x}, '/') - 1) ELSE ${x} END)`
}

/** First tag of an Accept-Language header, lowercased, `;q=` stripped ('??' when absent). */
export function acceptLanguageFirstSql(col: string): string {
  const al = `COALESCE(NULLIF(${col}, ''), '??')`
  const first = `trim(CASE WHEN instr(${al}, ',') > 0 THEN substr(${al}, 1, instr(${al}, ',') - 1) ELSE ${al} END)`
  return `lower(CASE WHEN instr(${first}, ';') > 0 THEN substr(${first}, 1, instr(${first}, ';') - 1) ELSE ${first} END)`
}

/**
 * One aggregate over `sessions` with the ACTIVE subquery: Stats + IntentTiles +
 * the error total. Bind: [...where.args, todayStartMs].
 */
export function statsSql(where: WhereParts, a = 's'): string {
  return (
    `WITH b AS (SELECT ${a}.vid, ${a}.is_returning, ${a}.pageviews, ${a}.form_submitted, ${a}.mailto_clicks, ${a}.email_copies, `
    + `${a}.started_at, ${a}.prints, ${a}.copies, ${a}.selects, ${a}.finds, ${a}.searches, ${a}.exit_intents, ${a}.rage_clicks, `
    + `${a}.dead_clicks, ${a}.form_started, ${a}.errors, ${activeSql(a)} AS active_ms FROM sessions ${a} WHERE ${where.sql}) `
    + 'SELECT COUNT(*) AS sessions, COUNT(DISTINCT vid) AS visitors, COALESCE(SUM(is_returning), 0) AS returningN, '
    + 'COALESCE(SUM(pageviews), 0) AS pageviews, COALESCE(SUM(active_ms), 0) AS activeMs, '
    + `COALESCE(SUM(${BOUNCE_SQL}), 0) AS bounced, COALESCE(SUM(${ENGAGED_SQL}), 0) AS engaged, `
    + 'COALESCE(SUM(form_submitted), 0) AS mailHandoffs, COALESCE(SUM(mailto_clicks), 0) AS mailtoClicks, '
    + 'COALESCE(SUM(email_copies), 0) AS emailCopies, COALESCE(SUM(started_at >= ?), 0) AS visitsToday, '
    + 'COALESCE(SUM(prints), 0) AS prints, COALESCE(SUM(copies), 0) AS copies, COALESCE(SUM(selects), 0) AS selects, '
    + 'COALESCE(SUM(finds), 0) AS finds, COALESCE(SUM(searches), 0) AS searches, COALESCE(SUM(exit_intents), 0) AS exitIntents, '
    + 'COALESCE(SUM(rage_clicks), 0) AS rageClicks, COALESCE(SUM(dead_clicks), 0) AS deadClicks, '
    + 'COALESCE(SUM(form_started), 0) AS formStarted, COALESCE(SUM(errors), 0) AS errors FROM b'
  )
}

function n0(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Row of `statsSql` → Stats, IntentTiles and the error total. */
export function foldStats(row: Record<string, unknown> | null | undefined): { stats: Stats; intent: IntentTiles; errors: number } {
  const r = row ?? {}
  const sessions = n0(r.sessions)
  const div = (x: number): number => (sessions > 0 ? Math.round((x / sessions) * 1000) / 10 : 0)
  return {
    stats: {
      sessions,
      visitors: n0(r.visitors),
      returningPct: div(n0(r.returningN)),
      pageviews: n0(r.pageviews),
      avgActiveMs: sessions > 0 ? Math.round(n0(r.activeMs) / sessions) : 0,
      bounceRate: div(n0(r.bounced)),
      engagedRate: div(n0(r.engaged)),
      mailHandoffs: n0(r.mailHandoffs),
      mailtoClicks: n0(r.mailtoClicks),
      emailCopies: n0(r.emailCopies),
      visitsToday: n0(r.visitsToday),
    },
    intent: {
      prints: n0(r.prints),
      copies: n0(r.copies),
      emailCopies: n0(r.emailCopies),
      selects: n0(r.selects),
      finds: n0(r.finds),
      searches: n0(r.searches),
      exitIntents: n0(r.exitIntents),
      rageClicks: n0(r.rageClicks),
      deadClicks: n0(r.deadClicks),
      formStarted: n0(r.formStarted),
      mailHandoffs: n0(r.mailHandoffs),
      mailtoClicks: n0(r.mailtoClicks),
    },
    errors: n0(r.errors),
  }
}

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

/** `<number>:<id>` export cursor → parts, or null when malformed. */
export function splitCursor(after: string | undefined): { n: number; id: string } | null {
  if (!after) return null
  const i = after.indexOf(':')
  if (i <= 0) {
    const n = Number(after)
    return Number.isFinite(n) ? { n, id: '' } : null
  }
  const n = Number(after.slice(0, i))
  const id = after.slice(i + 1)
  if (!Number.isFinite(n) || id.length === 0 || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) return null
  return { n, id }
}
