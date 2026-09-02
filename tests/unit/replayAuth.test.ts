// Pins the /api/replay guards: the upload token (audit S2) and the ledger's
// confirmed-chunk rule (audit R2-L6).
//
// The token is derived from a configured secret, and in production — where `import.meta.dev` is false, as it is under
// node --test — a deployment with no NUXT_SESSION_PASSWORD / NUXT_ADMIN_PASSWORD
// can neither MINT nor VERIFY one. /api/replay then answers 401 instead of
// accepting uploads signed with the literal 'dev'.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

interface Cfg { sessionPassword?: string, adminPassword?: string }
interface StubCookie { name: string, value: string }

const cfg: Cfg = {}
const cookies: StubCookie[] = []
const g = globalThis as unknown as Record<string, unknown>
g.useRuntimeConfig = (): Cfg => cfg
g.setCookie = (_event: unknown, name: string, value: string): void => { cookies.push({ name, value }) }
g.getRequestURL = (): URL => new URL('https://resume.test/api/collect')
g.getRequestProtocol = (): string => 'https'

const { REPLAY_TOKEN_COOKIE, replayAuthAvailable, replayToken, replayTokenMatches, setReplayTokenCookie }
  = await import('../../server/utils/replayAuth.ts')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EVENT = {} as any
const SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function reset(next: Cfg): void {
  delete cfg.sessionPassword
  delete cfg.adminPassword
  Object.assign(cfg, next)
  cookies.length = 0
}

test('with a session password the token is the documented sha256 and only matches its own sid', () => {
  reset({ sessionPassword: 'a-very-long-session-password-0123456789' })
  const token = replayToken(EVENT, SID)
  assert.equal(token, createHash('sha256').update(`rb-replay:a-very-long-session-password-0123456789:${SID}`).digest('hex'))
  assert.equal(replayAuthAvailable(EVENT), true)
  assert.equal(replayTokenMatches(EVENT, SID, token), true)
  assert.equal(replayTokenMatches(EVENT, OTHER, token), false, 'a token for one sid does not open another')
  assert.equal(replayTokenMatches(EVENT, SID, 'f'.repeat(64)), false)
  assert.equal(replayTokenMatches(EVENT, SID, 'not-hex'), false)
  assert.equal(replayTokenMatches(EVENT, SID, null), false)
  assert.equal(replayTokenMatches(EVENT, SID, undefined), false)

  assert.equal(setReplayTokenCookie(EVENT, SID), true)
  assert.deepEqual(cookies, [{ name: REPLAY_TOKEN_COOKIE, value: token }])
})

test('the admin password is the fallback key, and rotating it invalidates old tokens', () => {
  reset({ adminPassword: 'hunter2-but-secret' })
  const viaAdmin = replayToken(EVENT, SID)
  assert.ok(viaAdmin && /^[0-9a-f]{64}$/.test(viaAdmin))

  reset({ sessionPassword: 'session-password-wins-over-admin-000000', adminPassword: 'hunter2-but-secret' })
  const viaSession = replayToken(EVENT, SID)
  assert.notEqual(viaSession, viaAdmin, 'the session password takes precedence')
  assert.equal(replayTokenMatches(EVENT, SID, viaAdmin), false, 'a token minted under the old key stops verifying')
})

test('production with NO secret configured mints nothing and verifies nothing (S2 fail-closed)', () => {
  reset({})
  assert.equal(replayAuthAvailable(EVENT), false)
  assert.equal(replayToken(EVENT, SID), null, 'no key → no token')
  assert.equal(setReplayTokenCookie(EVENT, SID), false)
  assert.deepEqual(cookies, [], 'no Set-Cookie at all')

  // The old behaviour: sha256("rb-replay:dev:<sid>") was accepted by anyone who
  // could guess the literal. It must now be refused like any other string.
  const guessable = createHash('sha256').update(`rb-replay:dev:${SID}`).digest('hex')
  assert.equal(replayTokenMatches(EVENT, SID, guessable), false, 'the guessable dev token is refused in production')
  assert.equal(replayTokenMatches(EVENT, SID, 'a'.repeat(64)), false)
})

test('an empty-string password counts as unset', () => {
  reset({ sessionPassword: '', adminPassword: '' })
  assert.equal(replayAuthAvailable(EVENT), false)
  assert.equal(replayToken(EVENT, SID), null)
})

// ---------------------------------------------------------------------------
// The ledger statement /api/replay runs (audit R2-L6): a re-upload of an
// already CONFIRMED (sid, rid, seq) must not re-open the row — the handler
// answers 204 and leaves both the row and the R2 object alone, so a retry
// whose put fails cannot delete a good chunk.
// ---------------------------------------------------------------------------

const { migratedDb, seedSession } = await import('./_memdb.ts')

const LEDGER_SQL = `INSERT OR REPLACE INTO replay_chunks_v2 (sid, rid, seq, bytes, compressed, pending, created_at, page_started_at)
           SELECT ?, ?, ?, ?, ?, 1, ?, ?
           WHERE EXISTS (SELECT 1 FROM sessions WHERE sid = ? AND is_bot = 0)
             AND NOT EXISTS (SELECT 1 FROM replay_chunks_v2 WHERE sid = ? AND rid = ? AND seq = ? AND pending = 0)
             AND (SELECT COALESCE(SUM(bytes), 0) FROM replay_chunks_v2 WHERE sid = ? AND NOT (rid = ? AND seq = ?)) + ? <= ?`
const MAX_SESSION_BYTES = 15 * 1024 * 1024
const RID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

test('the ledger refuses to re-open a confirmed chunk, but a pending one is retryable (R2-L6)', () => {
  const db = migratedDb()
  seedSession(db, SID)
  const ledger = (seq: number, bytes: number, gz: 0 | 1, now: number): number =>
    db.prepare(LEDGER_SQL).run(SID, RID, seq, bytes, gz, now, now, SID, SID, RID, seq, SID, RID, seq, bytes, MAX_SESSION_BYTES).changes
  const rowOf = (seq: number): { bytes: number, compressed: number, pending: number } | undefined => {
    const r = db.prepare('SELECT bytes, compressed, pending FROM replay_chunks_v2 WHERE sid = ? AND rid = ? AND seq = ?').get(SID, RID, seq) as
      { bytes: number, compressed: number, pending: number } | undefined
    return r === undefined ? undefined : { bytes: r.bytes, compressed: r.compressed, pending: r.pending } // node:sqlite rows are null-prototype
  }

  // First upload: pending row, then the handler flips it after bucket.put.
  assert.equal(ledger(0, 1000, 1, 1), 1)
  assert.deepEqual(rowOf(0), { bytes: 1000, compressed: 1, pending: 1 })
  db.prepare('UPDATE replay_chunks_v2 SET pending = 0 WHERE sid = ? AND rid = ? AND seq = ?').run(SID, RID, 0)

  // The client never saw the 204 and retries — possibly gzip-flipped and a
  // different size. The insert is skipped and the stored row is untouched.
  assert.equal(ledger(0, 4242, 0, 2), 0, 'a confirmed chunk is not re-inserted')
  assert.deepEqual(rowOf(0), { bytes: 1000, compressed: 1, pending: 0 }, 'row untouched → the object stays valid')

  // A PENDING row (a put that never completed) is still replaceable.
  assert.equal(ledger(1, 2000, 1, 3), 1)
  assert.equal(rowOf(1)!.pending, 1)
  assert.equal(ledger(1, 2500, 0, 4), 1, 'a pending chunk can be retried')
  assert.deepEqual(rowOf(1), { bytes: 2500, compressed: 0, pending: 1 })

  // The per-session cap still applies, and an unknown sid still writes nothing.
  assert.equal(ledger(2, MAX_SESSION_BYTES, 1, 5), 0, 'over the 15 MB cap')
  assert.equal(rowOf(2), undefined)
  const stranger = '77777777-7777-4777-8777-777777777777'
  assert.equal(
    db.prepare(LEDGER_SQL).run(stranger, RID, 0, 10, 1, 6, 6, stranger, stranger, RID, 0, stranger, RID, 0, 10, MAX_SESSION_BYTES).changes,
    0,
    'no sessions row → no ledger row',
  )
  db.close()
})
