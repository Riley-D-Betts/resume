// Pins the behaviour of the tracker's queue and session rotation (core.ts),
// which is not expressible as a pure function: who ships which events under
// which sid when the `rb_sid` cookie changes (M1), that a navigation flush
// never rotates (M1), what spends the per-session row budget (H3), that the
// budget is not inherited from the previous session (H4) and which failed
// flushes are retried (C1).
//
// core.ts only touches the browser through a handful of globals, so the file
// stubs those (storage, cookie, fetch, the perf observers) and drives the real
// module — imported through clientResolve.mjs, which maps Nuxt's `#shared`
// alias. Every test file runs in its own process under `node --test`, so these
// globals never leak into another suite.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./clientResolve.mjs', import.meta.url)

// --- browser stubs ---------------------------------------------------------

const SID_A = '11111111-1111-4111-8111-111111111111'
const SID_B = '22222222-2222-4222-8222-222222222222'

const store = new Map<string, string>()
const g = globalThis as unknown as Record<string, unknown>

let cookie = ''
/** Envelopes the stub `fetch` received, oldest first. */
const sent: Array<{ sid: string; types: string[]; keepalive: boolean }> = []
/** Status the next POST answers with; 204 = accepted. */
let nextStatus = 204

const storage = (prefix: string): unknown => ({
  getItem: (k: string) => store.get(prefix + k) ?? null,
  setItem: (k: string, v: string) => store.set(prefix + k, v),
  removeItem: (k: string) => store.delete(prefix + k),
})

g.localStorage = storage('l:')
g.sessionStorage = storage('s:')
g.location = { pathname: '/record/netsuite', protocol: 'https:' }
g.document = {
  get cookie() {
    return cookie
  },
  set cookie(v: string) {
    const [name, value] = v.split(';')[0]!.split('=')
    const rest = cookie
      .split('; ')
      .filter((c) => c.length > 0 && !c.startsWith(`${name}=`))
      .join('; ')
    cookie = (rest ? `${rest}; ` : '') + `${name}=${value}`
  },
}
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true })
g.PerformanceObserver = class {
  static supportedEntryTypes: string[] = []
  observe(): void {}
}
g.performance = { setResourceTimingBufferSize: () => {}, now: () => 0 }
g.fetch = (_url: string, init: { body: string; keepalive: boolean }) => {
  const env = JSON.parse(init.body) as { sid: string; events: Array<{ type: string }> }
  sent.push({ sid: env.sid, types: env.events.map((e) => e.type), keepalive: init.keepalive === true })
  return Promise.resolve({ ok: nextStatus < 300, status: nextStatus })
}
// core.ts keeps a 5 s flush interval alive for the life of the page; unref it
// so the test process can still exit.
const realSetInterval = globalThis.setInterval
g.setInterval = (fn: () => void, ms: number) => {
  const t = realSetInterval(fn, ms)
  ;(t as unknown as { unref?: () => void }).unref?.()
  return t
}

const { createCore } = await import('../../app/utils/analytics/core.ts')

/** Fresh page: cookie `rb_sid=<sid>`, empty outbox, everything accepted. */
function freshCore(sid = SID_A) {
  cookie = `rb_sid=${sid}`
  sent.length = 0
  nextStatus = 204
  return createCore()
}

/** Let the fetch promise callbacks (requeue / ack) run. */
const settled = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

// ---------------------------------------------------------------------------
// M1 — the closing session ships its own events under its own sid
// ---------------------------------------------------------------------------

test('a rotation closes the old session first, then opens the new one', async () => {
  const core = freshCore()
  store.clear()
  const order: string[] = []
  core.onBeforeRotate(() => {
    order.push(`before:${core.sid}`)
    core.track('page_leave', null, { pvid: 'v1' } as never)
  })
  core.onRotate(() => {
    order.push(`after:${core.sid}`)
    core.track('pageview', null, { pvid: 'v2' } as never)
  })

  core.track('click', null, { sel: 'a' } as never)
  // A second tab (or a 30-minute gap) put a different sid in the cookie.
  document.cookie = `rb_sid=${SID_B}`
  core.flush('timer')

  assert.equal(core.sid, SID_B)
  assert.deepEqual(order, [`before:${SID_A}`, `after:${SID_B}`])
  // The click and the visit's page_leave belong to the session that produced
  // them and go out under its sid, with a plain fetch.
  assert.deepEqual(sent[0], { sid: SID_A, types: ['click', 'page_leave'], keepalive: false })
  // Only the new visit's pageview goes out under the new sid.
  assert.deepEqual(sent[1]?.sid, SID_B)
  assert.deepEqual(sent[1]?.types, ['pageview'])
})

test('a lifecycle flush never rotates: its events belong to the old session', () => {
  const core = freshCore()
  let rotations = 0
  core.onRotate(() => rotations++)
  core.track('click', null, { sel: 'a' } as never)
  document.cookie = `rb_sid=${SID_B}`
  core.flush('beacon')
  assert.equal(rotations, 0)
  assert.equal(core.sid, SID_A)
  assert.equal(sent.at(-1)?.sid, SID_A)
})

test('the navigation flush defers the rotation to the settled path', () => {
  const core = freshCore()
  let rotations = 0
  core.onRotate(() => rotations++)
  core.track('click', null, { sel: 'a' } as never)
  document.cookie = `rb_sid=${SID_B}`
  // router.afterEach: flushing the leaving page must not open a second visit.
  core.flush('timer', { rotate: false })
  assert.equal(rotations, 0)
  assert.equal(core.sid, SID_A)
  assert.equal(sent.at(-1)?.sid, SID_A)
  // finishNav applies it once the new page has settled.
  assert.equal(core.ensureSid(), true)
  assert.equal(rotations, 1)
  assert.equal(core.sid, SID_B)
})

// ---------------------------------------------------------------------------
// H3 / H4 — the per-session row budget
// ---------------------------------------------------------------------------

test('heartbeats never spend the session row budget', () => {
  store.clear()
  const core = freshCore()
  // Two hours of heartbeats — 480, above the 400-row cap.
  for (let i = 0; i < 480; i++) {
    core.track('heartbeat', null, { pvid: 'v1', activeMs: 1000, maxScrollPct: 10 } as never)
  }
  core.flush('timer')
  assert.equal(store.get('s:rb_ev_n'), `${SID_A}:0`)
  // A non-essential type still gets through afterwards.
  core.track('copy', null, { len: 20, snippet: 'x', hasEmail: false, sel: 'p' } as never)
  core.flush('timer')
  assert.ok(sent.at(-1)?.types.includes('copy'))
})

test('a new session does not inherit the previous session’s spent budget', () => {
  store.clear()
  // The previous session left a capped counter behind.
  store.set('s:rb_ev_n', `${SID_B}:400`)
  const core = freshCore(SID_A)
  core.track('copy', null, { len: 20, snippet: 'x', hasEmail: false, sel: 'p' } as never)
  core.flush('timer')
  assert.ok(sent.at(-1)?.types.includes('copy'), 'the new session started already capped')
  assert.equal(store.get('s:rb_ev_n'), `${SID_A}:1`)
})

test('a session that spent its budget sends essentials only', () => {
  store.clear()
  const core = freshCore()
  store.set('s:rb_ev_n', `${SID_A}:0`)
  for (let i = 0; i < 400; i++) core.track('copy', null, { len: 1, snippet: 'x', hasEmail: false, sel: 'p' } as never)
  core.flush('timer')
  sent.length = 0
  core.track('copy', null, { len: 1, snippet: 'x', hasEmail: false, sel: 'p' } as never)
  core.track('pageview', null, { pvid: 'v9', path: '/', from: null, kind: 'spa' } as never)
  core.flush('timer')
  assert.deepEqual(sent.at(-1)?.types, ['pageview'])
})

// ---------------------------------------------------------------------------
// C1 — which rejected flushes come back
// ---------------------------------------------------------------------------

test('a 429 and a 5xx are re-queued once; a 400 is not', async () => {
  for (const status of [429, 503]) {
    const core = freshCore()
    nextStatus = status
    core.track('click', null, { sel: 'a' } as never)
    core.flush('timer')
    await settled()
    nextStatus = 204
    core.flush('timer')
    await settled()
    assert.equal(sent.length, 2, `status ${status} should be retried once`)
    assert.deepEqual(sent[1]?.types, ['click'])
    // ...but only once: the same batch is never re-queued twice.
    nextStatus = 500
    core.flush('timer')
    await settled()
    nextStatus = 204
    core.flush('timer')
    await settled()
    assert.equal(sent.length, 2, `status ${status}: a batch is re-queued at most once`)
  }

  const core = freshCore()
  nextStatus = 400
  core.track('click', null, { sel: 'a' } as never)
  core.flush('timer')
  await settled()
  nextStatus = 204
  core.flush('timer')
  await settled()
  assert.equal(sent.length, 1, 'a 400 is a verdict on the batch — never retried')
})
