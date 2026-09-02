// WP0 smoke test: the wire catalogue is what every other package assumes.
// Runs under `node --test` with native type stripping — pure imports only.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ESSENTIAL_TYPES,
  EVENT_TYPES,
  INTENT_FLAGS,
  LEGACY_RID,
  PAGE_CAPS,
  SCROLL_MILESTONES,
  SESSION_EVENT_CAP,
  WIRE_VERSION,
} from '../../shared/analytics/events.ts'

test('EVENT_TYPES has exactly 31 unique snake_case names', () => {
  assert.equal(EVENT_TYPES.length, 31)
  assert.equal(new Set(EVENT_TYPES).size, EVENT_TYPES.length, 'duplicate event type')
  for (const t of EVENT_TYPES) assert.match(t, /^[a-z][a-z_]*$/, `bad name: ${t}`)
  assert.equal(EVENT_TYPES[0], 'pageview')
  assert.equal(EVENT_TYPES[EVENT_TYPES.length - 1], 'replay_chunk_lost')
})

test('ESSENTIAL_TYPES is a proper subset of EVENT_TYPES', () => {
  const all = new Set<string>(EVENT_TYPES)
  assert.ok(ESSENTIAL_TYPES.length > 0)
  assert.ok(ESSENTIAL_TYPES.length < EVENT_TYPES.length)
  assert.equal(new Set(ESSENTIAL_TYPES).size, ESSENTIAL_TYPES.length, 'duplicate essential type')
  for (const t of ESSENTIAL_TYPES) assert.ok(all.has(t), `${t} is not an event type`)
})

test('PAGE_CAPS keys are event types with positive integer caps', () => {
  const all = new Set<string>(EVENT_TYPES)
  for (const [k, v] of Object.entries(PAGE_CAPS)) {
    assert.ok(all.has(k), `${k} is not an event type`)
    assert.ok(Number.isInteger(v) && (v as number) > 0, `${k} cap must be a positive integer`)
  }
})

test('constants', () => {
  assert.equal(WIRE_VERSION, 2)
  assert.equal(SESSION_EVENT_CAP, 400)
  assert.equal(LEGACY_RID, 'legacy')
  assert.deepEqual([...SCROLL_MILESTONES], [25, 50, 75, 90, 100])
  assert.equal(new Set(INTENT_FLAGS).size, INTENT_FLAGS.length, 'duplicate intent flag')
  assert.ok(INTENT_FLAGS.includes('email') && INTENT_FLAGS.includes('submit'))
})
