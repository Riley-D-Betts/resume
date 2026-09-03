// Pins every case of contract §D.3 for the SQL console guard, then proves the
// downstream fences on node:sqlite: the wrap runs, DML inside FROM (…) is a
// syntax error, and a comment-split keyword is two tokens SQLite rejects.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DENIED_TOKENS, clampLimit, guardReadOnly, lexSql, wrapLimit } from '../../server/utils/sqlGuard.ts'
import { migratedDb } from './_memdb.ts'

function reject(sql: string): { code: string; reason: string } {
  const r = guardReadOnly(sql)
  assert.equal(r.ok, false, `expected rejection for: ${sql}`)
  if (r.ok) throw new Error('unreachable')
  return r
}

function accept(sql: string): { sql: string; explain: boolean; source: string } {
  const r = guardReadOnly(sql)
  assert.equal(r.ok, true, `expected acceptance for: ${sql} (${r.ok ? '' : r.reason})`)
  if (!r.ok) throw new Error('unreachable')
  return r
}

test('semicolon: two statements are rejected', () => {
  const r = reject('SELECT 1; SELECT 2')
  assert.equal(r.code, 'semicolon')
  assert.match(r.reason, /semicolon/)
})

test('one trailing semicolon is tolerated', () => {
  accept('SELECT 1;')
  accept('SELECT 1 ;  \n')
})

test('comments are whitespace: line and block comments pass', () => {
  accept('SELECT 1 -- x')
  accept('SELECT /* block */ 1')
  accept('SELECT 1 /* unterminated block runs to EOF')
})

test('S3: comments are STRIPPED, so they can neither swallow the wrap nor name a column', () => {
  // A trailing line comment used to leak into the column name of an
  // unaliased expression ("1 -- x"); the accepted source is comment-free.
  const line = accept('SELECT 1 -- x')
  assert.equal(line.source, 'SELECT 1')
  assert.equal(line.sql, wrapLimit('SELECT 1'))

  // An unterminated block comment used to swallow the appended `) AS rb_q LIMIT ?`.
  const open = accept('SELECT 1 /* unterminated')
  assert.equal(open.source, 'SELECT 1')
  assert.ok(open.sql.endsWith('LIMIT ?'))

  // Comments INSIDE the statement become one space, never nothing.
  assert.equal(accept('SELECT/**/1').source, 'SELECT 1')
  assert.equal(accept('SELECT sid --keep\nFROM sessions').source, 'SELECT sid  \nFROM sessions')
  // A comment marker inside a string literal is still just text.
  assert.equal(accept("SELECT '-- not a comment' AS s").source, "SELECT '-- not a comment' AS s")
  assert.equal(accept("SELECT '/* nor this */' AS s").source, "SELECT '/* nor this */' AS s")
})

test('S3: a statement that closes a parenthesis it never opened is rejected', () => {
  const esc = reject('SELECT * FROM sessions) AS x /*')
  assert.equal(esc.code, 'unbalanced')
  assert.match(esc.reason, /parenthesis/)
  assert.equal(reject('SELECT 1) ').code, 'unbalanced')
  assert.equal(reject('SELECT (1').code, 'unbalanced')
  accept('SELECT (1 + 2) AS x FROM (SELECT 1)')
})

test('S5: pragma_* table-valued functions and the page/stat vtabs are off limits', () => {
  for (const sql of [
    "SELECT * FROM pragma_table_info('sessions')",
    "SELECT * FROM PRAGMA_TABLE_LIST",
    'SELECT * FROM "pragma_database_list"',
    'SELECT * FROM dbstat',
    'SELECT * FROM sqlite_dbstat',
    'SELECT * FROM sqlite_dbpage',
    'SELECT * FROM [DBSTAT]',
  ]) {
    assert.equal(reject(sql).code, 'forbidden', sql)
  }
  // The schema browser's own source stays readable, and EXPLAIN still works.
  accept('SELECT sql FROM sqlite_master')
  assert.equal(accept('EXPLAIN QUERY PLAN SELECT * FROM sessions').explain, true)
  // A column that merely starts with the word pragma is fine.
  accept('SELECT pragmatic FROM sessions')
})

test('DE/**/LETE lexes as two harmless tokens (SQLite then fails it)', () => {
  const toks = lexSql('DE/**/LETE FROM t')
  assert.ok(Array.isArray(toks))
  assert.deepEqual(
    toks.map((t) => t.text),
    ['DE', 'LETE', 'FROM', 'T'],
  )
  // inside a SELECT the guard passes it — neither DE nor LETE is a keyword
  accept('SELECT DE/**/LETE FROM t')
  // as a statement head it fails the shape rule (stricter than the contract's wording)
  assert.equal(reject('DE/**/LETE FROM t').code, 'shape')
})

test('shape: DELETE / REPLACE INTO / PRAGMA / ATTACH as the first token', () => {
  const del = reject('DELETE FROM sessions')
  assert.equal(del.code, 'shape')
  assert.match(del.reason, /shape/)

  const rep = reject('REPLACE INTO t VALUES (1)')
  assert.equal(rep.code, 'shape')
  assert.match(rep.reason, /shape/)

  const pragma = reject('PRAGMA table_info(sessions)')
  assert.equal(pragma.code, 'shape')
  assert.match(pragma.reason, /PRAGMA/)

  const attach = reject("ATTACH DATABASE 'x' AS y")
  assert.equal(attach.code, 'shape')
  assert.match(attach.reason, /ATTACH/)

  assert.equal(reject('').code, 'empty')
  assert.equal(reject('   -- only a comment').code, 'empty')
})

test('denylist: bare tokens after a valid head', () => {
  const ins = reject('WITH c AS (SELECT 1) INSERT INTO t SELECT * FROM c')
  assert.equal(ins.code, 'denied')
  assert.match(ins.reason, /INSERT/)

  const into = reject('WITH c AS (SELECT 1) REPLACE INTO t SELECT 1')
  assert.equal(into.code, 'denied')
  assert.match(into.reason, /INTO/)

  assert.match(reject('SELECT 1 UNION ALL DELETE FROM x').reason, /DELETE/)
  assert.match(reject('SELECT load_extension(1)').reason, /LOAD_EXTENSION/)
  assert.match(reject("SELECT * FROM sessions RETURNING sid").reason, /RETURNING/)
  for (const t of DENIED_TOKENS) assert.equal(reject(`SELECT 1 ${t} 2`).code, 'denied', t)
})

test('replace() the function is fine (no REPLACE special case)', () => {
  accept("SELECT replace(ua,'a','b') FROM sessions")
})

test('string literals are opaque: quotes, semicolons and comment markers inside them', () => {
  accept("SELECT 'it''s; fine -- not a comment' AS s")
  accept("SELECT 'delete from sessions' AS s")
  accept("SELECT '/* into */' AS s")
})

test('forbidden identifiers: bare, quoted, bracketed, backticked and dotted', () => {
  for (const sql of [
    'SELECT * FROM d1_migrations',
    'SELECT * FROM "d1_migrations"',
    'SELECT * FROM [_cf_KV]',
    'SELECT * FROM `d1_migrations`',
    'SELECT * FROM main.d1_migrations',
    'SELECT * FROM "D1_MIGRATIONS"',
    'SELECT * FROM _cf_METADATA',
  ]) {
    const r = reject(sql)
    assert.equal(r.code, 'forbidden', sql)
  }
  // escapes are resolved before the check: "d1_""migrations" is the identifier d1_"migrations, not the forbidden one
  const esc = accept('SELECT * FROM "d1_""migrations"')
  assert.ok((esc as unknown as { identifiers: string[] }).identifiers.includes('D1_"MIGRATIONS'))
})

test('quoted identifiers that are allowed', () => {
  accept('SELECT * FROM "sessions"')
  accept('SELECT "into" FROM sessions') // a column named into must be quoted
  accept('SELECT [into], `into` FROM sessions')
  accept('SELECT * FROM sqlite_master')
})

test('placeholders are rejected: ?, :name, @name, $name', () => {
  for (const sql of ['SELECT ? AS x', 'SELECT :x', 'SELECT @x', 'SELECT $x', 'SELECT 1 WHERE 1 = ?1']) {
    assert.equal(reject(sql).code, 'placeholder', sql)
  }
})

test('bytes >= 0x80 are identifier characters', () => {
  const r = accept("SELECT 'é' AS é FROM sessions")
  assert.ok(r.sql.includes('AS é'))
  accept('SELECT ünïcödé FROM sessions')
})

test('unterminated literals and identifiers are rejected', () => {
  assert.equal(reject("SELECT 'abc").code, 'unterminated')
  assert.equal(reject("SELECT 'it''s").code, 'unterminated')
  assert.equal(reject('SELECT "abc').code, 'unterminated')
  assert.equal(reject('SELECT [abc').code, 'unterminated')
  assert.equal(reject('SELECT `abc').code, 'unterminated')
})

test('EXPLAIN QUERY PLAN prefix: explain=true, unwrapped', () => {
  const r = accept('EXPLAIN QUERY PLAN SELECT * FROM sessions WHERE sid = 1')
  assert.equal(r.explain, true)
  assert.equal(r.sql, r.source)
  assert.doesNotMatch(r.sql, /LIMIT \?/)
  assert.equal(reject('EXPLAIN SELECT 1').code, 'shape')
  assert.equal(reject('EXPLAIN QUERY PLAN DELETE FROM t').code, 'shape')
})

test('wrapped output ends with LIMIT ? and keeps the source verbatim', () => {
  const r = accept('SELECT sid FROM sessions')
  assert.equal(r.explain, false)
  assert.ok(r.sql.endsWith('LIMIT ?'))
  assert.equal(r.sql, wrapLimit('SELECT sid FROM sessions'))
  assert.equal(r.sql, 'SELECT * FROM (\nSELECT sid FROM sessions\n) AS rb_q LIMIT ?')
  const w = accept('WITH c AS (SELECT 1 AS x) SELECT x FROM c')
  assert.ok(w.sql.endsWith('LIMIT ?'))
})

test('length cap and limit clamp', () => {
  assert.equal(reject(`SELECT '${'x'.repeat(9000)}'`).code, 'toolong')
  assert.equal(clampLimit(undefined), 200)
  assert.equal(clampLimit('abc'), 200)
  assert.equal(clampLimit(0), 1)
  assert.equal(clampLimit(5000), 1000)
  assert.equal(clampLimit('50'), 50)
})

test('on SQLite: the wrap runs, DML inside FROM (…) is a syntax error, DE/**/LETE fails', () => {
  const db = migratedDb()
  const ok = accept('WITH c AS (SELECT 1 AS x UNION ALL SELECT 2) SELECT x FROM c ORDER BY x DESC')
  const rows = db.prepare(ok.sql).all(2) as { x: number }[]
  assert.deepEqual(
    rows.map((r) => r.x),
    [2, 1],
  )
  assert.throws(() => db.prepare(wrapLimit('DELETE FROM sessions')), /syntax error/)
  assert.throws(() => db.prepare(wrapLimit('SELECT DE/**/LETE FROM sessions')), /no such column/)
  const explain = accept('EXPLAIN QUERY PLAN SELECT * FROM sessions WHERE started_at > 5')
  const plan = db.prepare(explain.sql).all() as { detail: string }[]
  assert.ok(plan.some((r) => /idx_sessions_started/.test(r.detail)), JSON.stringify(plan))
  db.close()
})
