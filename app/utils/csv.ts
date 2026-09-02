/**
 * Client-side CSV (RFC 4180) for the /ops console — COPY CSV in DataTable
 * and the SqlConsole. Mirrors `server/utils/csv.ts`: quote when needed and
 * defuse spreadsheet formulas with a leading apostrophe ONLY when the cell
 * both starts with a trigger character and is not a number, so `-116.2`
 * (a longitude) stays numeric while `=HYPERLINK(...)` / `-cmd` are inert.
 */

const TRIGGER_RE = /^[=+\-@\t\r]/
const NEEDS_QUOTE_RE = /[",\r\n]/

/** Prefix a leading `'` when the cell would be read as a formula by a spreadsheet. */
export function defuseCell(cell: string): string {
  return TRIGGER_RE.test(cell) && Number.isNaN(Number(cell)) ? `'${cell}` : cell
}

/** One cell: null/undefined → empty, objects → JSON, then defuse + quote. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const raw = typeof value === 'object' ? JSON.stringify(value) : String(value)
  const s = defuseCell(raw)
  return NEEDS_QUOTE_RE.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Header + rows, CRLF line ends, no trailing newline. */
export function toCsv(columns: string[], rows: unknown[][]): string {
  const lines = [columns.map(csvCell).join(',')]
  for (const row of rows) lines.push(row.map(csvCell).join(','))
  return lines.join('\r\n')
}

/** Object rows through column definitions (`label` is the header, `key` the field). */
export function rowsToCsv(
  columns: { key: string; label?: string }[],
  rows: Record<string, unknown>[],
  format?: (key: string, value: unknown, row: Record<string, unknown>) => unknown,
): string {
  return toCsv(
    columns.map(c => c.label ?? c.key),
    rows.map(r => columns.map(c => (format ? format(c.key, r[c.key], r) : r[c.key]))),
  )
}

/**
 * Put text on the clipboard; `navigator.clipboard` first, a hidden textarea
 * + `execCommand('copy')` when the async API is unavailable. Resolves to
 * whether the copy succeeded. Client only.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the textarea path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
