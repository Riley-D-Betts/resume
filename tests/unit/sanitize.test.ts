// Pins the /api/collect whitelist fixes from the R2 ingest review:
//   M1 page_perf is seeded from the pageview (document path / ts, not the page
//      that happened to be current when a vital fired)
//   M3 entry_path / nav_kind only from an initial-load pageview
//   L1 page_leave.enteredAt can never exceed the leave timestamp
//   L2 a dropped event no longer rewrites last_path
//   L3 `//host` and `.` / `..` segments are not paths
//   L4 out-of-range tz offset / soft-nav / scroll percentage → null, not the edge
//   L10 ms-browser-extension:// scrubbed
//   contract clamps: site_search.chosen 40, env.uadHi 40 / 80 / 40
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { asIntIn, asPath, parseEnvelope, scrubExt } from '../../server/utils/sanitize.ts'

const T = 1_800_000_000_000
const VID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PV1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PV2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

type Ev = Record<string, unknown>
const envelope = (events: Ev[], v: 1 | 2 = 2, url = '/'): Record<string, unknown> => ({ v, vid: VID, sid: SID, returning: false, url, events })
const parse = (events: Ev[], v: 1 | 2 = 2, now = T + 1000, url = '/') => {
  const p = parseEnvelope(envelope(events, v, url), now)
  assert.ok(p, 'envelope must parse')
  return p
}

const pageview = (pvid: string, path: string, extra: Record<string, unknown> = {}, dt = 0, u = path): Ev => ({
  t: T + dt, type: 'pageview', name: null, u, p: { pvid, path, kind: 'initial', ...extra },
})

// ---------------------------------------------------------------------------
// L3 — path shapes
// ---------------------------------------------------------------------------

test('asPath rejects protocol-relative paths and dot segments (R2-L3)', () => {
  for (const bad of ['//evil.com/x', '//', '/a/../b', '/../etc', '/..', '/.', '/a/./b', '/./a', '/a/..', '/a/.']) {
    assert.equal(asPath(bad), null, bad)
  }
  for (const ok of ['/', '/employee', '/a/..b', '/..b/c', '/.well-known/x', '/a.b/c', '/%2e%2e/x']) {
    assert.equal(asPath(ok), ok, ok)
  }
  assert.equal(asPath('/ok?x'), null, 'query strings were never paths')
  assert.equal(asPath('/a b'), null)
  assert.equal(asPath('x/y'), null)
  assert.equal(asPath('/' + 'a'.repeat(300)), null, 'over the length cap')
})

test('a traversal `u` falls back to the envelope url instead of being stored (R2-L3)', () => {
  const p = parse([{ t: T, type: 'find', name: null, u: '/x/../y', p: {} }])
  assert.equal(p.events[0]!.path, '/', 'fell back to the envelope path')
  assert.equal(p.lastPath, '/')
})

// ---------------------------------------------------------------------------
// L10 — extension scrubbing
// ---------------------------------------------------------------------------

test('scrubExt covers every extension scheme, ms-browser included (R2-L10)', () => {
  const s = scrubExt(
    'chrome-extension://abcdefghijklmnop/a.js moz-extension://8f1a2b3c-4d5e/x safari-web-extension://ABCDEF12-3456/y ms-browser-extension://zzzz/x',
  )!
  assert.equal(s.match(/<ext>/g)?.length, 4, s)
  for (const leak of ['abcdefghijklmnop', '8f1a2b3c', 'ABCDEF12', 'zzzz']) assert.ok(!s.includes(leak), leak)
  assert.equal(scrubExt(null), null)
})

test('js_error payloads scrub ms-browser-extension URLs (R2-L10)', () => {
  const p = parse([{ t: T, type: 'js_error', name: null, u: '/', p: { msg: 'boom at ms-browser-extension://deadbeef/x.js', src: 'ms-browser-extension://deadbeef/x.js' } }])
  const payload = p.events.find((e) => e.type === 'js_error')!.payload!
  assert.ok(payload.includes('<ext>') && !payload.includes('deadbeef'), payload)
})

// ---------------------------------------------------------------------------
// L4 — out of range is null, not the nearest edge
// ---------------------------------------------------------------------------

test('asIntIn returns null outside the range instead of clamping (R2-L4)', () => {
  assert.equal(asIntIn(500, -900, 900), 500)
  assert.equal(asIntIn(-900, -900, 900), -900)
  assert.equal(asIntIn(900, -900, 900), 900)
  assert.equal(asIntIn(901, -900, 900), null)
  assert.equal(asIntIn(-5000, -900, 900), null)
  assert.equal(asIntIn(Number.NaN, 0, 10), null)
  assert.equal(asIntIn('7', 0, 10), null, 'still strictly numeric')
  assert.equal(asIntIn(2.4, 0, 10), 2, 'rounds inside the range')
})

test('bogus tz offset / soft nav / scroll percentage become null (R2-L4)', () => {
  const p = parse([
    pageview(PV1, '/', { tzOffsetMin: 5000, softNavMs: -50, kind: 'spa', from: null }),
    { t: T + 10, type: 'heartbeat', name: null, u: '/', p: { pvid: PV1, activeMs: 1000, maxScrollPct: 500 } },
    { t: T + 20, type: 'visibility', name: null, u: '/', p: { state: 'hidden', ms: 10, pvid: PV1, activeMs: 1000, maxScrollPct: 900 } },
  ])
  assert.equal(p.pv!.tzOffsetMin, null, 'a 5000-minute offset is junk, not +900')
  assert.equal(p.clientTzOffsetMin, null)
  assert.equal(p.pageVisits.get(PV1)!.softNavMs, null, 'negative soft-nav is junk, not 0')
  assert.equal(p.pagePerf.get(PV1)!.softNavMs, null)
  assert.equal(p.pageVisits.get(PV1)!.maxScrollPct, 0, 'a 500 % scroll never becomes 100')
  assert.equal(p.maxScroll, 0)

  const leave = parse([
    { t: T + 100, type: 'page_leave', name: null, u: '/', p: { pvid: PV1, path: '/', enteredAt: T, maxScrollPct: 500, activeMs: 10 } },
  ])
  assert.equal(leave.pageVisits.get(PV1)!.maxScrollPct, 0)
  assert.equal(leave.maxScroll, 0)

  const good = parse([pageview(PV1, '/', { tzOffsetMin: -360, softNavMs: 80, kind: 'spa', from: null })])
  assert.equal(good.clientTzOffsetMin, -360)
  assert.equal(good.pageVisits.get(PV1)!.softNavMs, 80)

  const envRow = parse([{ t: T, type: 'env', name: null, u: '/', p: { webdriver: false, tz: { name: 'America/Boise', offsetMin: 4000 } } }])
  assert.equal(envRow.env!.tz_offset_min, null, 'env tz offset out of range → null')
})

// ---------------------------------------------------------------------------
// L1 — entered_at never after left_at
// ---------------------------------------------------------------------------

test('page_leave.enteredAt is capped at the leave timestamp (R2-L1)', () => {
  const p = parse([
    { t: T, type: 'page_leave', name: null, u: '/', p: { pvid: PV1, path: '/', enteredAt: T + 99_999_999, activeMs: 10, reason: 'unload' } },
  ])
  const m = p.pageVisits.get(PV1)!
  assert.equal(m.enteredAt, T, 'entered_at pulled back to the leave time')
  assert.equal(m.leftAt, T)
  assert.ok(m.leftAt! - m.enteredAt >= 0, 'dwell can never be negative')
  assert.equal(JSON.parse(p.events[0]!.payload!).enteredAt, T, 'the stored payload agrees')

  // A sane enteredAt is kept as reported.
  const ok = parse([
    { t: T + 5000, type: 'page_leave', name: null, u: '/', p: { pvid: PV1, path: '/', enteredAt: T, activeMs: 5000, reason: 'spa' } },
  ])
  assert.equal(ok.pageVisits.get(PV1)!.enteredAt, T)
})

// ---------------------------------------------------------------------------
// L2 — a dropped event must not move last_path
// ---------------------------------------------------------------------------

test('last_path only follows events the whitelist accepted (R2-L2)', () => {
  const p = parse([
    pageview(PV1, '/', {}, 0),
    { t: T + 10, type: 'section_enter', name: 'not a valid section name!', u: '/ghost', p: {} },
    { t: T + 20, type: 'hover', name: 'evil key', u: '/ghost2', p: { ms: 900 } },
    { t: T + 30, type: 'bogus_type', name: null, u: '/ghost3', p: {} },
    { t: T + 40, type: 'scroll_depth', name: null, u: '/ghost4', p: { pct: 33 } },
  ])
  assert.equal(p.lastPath, '/', 'dropped events left last_path alone')
  assert.equal(p.events.length, 1)

  // A MERGED (never stored) event still moves it — heartbeats are accepted.
  const merged = parse([
    pageview(PV1, '/', {}, 0),
    { t: T + 50, type: 'heartbeat', name: null, u: '/employee', p: { pvid: PV2, activeMs: 15_000 } },
  ])
  assert.equal(merged.lastPath, '/employee')
})

// ---------------------------------------------------------------------------
// M1 — page_perf describes the document, not the page current at emission
// ---------------------------------------------------------------------------

test('page_perf is seeded from the pageview, so path / ts are the document that loaded (R2-M1)', () => {
  // The visitor lands on /, navigates to /employee 2 s later, and the vitals +
  // perf for the FIRST document fire afterwards while /employee is current.
  const p = parse([
    pageview(PV1, '/', {}, 0),
    { t: T + 2000, type: 'pageview', name: null, u: '/employee', p: { pvid: PV2, path: '/employee', from: '/', kind: 'spa', softNavMs: 80 } },
    { t: T + 4000, type: 'vitals', name: null, u: '/employee', p: { pvid: PV1, ttfb: 100, fcp: 300, lcp: 600, cls: 0.02 } },
    { t: T + 4001, type: 'perf', name: null, u: '/employee', p: { pvid: PV1, nav: { dns: 1, connect: 2, load: 800, type: 'navigate' }, resources: { count: 3 }, longTasks: { count: 0 } } },
  ], 2, T + 5000)

  const doc = p.pagePerf.get(PV1)!
  assert.equal(doc.path, '/', 'the landing page owns its own LCP')
  assert.equal(doc.ts, T, 'and its own timestamp')
  assert.equal(doc.lcp, 600)
  assert.equal(doc.load, 800)

  const spa = p.pagePerf.get(PV2)!
  assert.equal(spa.path, '/employee')
  assert.equal(spa.ts, T + 2000)
  assert.equal(spa.lcp, null, 'the SPA visit did not steal the document vitals')
  assert.equal(spa.softNavMs, 80)

  // Every pageview seeds a row, even without a single metric.
  const bare = parse([pageview(PV1, '/positions', {}, 0)])
  const row = bare.pagePerf.get(PV1)!
  assert.deepEqual([row.path, row.ts, row.lcp, row.softNavMs], ['/positions', T, null, null])
})

test('vitals for an unknown pvid still land, keyed by their own event (R2-M1 regression guard)', () => {
  const p = parse([{ t: T + 10, type: 'vitals', name: null, u: '/employee', p: { pvid: PV2, lcp: 900 } }])
  const row = p.pagePerf.get(PV2)!
  assert.deepEqual([row.path, row.ts, row.lcp], ['/employee', T + 10, 900])
})

// ---------------------------------------------------------------------------
// M3 — entry_path / nav_kind come from the initial document
// ---------------------------------------------------------------------------

test('entry_path / nav_kind only come from an INITIAL_KINDS pageview (R2-M3)', () => {
  // The out-of-order beacon: the SPA pageview arrives in the same envelope
  // BEFORE the initial one that actually started the visit.
  const p = parse([
    { t: T + 2001, type: 'pageview', name: null, u: '/employee', p: { pvid: PV2, path: '/employee', from: '/', kind: 'spa', softNavMs: 80 } },
    pageview(PV1, '/', { referrer: 'https://www.linkedin.com/' }, 0),
  ], 2, T + 3000)
  assert.equal(p.entryPath, '/', 'the landing document wins')
  assert.equal(p.navKind, 'initial')

  // Nothing but SPA pageviews (a mid-visit beacon): no entry claim at all, so
  // the first-write column in SQL keeps whatever the landing envelope wrote.
  const spaOnly = parse([
    { t: T, type: 'pageview', name: null, u: '/employee', p: { pvid: PV2, path: '/employee', from: '/', kind: 'spa' } },
    { t: T + 10, type: 'pageview', name: null, u: '/contact', p: { pvid: PV1, path: '/contact', from: '/employee', kind: 'spa_back' } },
  ])
  assert.equal(spaOnly.entryPath, null)
  assert.equal(spaOnly.navKind, null)
  assert.equal(spaOnly.exitPath, '/contact', 'exit_path is unaffected')
  assert.equal(spaOnly.pageviews, 2)

  // Fallback 1: an SPA pageview with no `from` — the client could not tell us
  // where it came from, so treat it as the entry.
  const noFrom = parse([{ t: T, type: 'pageview', name: null, u: '/employee', p: { pvid: PV2, path: '/employee', kind: 'spa' } }])
  assert.equal(noFrom.entryPath, '/employee')
  assert.equal(noFrom.navKind, 'spa')

  // Fallback 2: a v1 envelope has no kinds at all (they default to 'initial'
  // anyway) — and an explicit v1 spa pageview still counts.
  const v1 = parse([{ t: T, type: 'pageview', name: null, p: { kind: 'spa', from: '/x' } }], 1, T + 100, '/positions')
  assert.equal(v1.entryPath, '/positions')
  assert.equal(v1.navKind, 'spa')

  // Every initial kind qualifies; the FIRST one in the envelope wins.
  for (const kind of ['initial', 'reload', 'back_forward', 'prerender', 'bfcache'] as const) {
    const one = parse([
      { t: T, type: 'pageview', name: null, u: '/x', p: { pvid: PV2, path: '/x', from: '/y', kind: 'spa' } },
      { t: T + 1, type: 'pageview', name: null, u: '/', p: { pvid: PV1, path: '/', kind } },
      { t: T + 2, type: 'pageview', name: null, u: '/z', p: { pvid: PV2, path: '/z', kind: 'initial' } },
    ])
    assert.deepEqual([one.entryPath, one.navKind], ['/', kind], kind)
  }
})

// ---------------------------------------------------------------------------
// Contract clamps
// ---------------------------------------------------------------------------

test('site_search.chosen keeps 40 characters and env.uadHi 40 / 80 / 40', () => {
  const chosen = 'Employee record with a very long label!!!!'
  const p = parse([{ t: T, type: 'site_search', name: null, u: '/', p: { q: 'NetSuite', results: 3, chosen } }])
  assert.equal(JSON.parse(p.events[0]!.payload!).chosen, chosen.slice(0, 40))

  const e = parse([{ t: T, type: 'env', name: null, u: '/', p: { webdriver: false, uadHi: {
    architecture: 'a'.repeat(60), model: 'm'.repeat(120), platformVersion: 'v'.repeat(60), bitness: '64',
  } } }])
  assert.equal((e.env!.ua_arch as string).length, 40)
  assert.equal((e.env!.ua_model as string).length, 80)
  assert.equal((e.env!.ua_platform_ver as string).length, 40)
})
