// server/utils/opsDb.ts — small D1 helpers shared by the /ops handlers: bind a
// statement, run a batch (one subrequest for many statements), coerce numbers.

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

export type Row = Record<string, unknown>

export function bindStmt(db: D1Database, sql: string, args: readonly unknown[] = []): D1PreparedStatement {
  const s = db.prepare(sql)
  return args.length > 0 ? s.bind(...args) : s
}

/**
 * workerd's SQLite (D1, local and remote) rejects a compound SELECT beyond
 * FIVE terms ("too many terms in compound SELECT") — far below upstream's
 * 500. Every `UNION ALL` list the ops routes build goes through this.
 */
export const UNION_MAX_TERMS = 5

/** Split `UNION ALL` terms into compound statements of ≤ `max` terms each. */
export function unionChunks(terms: readonly string[], max = UNION_MAX_TERMS): string[] {
  const out: string[] = []
  for (let i = 0; i < terms.length; i += max) out.push(terms.slice(i, i + max).join(' UNION ALL '))
  return out
}

/** Run every statement in one D1 round trip; returns each statement's rows. */
export async function batchAll<T = Row>(db: D1Database, stmts: D1PreparedStatement[]): Promise<T[][]> {
  if (stmts.length === 0) return []
  const res = await db.batch<T>(stmts)
  return res.map((r) => r.results ?? [])
}

export function toNum(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function toStr(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v)
}

export function pctOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0
}

export function avgOf(sum: number, n: number): number {
  return n > 0 ? Math.round(sum / n) : 0
}

/** `json_group_array(DISTINCT …)` text → strings without NULLs / blanks. */
export function jsonStrings(v: unknown, cap = 10): string[] {
  if (typeof v !== 'string') return []
  try {
    const arr = JSON.parse(v) as unknown
    if (!Array.isArray(arr)) return []
    const out: string[] = []
    for (const x of arr) {
      if (typeof x === 'string' && x.length > 0) out.push(x)
      if (out.length >= cap) break
    }
    return out
  } catch {
    return []
  }
}

export function jsonNumbers(v: unknown, cap = 10): number[] {
  if (typeof v !== 'string') return []
  try {
    const arr = JSON.parse(v) as unknown
    if (!Array.isArray(arr)) return []
    const out: number[] = []
    for (const x of arr) {
      if (typeof x === 'number' && Number.isFinite(x)) out.push(x)
      if (out.length >= cap) break
    }
    return out
  } catch {
    return []
  }
}

/** Fold `{ dim, k, n }` rows into per-dimension KN lists, preserving row order. */
export function splitDims<D extends string>(rows: readonly Row[], dims: readonly D[]): Record<D, { k: string; n: number }[]> {
  const out = {} as Record<D, { k: string; n: number }[]>
  for (const d of dims) out[d] = []
  for (const r of rows) {
    const d = String(r.dim) as D
    const list = out[d]
    if (list) list.push({ k: r.k === null || r.k === undefined ? '(unknown)' : String(r.k), n: toNum(r.n) })
  }
  return out
}
