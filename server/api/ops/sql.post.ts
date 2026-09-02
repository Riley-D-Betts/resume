import type { H3Event } from 'h3'
import type { SqlError, SqlResult } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { getClientIp } from '../../utils/ip'
import { toNum } from '../../utils/opsDb'
import { rateLimit } from '../../utils/ratelimit'
import { MAX_SQL_CHARS, clampLimit, guardReadOnly } from '../../utils/sqlGuard'

const TIMEOUT_MS = 10_000
const CELL_MAX = 500
const RESPONSE_MAX = 1_000_000

function fail(event: H3Event, status: number, error: string): SqlError {
  setResponseStatus(event, status)
  return { error }
}

/** Stringify + truncate one cell (numbers / booleans / null pass through). */
function cell(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'boolean') return v
  let s: string
  if (typeof v === 'string') s = v
  else if (v instanceof ArrayBuffer) s = `<blob ${v.byteLength} B>`
  else if (ArrayBuffer.isView(v)) s = `<blob ${v.byteLength} B>`
  else {
    try {
      s = JSON.stringify(v)
    } catch {
      s = String(v)
    }
  }
  return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX)}…` : s
}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(t)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

/**
 * POST /api/ops/sql — read-only console (contract D.3). Body { sql, limit? },
 * header x-rb-ops: 1, ≤ 8192 chars, limit 1..1000 (default 200). The lexer
 * guard accepts SELECT / WITH (+ EXPLAIN QUERY PLAN), wraps it in
 * `SELECT * FROM (…) AS rb_q LIMIT ?` bound limit + 1, runs `.all()` (the
 * only path with meta; `.raw({ columnNames: true })` once to recover the
 * header of an empty result), truncates cells > 500 chars, caps the body at
 * 1 MB, passes D1 errors through as { error } 400, 504 after 10 s, logs a
 * rows_written canary and an audit line, rate-limited 30/min.
 */
export default defineEventHandler(async (event): Promise<SqlResult | SqlError> => {
  await requireAdmin(event)
  const ip = getClientIp(event)
  if (!rateLimit('ops-sql', ip, 30, 60_000)) return fail(event, 429, 'rate limited: 30 statements per minute')
  if (getHeader(event, 'x-rb-ops') !== '1') return fail(event, 400, 'missing x-rb-ops header')

  const body = await readBody<{ sql?: unknown; limit?: unknown }>(event).catch(() => null)
  const sql = typeof body?.sql === 'string' ? body.sql : ''
  if (sql.length === 0) return fail(event, 400, 'sql required')
  if (sql.length > MAX_SQL_CHARS) return fail(event, 400, `statement longer than ${MAX_SQL_CHARS} characters`)
  const limit = clampLimit(body?.limit)

  const guard = guardReadOnly(sql)
  if (!guard.ok) return fail(event, 400, guard.reason)

  const db = getDb(event)
  const t0 = Date.now()
  let columns: string[] = []
  let raw: unknown[][] = []
  let rowsRead: number | null = null
  let note: string | undefined
  let truncated = false
  try {
    if (guard.explain) {
      const r = await timeout(db.prepare(guard.sql).all<Record<string, unknown>>(), TIMEOUT_MS)
      columns = Object.keys(r.results[0] ?? {})
      raw = r.results.map((row) => columns.map((c) => row[c]))
      rowsRead = r.meta?.rows_read ?? null
    } else {
      const stmt = db.prepare(guard.sql).bind(limit + 1)
      const r = await timeout(stmt.all<Record<string, unknown>>(), TIMEOUT_MS)
      rowsRead = r.meta?.rows_read ?? null
      if (r.meta && toNum(r.meta.rows_written) > 0) {
        console.error('[ops-sql] INVARIANT rows_written > 0', { ip, rowsWritten: r.meta.rows_written, sql: guard.source.slice(0, 300) })
      }
      const results = r.results
      if (results.length === 0) {
        // recover the header of an empty result set (.all() cannot)
        const header = await timeout(stmt.raw<unknown[]>({ columnNames: true }), TIMEOUT_MS)
        const first = header[0]
        columns = Array.isArray(first) ? first.map((c) => String(c)) : []
        if (new Set(columns).size < columns.length) note = 'alias duplicate columns'
        columns = [...new Set(columns)]
      } else {
        columns = Object.keys(results[0] ?? {})
        truncated = results.length > limit
        raw = results.slice(0, limit).map((row) => columns.map((c) => row[c]))
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'timeout') {
      console.warn('[ops-sql] timeout', { ip, sql: guard.source.slice(0, 300) })
      return fail(event, 504, 'query timed out after 10 s (D1 keeps running a runaway query for up to 30 s)')
    }
    return fail(event, 400, msg)
  }
  const durationMs = Date.now() - t0

  // result hygiene: cell truncation + a 1 MB body cap (rows dropped from the end)
  const rows: unknown[][] = []
  let bytes = JSON.stringify(columns).length + 200
  for (const r of raw) {
    const cells = r.map(cell)
    const size = JSON.stringify(cells).length + 1
    if (bytes + size > RESPONSE_MAX) {
      truncated = true
      note = note ? `${note}; response capped at 1 MB` : 'response capped at 1 MB'
      break
    }
    bytes += size
    rows.push(cells)
  }

  console.log('[ops-sql]', ip, `${durationMs}ms`, `rows_read=${rowsRead ?? '?'}`, `rows=${rows.length}`, guard.source.slice(0, 300).replace(/\s+/g, ' '))
  const out: SqlResult = { columns, rows, rowCount: rows.length, truncated, durationMs, rowsRead, explain: guard.explain }
  if (note) out.note = note
  return out
})
