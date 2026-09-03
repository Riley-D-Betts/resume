// Applies migrations/0001 → 0002 → 0003 to an in-memory SQLite (the engine
// under D1) with foreign keys enforced, the way D1 does. Pins the contract
// rules from §C.4: 0002 re-applies cleanly, every table stays under D1's
// 100-column cap, every FK child column is indexed (a parent delete must never
// scan a child), and the legacy replay rows are carried into replay_chunks_v2.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

interface Row {
  [k: string]: unknown
}

/**
 * Split a migration file into statements on `;` outside string literals and
 * comments (both `--` and block comments are dropped). The files contain no
 * procedural SQL (no triggers / BEGIN…END), so this mirrors what wrangler's
 * splitter sends to D1.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let buf = ''
  let state: 'code' | 'string' | 'line' | 'block' = 'code'
  const push = (): void => {
    const s = buf.trim()
    if (s.length > 0) out.push(s)
    buf = ''
  }
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i] as string
    const next = sql[i + 1]
    if (state === 'code') {
      if (ch === '-' && next === '-') {
        state = 'line'
        i++
      } else if (ch === '/' && next === '*') {
        state = 'block'
        i++
      } else if (ch === "'") {
        state = 'string'
        buf += ch
      } else if (ch === ';') {
        push()
      } else {
        buf += ch
      }
    } else if (state === 'string') {
      buf += ch
      if (ch === "'") {
        if (next === "'") {
          buf += next
          i++
        } else {
          state = 'code'
        }
      }
    } else if (state === 'line') {
      if (ch === '\n') {
        state = 'code'
        buf += '\n'
      }
    } else if (ch === '*' && next === '/') {
      state = 'code'
      i++
    }
  }
  assert.equal(state, 'code', 'unterminated string literal or comment')
  push()
  return out
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
const sqlOf = (n: number): string => {
  const name = files.find((f) => f.startsWith(String(n).padStart(4, '0') + '_'))
  assert.ok(name, `migration ${n} not found in ${MIGRATIONS_DIR}`)
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf8')
}

function fresh(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

function apply(db: DatabaseSync, n: number): number {
  const stmts = splitStatements(sqlOf(n))
  for (const s of stmts) {
    try {
      db.exec(s)
    } catch (err) {
      throw new Error(`migration ${n} failed at: ${s.slice(0, 120)}\n${(err as Error).message}`)
    }
  }
  return stmts.length
}

function all(db: DatabaseSync, sql: string): Row[] {
  return db.prepare(sql).all() as Row[]
}

function tables(db: DatabaseSync): string[] {
  return all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(
    (r) => r.name as string,
  )
}

function columns(db: DatabaseSync, table: string): string[] {
  return all(db, `PRAGMA table_info("${table}")`).map((r) => r.name as string)
}

/** Leading column of every index on `table`, PK autoindexes included. */
function leadingIndexColumns(db: DatabaseSync, table: string): Set<string> {
  const lead = new Set<string>()
  for (const ix of all(db, `PRAGMA index_list("${table}")`)) {
    const first = all(db, `PRAGMA index_info("${ix.name as string}")`).find((c) => c.seqno === 0)
    if (first) lead.add(first.name as string)
  }
  return lead
}

function migrated(): DatabaseSync {
  const db = fresh()
  for (let n = 1; n <= files.length; n++) apply(db, n)
  return db
}

test('splitStatements: semicolons inside strings and comments do not split', () => {
  const parts = splitStatements(`-- header; not a split
CREATE TABLE t (a TEXT DEFAULT 'x;y'); /* block; comment */
INSERT INTO t VALUES ('it''s;'); -- trailing; comment
`)
  assert.deepEqual(parts, ["CREATE TABLE t (a TEXT DEFAULT 'x;y')", "INSERT INTO t VALUES ('it''s;')"])
})

test('exactly the four migration files exist, numbered 0001..0004', () => {
  assert.deepEqual(
    files.map((f) => f.slice(0, 4)),
    ['0001', '0002', '0003', '0004'],
  )
  assert.equal(files[1], '0002_side_tables.sql')
  assert.equal(files[2], '0003_session_columns.sql')
  assert.equal(files[3], '0004_export_indexes.sql')
})

test('0004 creates the two export keyset indexes', () => {
  const db = migrated()
  const idx = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_events_ts', 'idx_page_visits_entered') ORDER BY name")
    .all()
    .map((r: { name: string }) => r.name)
  assert.deepEqual(idx, ['idx_events_ts', 'idx_page_visits_entered'])
  db.close()
})

test('0001 → 0004 apply on a fresh database with foreign keys on', () => {
  const db = migrated()
  const names = tables(db)
  for (const t of [
    'visitors',
    'sessions',
    'events',
    'replay_chunks',
    'replay_chunks_v2',
    'honeypot_ips',
    'honeypot_hits',
    'session_net',
    'session_env',
    'page_visits',
    'page_perf',
    'rdns_cache',
    'login_attempts',
  ]) {
    assert.ok(names.includes(t), `missing table ${t}`)
  }
  db.close()
})

test('0002 is idempotent: re-applying it succeeds and changes nothing', () => {
  const db = migrated()
  const before = all(db, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
  assert.doesNotThrow(() => apply(db, 2))
  const after = all(db, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
  assert.deepEqual(after, before)
  db.close()
})

test('0002 only uses re-runnable statement forms; 0003 only constant-default ALTERs', () => {
  for (const s of splitStatements(sqlOf(2))) {
    assert.match(
      s,
      /^(CREATE (TABLE|INDEX) IF NOT EXISTS|DROP INDEX IF EXISTS|INSERT OR IGNORE)\b/i,
      `not re-runnable: ${s.slice(0, 80)}`,
    )
  }
  for (const s of splitStatements(sqlOf(3))) {
    assert.match(
      s,
      /^(ALTER TABLE \w+ ADD COLUMN \w+ (TEXT|INTEGER|REAL)( NOT NULL DEFAULT -?\d+)?|CREATE INDEX IF NOT EXISTS)/,
      `not an additive constant-default ALTER / IF NOT EXISTS index: ${s.slice(0, 80)}`,
    )
    assert.doesNotMatch(s, /\b(DROP|RENAME)\b/i, `destructive: ${s.slice(0, 80)}`)
  }
})

test('sessions stays ≤ 100 columns (prints the count) and carries the new hot fields', (t) => {
  const db = migrated()
  const cols = columns(db, 'sessions')
  t.diagnostic(`sessions column count after 0003: ${cols.length}`)
  console.log(`[migrations] sessions column count after 0003: ${cols.length}`)
  assert.ok(cols.length <= 100, `sessions has ${cols.length} columns (> 100)`)
  assert.equal(new Set(cols).size, cols.length, 'duplicate column')
  for (const c of [
    'exit_path',
    'last_path',
    'is_returning',
    'visit_n',
    'nav_kind',
    'asn',
    'as_org',
    'is_webdriver',
    'gpc',
    'dnt',
    'save_data',
    'is_tor',
    'prints',
    'copies',
    'email_copies',
    'selects',
    'form_started',
    'form_submitted',
    'finds',
    'searches',
    'exit_intents',
    'rage_clicks',
    'dead_clicks',
    'right_clicks',
    'errors',
    'outbounds',
    'mailto_clicks',
    'hovers',
    'eggs',
    'subtabs',
    'hidden_ms',
    'blurs',
    'ptr_n',
    'touch_n',
    'key_n',
    'first_interaction_ms',
    'events_n',
  ]) {
    assert.ok(cols.includes(c), `sessions.${c} missing`)
  }
  assert.ok(columns(db, 'events').includes('path'), 'events.path missing')
  for (const c of ['first_as_org', 'first_country', 'first_entry_path', 'last_as_org', 'last_country']) {
    assert.ok(columns(db, 'visitors').includes(c), `visitors.${c} missing`)
  }
  db.close()
})

test('every table stays ≤ 100 columns (D1 cap)', (t) => {
  const db = migrated()
  for (const table of tables(db)) {
    const n = columns(db, table).length
    t.diagnostic(`${table}: ${n} columns`)
    assert.ok(n <= 100, `${table} has ${n} columns`)
  }
  db.close()
})

test('every FK child column is the leading column of some index', () => {
  const db = migrated()
  let checked = 0
  for (const table of tables(db)) {
    const fks = all(db, `PRAGMA foreign_key_list("${table}")`)
    if (fks.length === 0) continue
    const lead = leadingIndexColumns(db, table)
    for (const fk of fks) {
      checked++
      assert.ok(
        lead.has(fk.from as string),
        `${table}.${fk.from as string} → ${fk.table as string}(${fk.to as string}) has no index leading with it`,
      )
    }
  }
  assert.ok(checked >= 6, `expected ≥ 6 FK columns, found ${checked}`)
  db.close()
})

test('deleting a session never scans a child table; replay_chunks_v2 by sid uses its PK', () => {
  const db = migrated()
  const plan = all(db, 'EXPLAIN QUERY PLAN DELETE FROM sessions WHERE sid = ?').map((r) => r.detail as string)
  for (const line of plan) assert.doesNotMatch(line, /^SCAN /, `full scan in cascade: ${line}`)
  const children = ['events', 'page_visits', 'page_perf', 'session_net', 'session_env']
  for (const c of children) {
    assert.ok(plan.some((l) => l.startsWith(`SEARCH ${c} `)), `no SEARCH on ${c} in: ${plan.join(' | ')}`)
  }
  const byId = all(db, 'EXPLAIN QUERY PLAN SELECT COALESCE(SUM(bytes), 0) FROM replay_chunks_v2 WHERE sid = ?').map(
    (r) => r.detail as string,
  )
  assert.ok(byId.some((l) => /SEARCH replay_chunks_v2 USING .*sqlite_autoindex_replay_chunks_v2_1 \(sid=\?\)/.test(l)), byId.join(' | '))
  const legacyDropped = all(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_sessions_vid'")
  assert.equal(legacyDropped.length, 0, 'idx_sessions_vid should be superseded by idx_sessions_vid_started')
  db.close()
})

test('live rows survive: 0002/0003 on a DB with 0001 + data, legacy replay rows copied under rid = legacy', () => {
  const db = fresh()
  apply(db, 1)
  const sid = '11111111-1111-4111-8111-111111111111'
  db.prepare('INSERT INTO visitors (vid, first_seen_at, last_seen_at) VALUES (?, ?, ?)').run('v1', 1000, 2000)
  db.prepare('INSERT INTO sessions (sid, vid, started_at, last_seen_at, pageviews) VALUES (?, ?, ?, ?, 2)').run(
    sid,
    'v1',
    1000,
    2000,
  )
  db.prepare("INSERT INTO events (sid, ts, type, name, payload) VALUES (?, 1500, 'click', NULL, '{}')").run(sid)
  db.prepare('INSERT INTO replay_chunks (sid, seq, bytes, compressed, created_at) VALUES (?, 0, 10, 1, 1200)').run(sid)
  db.prepare('INSERT INTO replay_chunks (sid, seq, bytes, compressed, created_at) VALUES (?, 1, 20, 0, 1300)').run(sid)

  apply(db, 2)
  apply(db, 3)

  const s = db.prepare('SELECT * FROM sessions WHERE sid = ?').get(sid) as Row
  assert.equal(s.pageviews, 2)
  assert.equal(s.mailto_clicks, 0)
  assert.equal(s.events_n, 0)
  assert.equal(s.visit_n, 1)
  assert.equal(s.exit_path, null)
  const e = db.prepare('SELECT path FROM events WHERE sid = ?').get(sid) as Row
  assert.equal(e.path, null)

  const v2 = db.prepare('SELECT * FROM replay_chunks_v2 WHERE sid = ? ORDER BY seq').all(sid) as Row[]
  assert.deepEqual(
    v2.map((r) => ({ ...r })),
    [
      { sid, rid: 'legacy', seq: 0, bytes: 10, compressed: 1, pending: 0, created_at: 1200, page_started_at: 1200 },
      { sid, rid: 'legacy', seq: 1, bytes: 20, compressed: 0, pending: 0, created_at: 1300, page_started_at: 1300 },
    ],
  )
  // The legacy table is kept, and re-running 0002 does not duplicate the copy.
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM replay_chunks').get() as Row).n, 2)
  apply(db, 2)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM replay_chunks_v2').get() as Row).n, 2)

  // New-style rows coexist with the legacy copy under the (sid, rid, seq) key.
  db.prepare(
    'INSERT INTO replay_chunks_v2 (sid, rid, seq, bytes, compressed, pending, created_at, page_started_at) VALUES (?, ?, 0, 5, 1, 1, 3000, 2900)',
  ).run(sid, 'r2')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM replay_chunks_v2 WHERE sid = ?').get(sid) as Row).n, 3)

  // FK enforcement: side rows for an unknown session are rejected, cascades work.
  assert.throws(() => db.prepare('INSERT INTO page_visits (pvid, sid, path, entered_at) VALUES (?, ?, ?, 1)').run('p1', 'nope', '/'))
  db.prepare('INSERT INTO page_visits (pvid, sid, path, entered_at) VALUES (?, ?, ?, 1)').run('p1', sid, '/')
  db.prepare('INSERT INTO session_net (sid, created_at) VALUES (?, 1)').run(sid)
  db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM page_visits').get() as Row).n, 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM session_net').get() as Row).n, 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM events').get() as Row).n, 0)
  db.close()
})
