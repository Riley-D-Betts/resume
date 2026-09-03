// Pins the in-memory limiter (audit C2 + R2-L8): IPv6 keys collapse to the /64
// a subscriber actually owns, the window map is bounded and swept without a
// timer, and the per-(ip, sid) + per-ip budgets behave the way collect.post.ts
// relies on.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_KEYS, rateLimit, rateLimitKey, rateLimitSize, resetRateLimits } from '../../server/utils/ratelimit.ts'

test('rateLimitKey: IPv4 untouched, IPv6 truncated to /64, idempotent', () => {
  assert.equal(rateLimitKey('203.0.113.9'), '203.0.113.9')
  assert.equal(rateLimitKey(''), '')

  const sixtyFour = '2001:db8:1:2::'
  assert.equal(rateLimitKey('2001:db8:1:2:3:4:5:6'), sixtyFour)
  assert.equal(rateLimitKey('2001:0db8:0001:0002:0003:0004:0005:0006'), sixtyFour, 'leading zeros normalised')
  assert.equal(rateLimitKey('2001:DB8:1:2:3:4:5:6'), sixtyFour, 'case normalised')
  assert.equal(rateLimitKey('2001:db8:1:2::9'), sixtyFour)
  assert.equal(rateLimitKey(sixtyFour), sixtyFour, 'idempotent')
  assert.equal(rateLimitKey(rateLimitKey(rateLimitKey('2001:db8:1:2:3:4:5:6'))), sixtyFour)

  assert.equal(rateLimitKey('fe80::1%eth0'), 'fe80:0:0:0::', 'zone index dropped')
  assert.equal(rateLimitKey('::1'), '0:0:0:0::')

  // Composite keys (the `<ip>|<sid>` collect uses) pass through untouched —
  // they are already built from a truncated address.
  const composite = `${sixtyFour}|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
  assert.equal(rateLimitKey(composite), composite)
  assert.equal(rateLimitKey('not an address'), 'not an address')
})

test('a whole IPv6 /64 shares one budget; a different /64 gets its own', () => {
  resetRateLimits()
  // 5 requests allowed per minute for this test bucket.
  for (let i = 0; i < 5; i++) {
    assert.equal(rateLimit('t1', rateLimitKey(`2001:db8:1:2:3:4:5:${i}`), 5, 60_000), true, `hit ${i}`)
  }
  assert.equal(rateLimit('t1', rateLimitKey('2001:db8:1:2:ffff::1'), 5, 60_000), false, 'the /64 is exhausted')
  assert.equal(rateLimit('t1', rateLimitKey('2001:db8:1:3::1'), 5, 60_000), true, 'a neighbouring /64 is unaffected')
  assert.equal(rateLimit('t2', rateLimitKey('2001:db8:1:2::1'), 5, 60_000), true, 'buckets are independent')
})

test('the per-(ip, sid) budget isolates sessions behind one NAT (R2-L8)', () => {
  resetRateLimits()
  const ip = rateLimitKey('203.0.113.9')
  const sidA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const sidB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  for (let i = 0; i < 120; i++) assert.equal(rateLimit('collect', `${ip}|${sidA}`, 120, 60_000), true)
  assert.equal(rateLimit('collect', `${ip}|${sidA}`, 120, 60_000), false, 'the noisy tab is throttled')
  assert.equal(rateLimit('collect', `${ip}|${sidB}`, 120, 60_000), true, 'its colleague still collects')

  // …under a per-IP ceiling that a single address cannot exceed.
  for (let i = 0; i < 1200; i++) assert.equal(rateLimit('collect-ip', ip, 1200, 60_000), true)
  assert.equal(rateLimit('collect-ip', ip, 1200, 60_000), false)
})

test('the window map stays bounded under a flood of distinct addresses (C2)', () => {
  resetRateLimits()
  for (let i = 0; i < MAX_KEYS + 2500; i++) {
    rateLimit('flood', rateLimitKey(`2001:db8:${(i >> 16) & 0xffff}:${i & 0xffff}::1`), 10, 60_000)
  }
  assert.ok(rateLimitSize() <= MAX_KEYS, `map grew to ${rateLimitSize()}`)
  assert.ok(rateLimitSize() > 0)
  // Still enforcing after the eviction churn.
  const key = rateLimitKey('198.51.100.7')
  for (let i = 0; i < 3; i++) assert.equal(rateLimit('flood', key, 3, 60_000), true)
  assert.equal(rateLimit('flood', key, 3, 60_000), false)
})

test('expired windows are swept on insert, without a timer (C2)', (t) => {
  resetRateLimits()
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 })
  for (let i = 0; i < 3; i++) assert.equal(rateLimit('sweep', `10.0.0.${i}`, 3, 60_000), true)
  assert.equal(rateLimitSize(), 3)

  // Past the window: the budget is fresh again…
  t.mock.timers.tick(61_000)
  assert.equal(rateLimit('sweep', '10.0.0.0', 3, 60_000), true)

  // …and the sweep (every 64th insert) drops the stale entries.
  for (let i = 0; i < 64; i++) rateLimit('sweep', `10.1.0.${i}`, 3, 60_000)
  t.mock.timers.tick(61_000)
  rateLimit('sweep', '10.2.0.1', 3, 60_000)
  for (let i = 0; i < 64; i++) rateLimit('sweep', `10.3.0.${i}`, 3, 60_000)
  assert.ok(rateLimitSize() < 3 + 64 + 1 + 64, `stale windows were not swept (size ${rateLimitSize()})`)
  t.mock.timers.reset()
})
