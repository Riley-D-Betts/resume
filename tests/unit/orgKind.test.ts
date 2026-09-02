// Pins the contract's org / isp / cloud classification cases (F.3).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { orgKind } from '../../server/utils/orgKind.ts'

test('corporate networks are org', () => {
  assert.equal(orgKind('Microsoft Corporation'), 'org')
  assert.equal(orgKind('Google LLC'), 'org')
  assert.equal(orgKind('Apple Inc.'), 'org')
  assert.equal(orgKind('Amazon.com, Inc.'), 'org')
  assert.equal(orgKind('Idaho Milk Products'), 'org')
  assert.equal(orgKind('Boise State University'), 'org')
})

test('hosting / cloud / relay networks are cloud', () => {
  assert.equal(orgKind('Amazon Technologies Inc.'), 'cloud')
  assert.equal(orgKind('AWS'), 'cloud')
  assert.equal(orgKind('Hetzner Online GmbH'), 'cloud')
  assert.equal(orgKind('DigitalOcean'), 'cloud')
  assert.equal(orgKind('DigitalOcean, LLC'), 'cloud')
  assert.equal(orgKind('iCloud Private Relay'), 'cloud')
  assert.equal(orgKind('Microsoft Azure'), 'cloud')
  assert.equal(orgKind('Google Cloud'), 'cloud')
  assert.equal(orgKind('Cloudflare, Inc.'), 'cloud')
  assert.equal(orgKind('OVH SAS'), 'cloud')
})

test('consumer carriers are isp', () => {
  assert.equal(orgKind('Comcast Cable'), 'isp')
  assert.equal(orgKind('Comcast Cable Communications, LLC'), 'isp')
  assert.equal(orgKind('Verizon Business'), 'isp')
  assert.equal(orgKind('AT&T Services, Inc.'), 'isp')
  assert.equal(orgKind('T-Mobile USA, Inc.'), 'isp')
  assert.equal(orgKind('Charter Communications Inc'), 'isp')
  assert.equal(orgKind('Google Fiber Inc.'), 'isp')
})

test('empty / unknown', () => {
  assert.equal(orgKind(null), 'unknown')
  assert.equal(orgKind(undefined), 'unknown')
  assert.equal(orgKind(''), 'unknown')
  assert.equal(orgKind('   '), 'unknown')
  assert.equal(orgKind('(unknown)'), 'unknown')
})
