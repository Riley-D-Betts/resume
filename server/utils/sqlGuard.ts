// server/utils/sqlGuard.ts — read-only guard for the /ops SQL console
// (contract D.3, decisions D5 / D6 / D17). A single-pass lexer, not a regex:
// comments are STRIPPED to one space before anything downstream sees the
// statement (SQLite treats them as whitespace — `DE/**/LETE` is two tokens
// and a syntax error downstream), quoted / bracketed / backticked
// identifiers are normalised and recorded, bytes ≥ 0x80 are identifier
// characters, `;` and bind placeholders are rejected outright, the statement
// must start with SELECT or WITH (optionally `EXPLAIN QUERY PLAN`), every
// bare token is checked against the denylist and every identifier against
// the forbidden names. The accepted statement is wrapped in
// `SELECT * FROM (…) AS rb_q LIMIT ?` — DML inside FROM (…) is a syntax
// error, so the wrap is a second, independent fence. The wrap only ever sees
// the COMMENT-FREE text: an unterminated `/*` used to swallow the appended
// ` ) AS rb_q LIMIT ?`, and a trailing `-- x` used to leak into the column
// name of an unaliased expression. Parenthesis depth is checked too, so
// `SELECT … ) AS x` cannot break out of the wrap. PURE.

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

export type GuardCode = 'empty' | 'toolong' | 'semicolon' | 'placeholder' | 'unterminated' | 'unbalanced' | 'shape' | 'denied' | 'forbidden'

export interface GuardOk {
  ok: true
  /** What to prepare: the wrapped SELECT (bind `limit + 1`) or the bare EXPLAIN (no bind). */
  sql: string
  explain: boolean
  /** The statement as accepted (comments stripped, trimmed, one trailing `;` stripped). */
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

interface Lexed {
  tokens: Token[]
  /** `sql` with every comment replaced by one space — what actually runs. */
  clean: string
}

/**
 * Lex `sql` into tokens and the comment-free text; literals are skipped,
 * identifiers are normalised, parenthesis depth may never go negative.
 */
export function lexAll(sql: string): Lexed | GuardFail {
  const tokens: Token[] = []
  const n = sql.length
  let i = 0
  let out = ''
  let kept = 0
  let depth = 0
  const keep = (to: number) => {
    out += sql.slice(kept, to)
    kept = to
  }
  while (i < n) {
    const ch = sql[i] as string
    const next = sql[i + 1]
    if (isSpace(ch)) {
      i++
      continue
    }
    // comments are replaced by one space, so nothing downstream sees them
    if (ch === '-' && next === '-') {
      keep(i)
      i += 2
      while (i < n && sql[i] !== '\n') i++
      out += ' '
      kept = i
      continue
    }
    if (ch === '/' && next === '*') {
      keep(i)
      i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i = Math.min(n, i + 2) // an unterminated block comment runs to EOF
      out += ' '
      kept = i
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
    if (ch === '(') depth++
    if (ch === ')' && --depth < 0) return fail('unbalanced', 'unbalanced parenthesis — `)` without a matching `(`')
    tokens.push({ kind: 'other', text: ch })
    i++
  }
  if (depth !== 0) return fail('unbalanced', 'unbalanced parenthesis — `(` without a matching `)`')
  keep(n)
  return { tokens, clean: out }
}

/** Tokens only — kept for the unit tests and diagnostics. */
export function lexSql(sql: string): Token[] | GuardFail {
  const r = lexAll(sql)
  return 'ok' in r ? r : r.tokens
}

/**
 * `pragma_table_info(…)` & friends are table-valued functions: the bare
 * `PRAGMA` denylist entry never sees them, so the whole `PRAGMA_` family is
 * denied by prefix. `dbstat` / `sqlite_dbpage` expose raw pages the same way.
 */
function isForbiddenIdentifier(name: string): boolean {
  return (
    name === 'D1_MIGRATIONS'
    || name.startsWith('_CF_')
    || name.startsWith('PRAGMA_')
    || name === 'DBSTAT'
    || name === 'SQLITE_DBSTAT'
    || name === 'SQLITE_DBPAGE'
  )
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
  const trimmed = input.trim().replace(/;\s*$/, '').trim()
  if (trimmed.length === 0) return fail('empty', 'empty statement')

  const lexed = lexAll(trimmed)
  if ('ok' in lexed) return lexed
  const { tokens } = lexed
  if (tokens.length === 0) return fail('empty', 'empty statement')
  // What runs is the comment-free text — never the operator's raw input.
  const source = lexed.clean.trim().replace(/;\s*$/, '').trim()
  if (source.length === 0) return fail('empty', 'empty statement')

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
