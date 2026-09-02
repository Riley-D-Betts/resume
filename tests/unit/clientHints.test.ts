// Pins the GREASE cases from contract C.6 and the Sec-CH-UA-* parsers.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isGreaseBrand,
  parseBrands,
  parseChMobile,
  parseChPlatform,
  parseSecChUa,
} from '../../server/utils/clientHints.ts'

test('GREASE brands in every punctuation Chromium has shipped are dropped', () => {
  for (const g of ['Not.A/Brand', 'Not)A;Brand', 'Not_A Brand', ';Not A Brand', 'Not-A.Brand', 'Not A Brand', 'Not:A-Brand', 'Not/A)Brand', 'NotABrand']) {
    assert.equal(isGreaseBrand(g), true, `${g} should be GREASE`)
  }
  for (const ok of ['Chromium', 'Google Chrome', 'Microsoft Edge', 'Samsung Internet', 'Opera GX', 'Brave', 'Yandex']) {
    assert.equal(isGreaseBrand(ok), false, `${ok} should be a real brand`)
  }
  // Anything outside [A-Za-z0-9 .] is treated as GREASE (the alphabet keeps changing).
  assert.equal(isGreaseBrand('Weird(Brand'), true)
  assert.equal(isGreaseBrand(''), true)
})

test('Sec-CH-UA is parsed as a structured list, not string-matched', () => {
  const h = '"Chromium";v="126", "Google Chrome";v="126", "Not.A/Brand";v="8"'
  assert.deepEqual(parseBrands(h), [
    { brand: 'Chromium', version: '126' },
    { brand: 'Google Chrome', version: '126' },
  ])
  assert.equal(parseSecChUa(h), 'Chromium/126;Google Chrome/126')
  // GREASE first, spaces around separators, Edge.
  assert.equal(
    parseSecChUa('"Not)A;Brand";v="99", "Microsoft Edge";v="127", "Chromium";v="127"'),
    'Microsoft Edge/127;Chromium/127',
  )
  // Full-version list shape (Sec-CH-UA-Full-Version-List) parses the same way.
  assert.equal(parseSecChUa('"Chromium";v="126.0.6478.127"'), 'Chromium/126.0.6478.127')
  // Nothing but GREASE → null; garbage → null; absent → null.
  assert.equal(parseSecChUa('"Not_A Brand";v="8"'), null)
  assert.equal(parseSecChUa('Mozilla/5.0 (Windows NT 10.0)'), null)
  assert.equal(parseSecChUa(undefined), null)
  assert.equal(parseSecChUa(''), null)
})

test('Sec-CH-UA output is capped at 200 chars and at 8 brands', () => {
  const many = Array.from({ length: 12 }, (_, i) => `"Brand Number ${i} With A Long Name";v="${100 + i}"`).join(', ')
  const out = parseSecChUa(many)
  assert.ok(out !== null && out.length <= 200)
  assert.ok(parseBrands(many).length <= 8)
})

test('Sec-CH-UA-Mobile and Sec-CH-UA-Platform', () => {
  assert.equal(parseChMobile('?1'), 1)
  assert.equal(parseChMobile('?0'), 0)
  assert.equal(parseChMobile('yes'), null)
  assert.equal(parseChMobile(undefined), null)
  assert.equal(parseChPlatform('"Windows"'), 'Windows')
  assert.equal(parseChPlatform('"macOS"'), 'macOS')
  assert.equal(parseChPlatform('Chrome OS'), 'Chrome OS')
  assert.equal(parseChPlatform('""'), null)
  assert.equal(parseChPlatform(undefined), null)
  assert.equal(parseChPlatform('"<script>"'), null)
  assert.equal(parseChPlatform(`"${'x'.repeat(80)}"`)?.length, 40)
})
