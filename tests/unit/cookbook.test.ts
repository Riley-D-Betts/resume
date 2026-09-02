// The SQL console presets: no TLS-fingerprint columns (contract §I), every
// preset passes the read-only guard, and every preset prepares (and runs)
// against the migrated schema — wrapped exactly the way sql.post.ts wraps it.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { COOKBOOK, renderCookbookSql } from '../../shared/analytics/cookbook.ts'
import { guardReadOnly } from '../../server/utils/sqlGuard.ts'
import { migratedDb } from './_memdb.ts'

const REQUIRED_TITLES = [
  'Orgs that came back',
  'Who copied my email',
  'Mailto clicks by org',
  'Form abandoners by subject',
  'p75 LCP by device',
  'Top path flows',
  'Sessions per hour (UTC)',
  'TZ offset mismatch',
  'Errors by browser',
  'What did org X read',
]

test('the contract presets exist, with unique titles', () => {
  const titles = COOKBOOK.map((c) => c.title)
  for (const t of REQUIRED_TITLES) assert.ok(titles.includes(t), `missing preset: ${t}`)
  assert.equal(new Set(titles).size, titles.length)
})

test('no preset mentions ja3 / ja4 / sha1 (title, sql or note)', () => {
  for (const c of COOKBOOK) {
    const text = `${c.title}\n${c.sql}\n${c.note ?? ''}`
    assert.doesNotMatch(text, /ja3|ja4|sha1/i, c.title)
  }
})

test('every preset passes sqlGuard after ${tzOffsetMin} substitution', () => {
  for (const c of COOKBOOK) {
    const sql = renderCookbookSql(c.sql, -360)
    const r = guardReadOnly(sql)
    assert.equal(r.ok, true, `${c.title}: ${r.ok ? '' : r.reason}`)
    if (r.ok) assert.equal(r.explain, false)
  }
})

test('the raw tz preset carries the placeholder; substitution clamps and truncates', () => {
  const tz = COOKBOOK.find((c) => c.title === 'Sessions per hour (UTC)')
  assert.ok(tz)
  assert.ok(tz.sql.includes('${tzOffsetMin}'))
  assert.ok(renderCookbookSql(tz.sql, 330).includes("'330 minutes'"))
  assert.ok(renderCookbookSql(tz.sql, -360.7).includes("'-360 minutes'"))
  assert.ok(renderCookbookSql(tz.sql, 99999).includes("'900 minutes'"))
  assert.ok(renderCookbookSql(tz.sql, Number.NaN).includes("'0 minutes'"))
  assert.equal(renderCookbookSql('SELECT 1', 5), 'SELECT 1')
})

test('every preset prepares and runs (wrapped, LIMIT bound) on the migrated schema', () => {
  const db = migratedDb()
  for (const c of COOKBOOK) {
    const r = guardReadOnly(renderCookbookSql(c.sql, 0))
    assert.ok(r.ok, c.title)
    if (!r.ok) continue
    assert.doesNotThrow(() => db.prepare(r.sql).all(201), c.title)
  }
  db.close()
})
