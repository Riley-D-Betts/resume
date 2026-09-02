// server/utils/csv.ts — RFC 4180 CSV + NDJSON serialisation for /api/ops/export
// (contract D15). Formula defusing is numeric-aware: a cell is prefixed with
// `'` only when it starts with = + - @ TAB CR AND is not a number, so
// `-116.2` (a longitude) stays numeric while `=cmd()` is neutralised. PURE.

const DEFUSE_RE = /^[=+\-@\t\r]/
const NEEDS_QUOTE_RE = /[",\r\n]/

/** True when a spreadsheet would treat `cell` as a formula (and it is not a number). */
export function needsDefusing(cell: string): boolean {
  return DEFUSE_RE.test(cell) && Number.isNaN(Number(cell))
}

/** One CSV cell: null/undefined → empty, numbers verbatim, strings quoted + defused as needed. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s: string
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'string') s = v
  else if (typeof v === 'bigint') return v.toString()
  else {
    try {
      s = JSON.stringify(v)
    } catch {
      s = String(v)
    }
  }
  if (needsDefusing(s)) s = `'${s}`
  if (NEEDS_QUOTE_RE.test(s) || s.startsWith("'")) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function csvLine(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(',')
}

/** Rows → CSV text (CRLF line ends, trailing CRLF). `header=false` for continuation pages. */
export function toCsv(columns: readonly string[], rows: readonly Record<string, unknown>[], header = true): string {
  const lines: string[] = []
  if (header) lines.push(csvLine(columns))
  for (const r of rows) lines.push(csvLine(columns.map((c) => r[c])))
  return lines.length > 0 ? `${lines.join('\r\n')}\r\n` : ''
}

/** Rows → NDJSON (one JSON object per line, trailing newline). */
export function toNdjson(rows: readonly Record<string, unknown>[]): string {
  return rows.length > 0 ? `${rows.map((r) => JSON.stringify(r)).join('\n')}\n` : ''
}
