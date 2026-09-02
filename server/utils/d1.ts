// server/utils/d1.ts — bound-parameter guard for D1 (contract C.5).
//
// PURE MODULE (no Nitro auto-imports) so the unit test can import it.
//
// D1 throws D1_TYPE_ERROR on an `undefined` bind and fails the WHOLE batch —
// one missed `?? null` would be a total collection outage. It also caps a
// statement at 100 bound parameters. `bindChecked` verifies the arg count
// against the SQL's distinct placeholders, rejects > 100, and coerces
// `undefined` / `NaN` to null: in dev it throws (so the seed / e2e catch the
// bug), in production it warns and coerces (collection keeps flowing).

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

export const D1_MAX_PARAMS = 100

/**
 * Count the DISTINCT bound placeholders in `sql`: every anonymous `?` is its
 * own slot; numbered `?NNN` slots count once each and raise the total to the
 * highest number used (SQLite semantics). String literals ('…' and "…"),
 * line comments and block comments are skipped.
 */
export function countPlaceholders(sql: string): number {
  let anonymous = 0
  let maxNumbered = 0
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i] as string
    const next = sql[i + 1]
    if (ch === "'" || ch === '"') {
      // string literal / quoted identifier; doubled quote = escaped quote
      const q = ch
      i++
      while (i < n) {
        if (sql[i] === q) {
          if (sql[i + 1] === q) {
            i += 2
            continue
          }
          break
        }
        i++
      }
      i++
      continue
    }
    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (ch === '?') {
      let j = i + 1
      let digits = ''
      while (j < n && (sql[j] as string) >= '0' && (sql[j] as string) <= '9') digits += sql[j++]
      if (digits.length > 0) {
        maxNumbered = Math.max(maxNumbered, Number(digits))
      } else {
        anonymous++
      }
      i = j
      continue
    }
    i++
  }
  // Anonymous slots are numbered after the highest explicit one in SQLite
  // when mixed; the common case is one style per statement.
  return Math.max(anonymous + maxNumbered, anonymous, maxNumbered)
}

const placeholderCache = new Map<string, number>()

function placeholders(sql: string): number {
  let c = placeholderCache.get(sql)
  if (c === undefined) {
    c = countPlaceholders(sql)
    if (placeholderCache.size > 256) placeholderCache.clear()
    placeholderCache.set(sql, c)
  }
  return c
}

export interface CheckResult {
  args: unknown[]
  problems: string[]
}

/**
 * Validate + coerce the bind args for `sql`. Returns the coerced args and the
 * list of problems found (empty when clean). Never throws by itself.
 */
export function checkArgs(sql: string, args: readonly unknown[]): CheckResult {
  const problems: string[] = []
  const expected = placeholders(sql)
  if (args.length > D1_MAX_PARAMS) problems.push(`${args.length} bound params > ${D1_MAX_PARAMS}`)
  if (args.length !== expected) problems.push(`bound ${args.length} args for ${expected} placeholders`)
  const out = new Array<unknown>(args.length)
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === undefined) {
      problems.push(`arg[${i}] is undefined`)
      out[i] = null
    } else if (typeof a === 'number' && Number.isNaN(a)) {
      problems.push(`arg[${i}] is NaN`)
      out[i] = null
    } else if (typeof a === 'boolean') {
      // D1 accepts booleans, but SQLite stores INTEGER: be explicit.
      out[i] = a ? 1 : 0
    } else {
      out[i] = a
    }
  }
  return { args: out, problems }
}

/** Nitro replaces `import.meta.dev` at build time; under node it is undefined. */
const STRICT = Boolean((import.meta as { dev?: boolean }).dev)

/**
 * `db.prepare(sql).bind(...args)` with the C.5 guard: throws in dev, warns and
 * coerces in production. Pass `label` so the log names the statement.
 */
export function bindChecked(db: D1Database, sql: string, args: readonly unknown[], label = 'stmt'): D1PreparedStatement {
  const { args: clean, problems } = checkArgs(sql, args)
  if (problems.length > 0) {
    const msg = `[d1] ${label}: ${problems.join('; ')}`
    if (STRICT) throw new Error(msg)
    console.warn(msg)
  }
  return db.prepare(sql).bind(...clean)
}
