// The durable /ops login throttle (audit A23, security S1). The lockout used
// to be a read-modify-write in JS: a wave of parallel guesses each read the
// same `n` and each wrote `n + 1`, so ten simultaneous attempts advanced the
// counter by one. The statement below does the whole increment inside SQLite,
// so N executions produce N — that is what these tests pin, on the real
// migrated schema.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { BUMP_ATTEMPT_SQL, LOGIN_WINDOW_MS, lockMinutes, loginThrottleKey } from '../../server/utils/loginThrottle.ts'
import { migratedDb } from './_memdb.ts'

const WINDOW_MS = LOGIN_WINDOW_MS

interface Attempt {
  n: number
  window_start: number
  locked_until: number
}

function bump(db: ReturnType<typeof migratedDb>, ip: string, now: number): Attempt {
  return db.prepare(BUMP_ATTEMPT_SQL).get(ip, now, now, WINDOW_MS, now, WINDOW_MS, now) as unknown as Attempt
}

test('loginThrottleKey: IPv4 verbatim, IPv6 truncated to its /64 (shares rateLimitKey)', () => {
  assert.equal(loginThrottleKey('203.0.113.9'), '203.0.113.9')
  assert.equal(loginThrottleKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::')
  assert.equal(loginThrottleKey('2001:db8::1'), '2001:db8:0:0::')
  assert.equal(loginThrottleKey('fe80::1%eth0'), 'fe80:0:0:0::')
  // Two hosts on one /64 share the budget; a different /64 does not.
  assert.equal(loginThrottleKey('2001:db8:1:2:aaaa::9'), loginThrottleKey('2001:db8:1:2:bbbb::9'))
  assert.notEqual(loginThrottleKey('2001:db8:1:2::1'), loginThrottleKey('2001:db8:1:3::1'))
})

test('lockMinutes: nothing before the 10th failure, then 2^(n-10) capped at 60', () => {
  assert.equal(lockMinutes(0), 0)
  assert.equal(lockMinutes(9), 0)
  assert.equal(lockMinutes(10), 1)
  assert.equal(lockMinutes(11), 2)
  assert.equal(lockMinutes(15), 32)
  assert.equal(lockMinutes(16), 60)
  assert.equal(lockMinutes(99), 60)
})

test('the bump is atomic: 50 executions of one wave produce n = 50', () => {
  const db = migratedDb()
  const now = 1_800_000_000_000
  const seen: number[] = []
  // Every execution reads the SAME `now` — the old JS read-modify-write would
  // have produced 1 fifty times over.
  for (let i = 0; i < 50; i++) seen.push(Number(bump(db, '203.0.113.9', now).n))
  assert.deepEqual(seen, Array.from({ length: 50 }, (_, i) => i + 1))
  const row = db.prepare('SELECT n, window_start, locked_until FROM login_attempts WHERE ip = ?').get('203.0.113.9') as unknown as Attempt
  assert.equal(Number(row.n), 50)
  assert.equal(Number(row.window_start), now) // the window never moved
  assert.equal(Number(row.locked_until), 0) // only a FAILED attempt writes the lock
  db.close()
})

test('the counter restarts once the 15-minute window has passed, not before', () => {
  const db = migratedDb()
  const t0 = 1_800_000_000_000
  assert.equal(Number(bump(db, 'ip', t0).n), 1)
  assert.equal(Number(bump(db, 'ip', t0 + WINDOW_MS - 1).n), 2) // inside the window
  const rolled = bump(db, 'ip', t0 + WINDOW_MS) // exactly at the edge → new window
  assert.equal(Number(rolled.n), 1)
  assert.equal(Number(rolled.window_start), t0 + WINDOW_MS)
  assert.equal(Number(bump(db, 'ip', t0 + WINDOW_MS + 5).n), 2)
  db.close()
})

test('keys are independent, and the returned row is the stored row', () => {
  const db = migratedDb()
  const now = 1_800_000_000_000
  for (let i = 0; i < 3; i++) bump(db, 'a', now)
  bump(db, 'b', now)
  const rows = db.prepare('SELECT ip, n FROM login_attempts ORDER BY ip').all() as unknown as { ip: string; n: number }[]
  assert.deepEqual(rows.map((r) => [r.ip, Number(r.n)]), [['a', 3], ['b', 1]])
  db.close()
})

test('a lock written on failure survives later bumps and is cleared by success', () => {
  const db = migratedDb()
  const now = 1_800_000_000_000
  let last = bump(db, 'ip', now)
  for (let i = 1; i < 10; i++) last = bump(db, 'ip', now + i)
  assert.equal(Number(last.n), 10)
  const lockedUntil = now + lockMinutes(Number(last.n)) * 60_000
  db.prepare('UPDATE login_attempts SET locked_until = ? WHERE ip = ?').run(lockedUntil, 'ip')

  // The next attempt reads the lock the LAST failure wrote — hammering while
  // locked does not push the release further out.
  const during = bump(db, 'ip', now + 100)
  assert.equal(Number(during.locked_until), lockedUntil)
  assert.equal(Number(during.n), 11)

  db.prepare('DELETE FROM login_attempts WHERE ip = ?').run('ip')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get()?.n, 0)
  db.close()
})
