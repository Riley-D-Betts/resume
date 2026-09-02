/**
 * Shared formatters for the /ops console. Everything renders in the OWNER's
 * timezone (the same `tz` the API buckets by — audit A4), numbers are
 * tabular, and every function is null-safe so half-populated rows render as
 * `—` instead of `NaN`.
 */

export type DeltaGlyph = '▲' | '▼' | '▬'

export interface Delta {
  abs: number
  /** Percent change vs prev; null when prev is 0 / unknown. */
  pct: number | null
  glyph: DeltaGlyph
  /** `▲ 12%` · `▼ 3%` · `▬ 0%` · `▲ +4` (no pct). */
  text: string
}

/** IANA zone of the browser the console runs in ('UTC' when unavailable). */
export function ownerTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Minutes east of UTC for `tz` at `at` (DST-aware), via Intl — no Date.getTimezoneOffset. */
export function tzOffsetMin(tz: string, at: number = Date.now()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(at))
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
    return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000)
  } catch {
    return 0
  }
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function safeFmt(opts: Intl.DateTimeFormatOptions, tz: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz })
  } catch {
    return new Intl.DateTimeFormat('en-US', opts)
  }
}

export function useOpsFormat(tz?: string) {
  const zone = tz ?? ownerTz()
  const numFmt = new Intl.NumberFormat('en-US')
  const dateF = safeFmt({ year: 'numeric', month: '2-digit', day: '2-digit' }, zone)
  const timeF = safeFmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }, zone)
  const dtF = safeFmt({ month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, zone)
  const dtsF = safeFmt(
    { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' },
    zone,
  )
  const fullF = safeFmt(
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    },
    zone,
  )

  /** en-US `YYYY-MM-DD` from the parts (the locale's own order is MM/DD/YYYY). */
  function ymd(ts: number): string {
    const p = dateF.formatToParts(new Date(ts))
    const g = (t: string) => p.find(x => x.type === t)?.value ?? ''
    return `${g('year')}-${g('month')}-${g('day')}`
  }

  /** Tabular integer / fixed decimals with thousands separators; `—` for null. */
  function num(v: unknown, digits = 0): string {
    if (!isNum(v)) return '—'
    return digits > 0
      ? v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : numFmt.format(Math.round(v))
  }

  /** 1.2K · 3.4M — for tiles where width matters. */
  function kfmt(v: unknown): string {
    if (!isNum(v)) return '—'
    const a = Math.abs(v)
    if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
    if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`
    return numFmt.format(Math.round(v))
  }

  /** `v` is already in percent units (12.3 → `12.3%`). */
  function pct(v: unknown, digits = 0): string {
    if (!isNum(v)) return '—'
    return `${v.toFixed(digits)}%`
  }

  /** n / total as a percentage string; `—` when total is 0. */
  function share(n: unknown, total: unknown, digits = 0): string {
    if (!isNum(n) || !isNum(total) || total <= 0) return '—'
    return pct((n / total) * 100, digits)
  }

  /** `mm:ss` (hours fold into minutes: 1:03:20 → 63:20). */
  function mmss(msValue: unknown): string {
    if (!isNum(msValue)) return '—'
    const s = Math.max(0, Math.round(msValue / 1000))
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }

  /** Human duration: `340 ms` · `1.2 s` · `2:03`. */
  function ms(msValue: unknown): string {
    if (!isNum(msValue)) return '—'
    const a = Math.abs(msValue)
    if (a < 1000) return `${Math.round(msValue)} ms`
    if (a < 60_000) return `${(msValue / 1000).toFixed(a < 10_000 ? 2 : 1)} s`
    return mmss(msValue)
  }

  /** Seconds with one decimal: `12.3s`. */
  function sec(msValue: unknown, digits = 1): string {
    if (!isNum(msValue)) return '—'
    return `${(msValue / 1000).toFixed(digits)}s`
  }

  /** `1.2 MB` · `340 KB` · `12 B`. */
  function bytes(v: unknown): string {
    if (!isNum(v)) return '—'
    const a = Math.abs(v)
    if (a >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`
    if (a >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`
    if (a >= 1024) return `${(v / 1024).toFixed(0)} KB`
    return `${Math.round(v)} B`
  }

  /** Megabytes with one decimal (legacy readout). */
  function mb(v: unknown): string {
    return isNum(v) ? (v / 1048576).toFixed(1) : '—'
  }

  /** `YYYY-MM-DD` in the owner's zone. */
  function date(ts: unknown): string {
    return isNum(ts) ? ymd(ts) : '—'
  }

  /** `HH:MM:SS` in the owner's zone. */
  function time(ts: unknown): string {
    return isNum(ts) ? timeF.format(new Date(ts)) : '—'
  }

  /** `MM-DD HH:MM` in the owner's zone (log lines, tables). */
  function dateTime(ts: unknown): string {
    return isNum(ts) ? dtF.format(new Date(ts)).replace(', ', ' ').replace('/', '-') : '—'
  }

  /** `MM-DD HH:MM:SS`. */
  function dateTimeSec(ts: unknown): string {
    return isNum(ts) ? dtsF.format(new Date(ts)).replace(', ', ' ').replace('/', '-') : '—'
  }

  /** `YYYY-MM-DD HH:MM:SS` (session detail, exports). */
  function full(ts: unknown): string {
    if (!isNum(ts)) return '—'
    return `${ymd(ts)} ${fullF.formatToParts(new Date(ts)).filter(p => ['hour', 'minute', 'second'].includes(p.type)).map(p => p.value).join(':')}`
  }

  /** Axis label for a `YYYY-MM-DD` bucket: `09-02`. */
  function dayLabel(day: unknown): string {
    if (typeof day !== 'string') return '—'
    return day.length >= 10 ? day.slice(5, 10) : day
  }

  /** Relative age: `12 s` · `3 m` · `2 h` · `5 d`. */
  function ago(ts: unknown, now: number = Date.now()): string {
    if (!isNum(ts)) return '—'
    const d = Math.max(0, now - ts)
    if (d < 60_000) return `${Math.floor(d / 1000)} s`
    if (d < 3_600_000) return `${Math.floor(d / 60_000)} m`
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h`
    return `${Math.floor(d / 86_400_000)} d`
  }

  /** Change vs the previous period. Glyph carries direction; colour never does. */
  function delta(cur: unknown, prev: unknown): Delta | null {
    if (!isNum(cur) || !isNum(prev)) return null
    const abs = cur - prev
    const pctv = prev !== 0 ? (abs / Math.abs(prev)) * 100 : null
    const glyph: DeltaGlyph = abs > 0 ? '▲' : abs < 0 ? '▼' : '▬'
    const a = pctv === null ? 0 : Math.abs(pctv)
    const text =
      pctv === null
        ? `${glyph} ${abs > 0 ? '+' : ''}${num(abs)}`
        : `${glyph} ${a === 0 ? '0' : a >= 100 ? Math.round(a) : a.toFixed(a < 10 ? 1 : 0)}%`
    return { abs, pct: pctv, glyph, text }
  }

  /** `—` for null / empty, else the string. */
  function str(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—'
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }

  /** `YES` / `NO` / `—` for the 0/1/null columns. */
  function yn(v: unknown): string {
    if (v === null || v === undefined) return '—'
    return v === 1 || v === true || v === '1' ? 'YES' : 'NO'
  }

  return {
    tz: zone,
    num,
    kfmt,
    pct,
    share,
    mmss,
    ms,
    sec,
    bytes,
    mb,
    date,
    time,
    dateTime,
    dateTimeSec,
    full,
    dayLabel,
    ago,
    delta,
    str,
    yn,
    tzOffsetMin: (at?: number) => tzOffsetMin(zone, at),
  }
}
