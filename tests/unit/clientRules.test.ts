// Pins the pure decision rules of the browser tracker (app/utils/analytics/*):
// which event types spend the session row budget (H3), how the per-session
// counter in sessionStorage is parsed (H4), what a click's `href` may be (H2)
// and when a resize is a real viewport change (M5). The modules are imported
// through clientResolve.mjs, which maps Nuxt's `#shared` / `~` aliases, so
// these are the shipped functions, not a copy of them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'

register('./clientResolve.mjs', import.meta.url)

const { MERGED_TYPES, isRowType, parseEvCount } = await import('../../app/utils/analytics/core.ts')
const { clickHref, viewportChanged } = await import('../../app/utils/analytics/interactions.ts')
const { EVENT_TYPES, ESSENTIAL_TYPES, SESSION_EVENT_CAP } = await import('../../shared/analytics/events.ts')

// ---------------------------------------------------------------------------
// H3 — the session event cap counts only the types the ingest stores as rows
// ---------------------------------------------------------------------------

test('MERGED_TYPES are exactly the types the ingest never stores as rows', () => {
  const src = readFileSync(fileURLToPath(new URL('../../server/utils/sanitize.ts', import.meta.url)), 'utf8')
  // Each `case '<type>': {` block that sets `store = false` is merged into a
  // typed table (page_visits / session_env / page_perf) instead of `events`.
  const merged = new Set<string>()
  const blocks = src.split(/\n\s{4}case '/).slice(1)
  for (const block of blocks) {
    const type = block.slice(0, block.indexOf("'"))
    if (/\n\s+store = false\b/.test(block)) merged.add(type)
  }
  assert.ok(merged.size > 0, 'no `store = false` cases found — did sanitize.ts move?')
  assert.deepEqual([...merged].sort(), [...MERGED_TYPES].sort())
})

test('isRowType: merged types cost nothing, every other event type costs a row', () => {
  for (const t of MERGED_TYPES) assert.equal(isRowType(t), false, t)
  const merged = new Set<string>(MERGED_TYPES)
  for (const t of EVENT_TYPES) assert.equal(isRowType(t), !merged.has(t), t)
  assert.equal(isRowType('not_an_event'), false)
  assert.equal(isRowType(''), false)
})

test('a 30-minute read no longer spends the budget on heartbeats', () => {
  // 15 s heartbeats for 30 min = 120 events under the old rule.
  const heartbeats = (30 * 60_000) / 15_000
  let spent = 0
  for (let i = 0; i < heartbeats; i++) if (isRowType('heartbeat')) spent++
  assert.equal(spent, 0)
  assert.ok(heartbeats < SESSION_EVENT_CAP)
  // heartbeat stays essential so it is never dropped once the cap is reached.
  assert.ok((ESSENTIAL_TYPES as readonly string[]).includes('heartbeat'))
})

// ---------------------------------------------------------------------------
// H4 — `rb_ev_n` is `<sid>:<n>`; another sid's count is never inherited
// ---------------------------------------------------------------------------

const SID = '0f9d3c2e-1b7a-4d5e-8c11-2a3b4c5d6e7f'
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

test('parseEvCount reads only a count stored under this sid', () => {
  assert.equal(parseEvCount(`${SID}:37`, SID), 37)
  assert.equal(parseEvCount(`${SID}:0`, SID), 0)
  assert.equal(parseEvCount(`${OTHER}:399`, SID), 0, 'the previous session must not cap the new one')
  assert.equal(parseEvCount(null, SID), 0)
})

test('parseEvCount rejects the legacy bare number and any malformed value', () => {
  assert.equal(parseEvCount('400', SID), 0, 'the pre-fix format must not carry over')
  assert.equal(parseEvCount('', SID), 0)
  assert.equal(parseEvCount(':12', SID), 0)
  assert.equal(parseEvCount(`${SID}:`, SID), 0)
  assert.equal(parseEvCount(`${SID}:abc`, SID), 0)
  assert.equal(parseEvCount(`${SID}:-9`, SID), 0)
  assert.equal(parseEvCount(`${SID}:12.7`, SID), 12)
  assert.equal(parseEvCount(`${SID}:37`, ''), 0)
})

// ---------------------------------------------------------------------------
// H2 — click.href is a same-origin pathname (all the ingest whitelist accepts)
// ---------------------------------------------------------------------------

/** server/utils/sanitize.ts PATH_RE — what `asPath` lets through. */
const PATH_RE = /^\/[^?#\s]*$/
const BASE = 'https://rileybetts.com/record/netsuite'

test('clickHref keeps the pathname of a same-origin link', () => {
  assert.equal(clickHref('https://rileybetts.com/contact', BASE), '/contact')
  assert.equal(clickHref('/record/erp?tab=2#top', BASE), '/record/erp')
  assert.equal(clickHref('erp', BASE), '/record/erp')
  assert.equal(clickHref('https://rileybetts.com/', BASE), '/')
  for (const href of ['https://rileybetts.com/contact', '/record/erp?tab=2#top', 'erp']) {
    assert.match(clickHref(href, BASE)!, PATH_RE, href)
  }
})

test('clickHref drops what the outbound event already carries', () => {
  assert.equal(clickHref('https://github.com/riley', BASE), null)
  assert.equal(clickHref('http://rileybetts.com/contact', BASE), null, 'other scheme = other origin')
  assert.equal(clickHref('mailto:riley@example.com?subject=Hi', BASE), null)
  assert.equal(clickHref('tel:+15550100', BASE), null)
  assert.equal(clickHref('javascript:void(0)', BASE), null)
  assert.equal(clickHref('', BASE), '/record/netsuite')
  assert.equal(clickHref('not a url', 'not a base'), null)
})

test('clickHref clamps to the 200-char column', () => {
  const long = `/${'a'.repeat(400)}`
  const out = clickHref(long, BASE)!
  assert.equal(out.length, 200)
  assert.match(out, PATH_RE)
})

// ---------------------------------------------------------------------------
// M5 — a resize is only a viewport change when it is not the URL bar
// ---------------------------------------------------------------------------

test('viewportChanged suppresses the mobile URL bar and the keyboard', () => {
  // iPhone-ish: 844 → 780 when the URL bar collapses (~7.6 %).
  assert.equal(viewportChanged({ w: 390, h: 844 }, { w: 390, h: 780 }), false)
  // The same shrink in the other direction (bar re-expanding).
  assert.equal(viewportChanged({ w: 390, h: 780 }, { w: 390, h: 844 }), false)
  // No change at all.
  assert.equal(viewportChanged({ w: 390, h: 844 }, { w: 390, h: 844 }), false)
})

test('viewportChanged still reports width changes, orientation and big height jumps', () => {
  assert.equal(viewportChanged({ w: 390, h: 844 }, { w: 391, h: 844 }), true)
  // Portrait → landscape.
  assert.equal(viewportChanged({ w: 390, h: 844 }, { w: 844, h: 390 }), true)
  // A keyboard that eats a third of the screen is a real viewport change.
  assert.equal(viewportChanged({ w: 390, h: 844 }, { w: 390, h: 500 }), true)
  // Exactly a quarter is reported (the rule suppresses "less than a quarter").
  assert.equal(viewportChanged({ w: 400, h: 800 }, { w: 400, h: 600 }), true)
  assert.equal(viewportChanged({ w: 400, h: 800 }, { w: 400, h: 601 }), false)
  // A degenerate previous height must not divide by zero into silence.
  assert.equal(viewportChanged({ w: 400, h: 0 }, { w: 400, h: 1 }), true)
})
