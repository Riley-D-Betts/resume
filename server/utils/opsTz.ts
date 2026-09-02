// server/utils/opsTz.ts — owner-timezone bucketing for the /ops read API
// (contract B10 / D12, audit A4). WP4-owned twin of WP3's tz.ts (which the
// ingest path uses); kept separate so the two packages never share a file.
//
// Strategy: the owner's UTC offset is piecewise constant (DST). We find the
// transitions inside the query window once (weekly samples + binary search,
// < 100 Intl calls), then let SQL add the right offset per row with a CASE —
// so day / hour / weekday grouping happens in D1, in the owner's zone, with
// ≤ one row per bucket coming back. Minute offsets (India +330, Nepal +345)
// are exact because the offset is bound in ms, never in whole hours.
//
// PURE: no Nitro auto-imports.

export const TZ_DAY_MS = 86_400_000
export const TZ_HOUR_MS = 3_600_000
const MINUTE_MS = 60_000
const WEEK_MS = 7 * TZ_DAY_MS
/** Transitions older than this are folded into the first segment (≈ 13 months back). */
const SCAN_MAX_MS = 400 * TZ_DAY_MS

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(tz, f)
  }
  return f
}

/** True when `tz` is an IANA zone Intl accepts (≤ 64 chars). */
export function isValidTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false
  try {
    formatter(tz)
    return true
  } catch {
    return false
  }
}

/** Minutes east of UTC for `tz` at the instant `atMs` (e.g. America/Boise in July = −360, Asia/Kolkata = +330). */
export function tzOffsetMin(tz: string, atMs: number): number {
  const parts = formatter(tz).formatToParts(new Date(atMs))
  let y = 1970
  let mo = 1
  let d = 1
  let h = 0
  let mi = 0
  let s = 0
  for (const p of parts) {
    switch (p.type) {
      case 'year':
        y = Number(p.value)
        break
      case 'month':
        mo = Number(p.value)
        break
      case 'day':
        d = Number(p.value)
        break
      case 'hour':
        h = Number(p.value) % 24
        break
      case 'minute':
        mi = Number(p.value)
        break
      case 'second':
        s = Number(p.value)
        break
      default:
        break
    }
  }
  const local = Date.UTC(y, mo - 1, d, h, mi, s)
  const utc = Math.floor(atMs / 1000) * 1000
  return Math.round((local - utc) / MINUTE_MS)
}

export interface TzSegment {
  /** Epoch ms from which `offMin` applies (0 for the first segment). */
  from: number
  offMin: number
}

/**
 * Piecewise-constant offset of `tz` over [startMs, endMs]: the first segment
 * carries the offset at the (clamped) start, one more per DST transition.
 */
export function tzSegments(tz: string, startMs: number, endMs: number): TzSegment[] {
  const end = Math.max(startMs, endMs)
  const lo = Math.max(startMs, end - SCAN_MAX_MS)
  const first: TzSegment = { from: 0, offMin: tzOffsetMin(tz, lo) }
  const segs: TzSegment[] = [first]
  let prevT = lo
  let prevOff = first.offMin
  while (prevT < end) {
    const t = Math.min(prevT + WEEK_MS, end)
    const off = tzOffsetMin(tz, t)
    if (off !== prevOff) {
      // exactly one transition inside (prevT, t] — bisect it to the minute
      let a = prevT
      let b = t
      while (b - a > MINUTE_MS) {
        const m = a + Math.floor((b - a) / 2)
        if (tzOffsetMin(tz, m) === prevOff) a = m
        else b = m
      }
      segs.push({ from: b, offMin: off })
      prevOff = off
    }
    prevT = t
  }
  return segs
}

export interface SqlFragment {
  sql: string
  args: number[]
}

/** `col` shifted into owner-local ms: `(col + offset)` with the DST CASE when needed. */
export function localMsSql(col: string, segs: TzSegment[]): SqlFragment {
  const first = segs[0]
  if (!first) return { sql: `(${col})`, args: [] }
  if (segs.length === 1) return { sql: `(${col} + ?)`, args: [first.offMin * MINUTE_MS] }
  const whens: string[] = []
  const args: number[] = []
  for (let i = segs.length - 1; i >= 1; i--) {
    const seg = segs[i]
    if (!seg) continue
    whens.push(`WHEN ${col} >= ? THEN ?`)
    args.push(seg.from, seg.offMin * MINUTE_MS)
  }
  args.push(first.offMin * MINUTE_MS)
  return { sql: `(${col} + CASE ${whens.join(' ')} ELSE ? END)`, args }
}

/** Owner-tz day index (days since 1970-01-01 in local time) of a local-ms expression. */
export function daySql(localMs: string): string {
  return `(${localMs} / ${TZ_DAY_MS})`
}

/** 0..23 local hour of a local-ms expression. */
export function hourSql(localMs: string): string {
  return `((${localMs} / ${TZ_HOUR_MS}) % 24)`
}

/** 0 = Sunday … 6 = Saturday of a local-ms expression (1970-01-01 was a Thursday). */
export function dowSql(localMs: string): string {
  return `(((${localMs} / ${TZ_DAY_MS}) + 4) % 7)`
}

export function dayIdxOf(tz: string, atMs: number): number {
  return Math.floor((atMs + tzOffsetMin(tz, atMs) * MINUTE_MS) / TZ_DAY_MS)
}

export function dayIdxToYmd(idx: number): string {
  return new Date(idx * TZ_DAY_MS).toISOString().slice(0, 10)
}

/** Epoch ms of local midnight of the owner-tz day containing `atMs`. */
export function dayStart(tz: string, atMs: number): number {
  const idx = dayIdxOf(tz, atMs)
  const guess = idx * TZ_DAY_MS - tzOffsetMin(tz, atMs) * MINUTE_MS
  return idx * TZ_DAY_MS - tzOffsetMin(tz, guess) * MINUTE_MS
}

/** Every owner-tz calendar day touching [startMs, endMs), newest `cap` at most. */
export function listDays(tz: string, startMs: number, endMs: number, cap = 400): string[] {
  const last = dayIdxOf(tz, Math.max(startMs, endMs - 1))
  const first = Math.max(dayIdxOf(tz, startMs), last - cap + 1)
  const out: string[] = []
  for (let i = first; i <= last; i++) out.push(dayIdxToYmd(i))
  return out
}
