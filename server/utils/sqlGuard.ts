// server/utils/sqlGuard.ts — read-only guard for the /ops SQL console
// (contract D.3, decisions D5 / D6 / D17). A single-pass lexer, not a regex:
// comments are whitespace (SQLite treats them so — `DE/**/LETE` is two
// tokens and a syntax error downstream), quoted / bracketed / backticked
// identifiers are normalised and recorded, bytes ≥ 0x80 are identifier
// characters, `;` and bind placeholders are rejected outright, the statement
// must start with SELECT or WITH (optionally `EXPLAIN QUERY PLAN`), every
// bare token is checked against the denylist and every identifier against
// the forbidden names. The accepted statement is wrapped in
// `SELECT * FROM (…) AS rb_q LIMIT ?` — DML inside FROM (…) is a syntax
// error, so the wrap is a second, independent fence. PURE.

export const DENIED_TOKENS: ReadonlySet<string> = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'ATTACH',
  'DETACH',
  'PRAGMA',
  'VACUUM',
  'REINDEX',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'TRIGGER',
  'RETURNING',
  'UPSERT',
  'INTO',
  'TRUNCATE',
  'LOAD_EXTENSION',
  'READFILE',
  'WRITEFILE',
  'FTS3_TOKENIZER',
  'ZIPFILE',
])

export const MAX_SQL_CHARS = 8192
export const DEFAULT_LIMIT = 200
export const MAX_LIMIT = 1000

export type GuardCode = 'empty' | 'toolong' | 'semicolon' | 'placeholder' | 'unterminated' | 'shape' | 'denied' | 'forbidden'

export interface GuardOk {
  ok: true
  /** What to prepare: the wrapped SELECT (bind `limit + 1`) or the bare EXPLAIN (no bind). */
  sql: string
  explain: boolean
  /** The statement as accepted (trimmed, one trailing `;` stripped). */
  source: string
  /** Every identifier seen, uppercased (bare and quoted) — for diagnostics / tests. */
  identifiers: string[]
}

export interface GuardFail {
  ok: false
  code: GuardCode
  reason: string
}

export type GuardResult = GuardOk | GuardFail

interface Token {
  kind: 'bare' | 'quoted' | 'other'
  /** Uppercased for bare / quoted identifiers. */
  text: string
}

function isIdentStart(ch: string): boolean {
  const c = ch.charCodeAt(0)
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c >= 0x80
}

function isIdentPart(ch: string): boolean {
  const c = ch.charCodeAt(0)
  return isIdentStart(ch) || (c >= 48 && c <= 57) || c === 36
}

function isDigit(ch: string): boolean {
  const c = ch.charCodeAt(0)
  return c >= 48 && c <= 57
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v'
}

function fail(code: GuardCode, reason: string): GuardFail {
  return { ok: false, code, reason }
}

/** Lex `sql` into tokens; comments are dropped, literals are skipped, identifiers are normalised. */
export function lexSql(sql: string): Token[] | GuardFail {
  const tokens: Token[] = []
  const n = sql.length
  let i = 0
  while (i < n) {
    const ch = sql[i] as string
    const next = sql[i + 1]
    if (isSpace(ch)) {
      i++
      continue
    }
    // comments = whitespace
    if (ch === '-' && next === '-') {
      i += 2
      while (i < n && sql[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2 // an unterminated block comment runs to EOF — SQLite accepts that
      continue
    }
    // string literal — never inspected
    if (ch === "'") {
      i++
      for (;;) {
        if (i >= n) return fail('unterminated', 'unterminated string literal')
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      continue
    }
    // quoted identifiers: "…", `…`, […]
    if (ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch
      let text = ''
      i++
      for (;;) {
        if (i >= n) return fail('unterminated', `unterminated ${ch}identifier${close}`)
        const c = sql[i] as string
        if (c === close) {
          if (close !== ']' && sql[i + 1] === close) {
            text += c
            i += 2
            continue
          }
          i++
          break
        }
        text += c
        i++
      }
      tokens.push({ kind: 'quoted', text: text.toUpperCase() })
      continue
    }
    if (ch === ';') return fail('semicolon', 'one statement only — remove the semicolon')
    if (ch === '?' || ch === ':' || ch === '@' || ch === '$') {
      return fail('placeholder', `placeholders not supported (found ${ch}) — inline the value`)
    }
    if (isDigit(ch) || (ch === '.' && next !== undefined && isDigit(next))) {
      i++
      while (i < n && (isIdentPart(sql[i] as string) || sql[i] === '.')) i++
      tokens.push({ kind: 'other', text: '#' })
      continue
    }
    if (isIdentStart(ch)) {
      let j = i + 1
      while (j < n && isIdentPart(sql[j] as string)) j++
      tokens.push({ kind: 'bare', text: sql.slice(i, j).toUpperCase() })
      i = j
      continue
    }
    tokens.push({ kind: 'other', text: ch })
    i++
  }
  return tokens
}

function isForbiddenIdentifier(name: string): boolean {
  return name === 'D1_MIGRATIONS' || name.startsWith('_CF_')
}

/** Wrap an accepted statement so D1 caps the rows (bind `limit + 1`). */
export function wrapLimit(source: string): string {
  return `SELECT * FROM (\n${source}\n) AS rb_q LIMIT ?`
}

/**
 * Accept a read-only SELECT / WITH (optionally `EXPLAIN QUERY PLAN …`) and
 * return the SQL to prepare, or a reason to reject it.
 */
export function guardReadOnly(input: string): GuardResult {
  if (typeof input !== 'string') return fail('empty', 'sql must be a string')
  if (input.length > MAX_SQL_CHARS) return fail('toolong', `statement longer than ${MAX_SQL_CHARS} characters`)
  const source = input.trim().replace(/;\s*$/, '').trim()
  if (source.length === 0) return fail('empty', 'empty statement')

  const lexed = lexSql(source)
  if (!Array.isArray(lexed)) return lexed
  const tokens = lexed
  if (tokens.length === 0) return fail('empty', 'empty statement')

  // shape
  let at = 0
  let explain = false
  const t0 = tokens[0]
  if (t0 && t0.kind === 'bare' && t0.text === 'EXPLAIN') {
    const t1 = tokens[1]
    const t2 = tokens[2]
    if (!(t1 && t1.kind === 'bare' && t1.text === 'QUERY' && t2 && t2.kind === 'bare' && t2.text === 'PLAN')) {
      return fail('shape', 'shape: only the EXPLAIN QUERY PLAN prefix is allowed')
    }
    explain = true
    at = 3
  }
  const head = tokens[at]
  if (!head || head.kind !== 'bare' || (head.text !== 'SELECT' && head.text !== 'WITH')) {
    const got = head ? (head.kind === 'quoted' ? `"${head.text}"` : head.text) : '(nothing)'
    return fail('shape', `shape: statement must start with SELECT or WITH (got ${got})`)
  }

  // denylist + forbidden identifiers
  const identifiers: string[] = []
  for (const t of tokens) {
    if (t.kind === 'other') continue
    identifiers.push(t.text)
    if (t.kind === 'bare' && DENIED_TOKENS.has(t.text)) return fail('denied', `${t.text} is not allowed in the console`)
    if (isForbiddenIdentifier(t.text)) return fail('forbidden', `${t.text} is off limits`)
  }

  return { ok: true, sql: explain ? source : wrapLimit(source), explain, source, identifiers }
}

/** Clamp the console row limit to 1..MAX_LIMIT (default DEFAULT_LIMIT). */
export function clampLimit(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)
  if (!Number.isFinite(n)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(n)))
}
