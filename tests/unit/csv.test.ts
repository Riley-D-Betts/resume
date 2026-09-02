// RFC 4180 quoting and the numeric-aware formula defusing of server/utils/csv.ts
// (contract D.2 export row): `-116.2` stays numeric, `=cmd` gets defused.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { csvCell, csvLine, needsDefusing, toCsv, toNdjson } from '../../server/utils/csv.ts'

test('plain cells pass through; null / undefined are empty', () => {
  assert.equal(csvCell('hello'), 'hello')
  assert.equal(csvCell(null), '')
  assert.equal(csvCell(undefined), '')
  assert.equal(csvCell(''), '')
  assert.equal(csvCell(42), '42')
  assert.equal(csvCell(-116.2), '-116.2')
  assert.equal(csvCell(true), 'true')
  assert.equal(csvCell(Number.NaN), '')
})

test('RFC 4180: commas, quotes and line breaks force quoting; quotes are doubled', () => {
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"')
  assert.equal(csvCell('line1\r\nline2'), '"line1\r\nline2"')
  assert.equal(csvLine(['a', 'b,c', 1, null]), 'a,"b,c",1,')
})

test('defusing is numeric-aware', () => {
  assert.equal(needsDefusing('-116.2'), false)
  assert.equal(needsDefusing('+1'), false)
  assert.equal(needsDefusing('=cmd'), true)
  assert.equal(needsDefusing('=1+1'), true)
  assert.equal(needsDefusing('@SUM(A1)'), true)
  assert.equal(needsDefusing('-abc'), true)
  assert.equal(needsDefusing('\tx'), true)
  assert.equal(needsDefusing('\rx'), true)
  assert.equal(needsDefusing('abc'), false)

  assert.equal(csvCell('-116.2'), '-116.2')
  assert.equal(csvCell('+1.5'), '+1.5')
  assert.equal(csvCell('=cmd|/c calc'), '"\'=cmd|/c calc"')
  assert.equal(csvCell('=1+1'), '"\'=1+1"')
  assert.equal(csvCell('@foo'), '"\'@foo"')
  assert.equal(csvCell('-abc'), '"\'-abc"')
  assert.equal(csvCell('\tx'), '"\'\tx"')
})

test('objects are JSON-encoded and quoted', () => {
  assert.equal(csvCell({ a: 1 }), '"{""a"":1}"')
  assert.equal(csvCell([1, 2]), '"[1,2]"')
})

test('toCsv: header once, CRLF line ends, trailing CRLF, header=false for continuation pages', () => {
  const rows = [
    { sid: 'a', lon: -116.2, note: 'x,y' },
    { sid: 'b', lon: null, note: '=cmd' },
  ]
  const cols = ['sid', 'lon', 'note']
  assert.equal(toCsv(cols, rows), 'sid,lon,note\r\na,-116.2,"x,y"\r\nb,,"\'=cmd"\r\n')
  assert.equal(toCsv(cols, rows, false), 'a,-116.2,"x,y"\r\nb,,"\'=cmd"\r\n')
  assert.equal(toCsv(cols, []), 'sid,lon,note\r\n')
  assert.equal(toCsv(cols, [], false), '')
})

test('toNdjson: one object per line with a trailing newline', () => {
  assert.equal(toNdjson([{ a: 1 }, { b: 'x' }]), '{"a":1}\n{"b":"x"}\n')
  assert.equal(toNdjson([]), '')
})
