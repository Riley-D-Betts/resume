// server/utils/tz.ts — timezone arithmetic via Intl (contract C.5 ③, D12).
//
// PURE MODULE (no Nitro auto-imports): unit-tested by tests/unit/tz.test.ts and
// reusable by the ops API for owner-timezone re-bucketing.

const BUCKET_15_MS = 15 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const fmtCache = new Map<string, Intl.DateTimeFormat | null>()

function formatter(tz: string): Intl.DateTimeFormat | null {
  if (fmtCache.has(tz)) return fmtCache.get(tz) ?? null
  let f: Intl.DateTimeFormat | null = null
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    f = null // RangeError: unknown / malformed time zone
  }
  if (fmtCache.size > 512) fmtCache.clear()
  fmtCache.set(tz, f)
  return f
}

/** True when `tz` is an IANA zone Intl knows (aliases such as Asia/Calcutta included). */
export function isKnownTz(tz: string | null | undefined): boolean {
  return typeof tz === 'string' && tz.length > 0 && tz.length <= 64 && formatter(tz) !== null
}

export interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** The wall-clock reading of instant `atMs` in `tz`, or null for an unknown zone. */
export function wallClock(tz: string, atMs: number): WallClock | null {
  const f = formatter(tz)
  if (!f || !Number.isFinite(atMs)) return null
  const out: WallClock = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }
  for (const part of f.formatToParts(new Date(atMs))) {
    switch (part.type) {
      case 'year': out.year = Number(part.value); break
      case 'month': out.month = Number(part.value); break
      case 'day': out.day = Number(part.value); break
      case 'hour': out.hour = Number(part.value) % 24; break
      case 'minute': out.minute = Number(part.value); break
      case 'second': out.second = Number(part.value); break
    }
  }
  return out
}

/**
 * Offset of `tz` from UTC at instant `atMs`, in minutes EAST of UTC
 * (America/Boise = −420 in winter / −360 in summer, Asia/Kolkata = +330).
 * Same sign convention as the client's `-new Date().getTimezoneOffset()`.
 * Null when the zone is unknown.
 */
export function offsetMin(tz: string | null | undefined, atMs: number): number | null {
  if (typeof tz !== 'string' || tz.length === 0) return null
  const w = wallClock(tz, atMs)
  if (!w) return null
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  // Drop the sub-second part of atMs so the division is exact.
  return Math.round((asUtc - Math.floor(atMs / 1000) * 1000) / 60_000)
}

/** Floor an instant to its UTC 15-minute bucket (the SQL grouping unit, D12). */
export function bucket15(ms: number): number {
  return Math.floor(ms / BUCKET_15_MS) * BUCKET_15_MS
}

/** `YYYY-MM-DD` of instant `ms` as seen in `tz` (falls back to UTC for an unknown zone). */
export function dayKey(ms: number, tz: string): string {
  const w = wallClock(tz, ms) ?? wallClock('UTC', ms)
  if (!w) return new Date(ms).toISOString().slice(0, 10)
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`
}

/** Local hour (0..23) of instant `ms` in `tz` (UTC fallback). */
export function hourIn(ms: number, tz: string): number {
  const w = wallClock(tz, ms) ?? wallClock('UTC', ms)
  return w ? w.hour : new Date(ms).getUTCHours()
}

/** Local weekday (0 = Sunday .. 6) of instant `ms` in `tz` (UTC fallback). */
export function weekdayIn(ms: number, tz: string): number {
  const w = wallClock(tz, ms) ?? wallClock('UTC', ms)
  if (!w) return new Date(ms).getUTCDay()
  return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()
}

/** Instant of local midnight (start of the local day containing `ms`) in `tz`. */
export function startOfDayIn(ms: number, tz: string): number {
  const w = wallClock(tz, ms) ?? wallClock('UTC', ms)
  if (!w) return Math.floor(ms / DAY_MS) * DAY_MS
  // First guess: local midnight read as UTC, corrected by the offset at that instant.
  const guess = Date.UTC(w.year, w.month - 1, w.day)
  const off1 = offsetMin(tz, guess) ?? 0
  let start = guess - off1 * 60_000
  // A DST transition at midnight can move the offset; correct once more.
  const off2 = offsetMin(tz, start) ?? off1
  if (off2 !== off1) start = guess - off2 * 60_000
  return start
}
