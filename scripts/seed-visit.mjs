#!/usr/bin/env node
/**
 * Seed a realistic synthetic visit through the REAL analytics pipeline of a
 * running server, then verify what landed in SQLite and on disk.
 *
 *   node scripts/seed-visit.mjs [baseUrl] [dbPath]
 *
 * Defaults: http://localhost:3000 and ./data/analytics.db (run from the
 * repo root, against `npm run dev` or a production build).
 *
 * Prints PASS/FAIL per assertion and exits 1 if any assertion failed.
 *
 * NOTE: the final step deliberately exhausts the per-IP rate limit
 * (60 collect calls/min). Re-running the script within ~60s of a previous
 * run will therefore FAIL early with 429s — wait a minute or restart the
 * server between runs.
 */

import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import Database from 'better-sqlite3'

const baseUrl = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '')
const dbPath = resolve(process.argv[3] ?? './data/analytics.db')

const CHROME_UA
  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const HEARTBEAT_MS = 15_000

let failures = 0

function check(label, ok, detail = '') {
  const suffix = detail ? `  (${detail})` : ''
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${suffix}`)
  if (!ok) failures++
}

// ---------------------------------------------------------------- helpers

async function postCollect(envelope, ua = CHROME_UA) {
  return fetch(`${baseUrl}/api/collect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': ua },
    body: JSON.stringify(envelope),
  })
}

async function postReplay(sid, seq, events) {
  const body = gzipSync(Buffer.from(JSON.stringify(events)))
  return fetch(`${baseUrl}/api/replay`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': CHROME_UA,
      'x-rb-sid': sid,
      'x-rb-seq': String(seq),
      'x-rb-gz': '1',
    },
    body,
  })
}

// ------------------------------------------------------------ visit fixture

const vid = randomUUID()
const sid = randomUUID()
const t0 = Date.now() - 95_000 // visit "started" ~95s ago

const pageviewEvent = {
  t: t0,
  type: 'pageview',
  p: {
    referrer: 'https://news.ycombinator.com/',
    utm: { source: 'hn', medium: 'social', campaign: 'launch', term: null, content: null },
    screen: { w: 2560, h: 1440, dpr: 1 },
    viewport: { w: 1440, h: 900 },
    tz: 'America/Boise',
    lang: 'en-US',
    platform: 'Win32',
    touch: false,
    deviceMemory: 16,
    cores: 12,
    connection: '4g',
  },
}

const envelopeA = {
  v: 1,
  vid,
  sid,
  returning: false,
  url: '/',
  events: [
    pageviewEvent,
    { t: t0 + 500, type: 'section_enter', name: 'sys' },
  ],
}

const envelopeB = {
  v: 1,
  vid,
  sid,
  returning: false,
  url: '/',
  events: [
    { t: t0 + 8_500, type: 'section_exit', name: 'sys', p: { dwellMs: 8_000 } },
    { t: t0 + 8_600, type: 'section_enter', name: 'profile' },
    { t: t0 + 15_000, type: 'section_exit', name: 'profile', p: { dwellMs: 6_400 } },
    { t: t0 + 15_100, type: 'section_enter', name: 'opslog' },
    { t: t0 + 22_000, type: 'section_exit', name: 'opslog', p: { dwellMs: 6_900 } },
    { t: t0 + 22_100, type: 'section_enter', name: 'fobech' },
    { t: t0 + 31_000, type: 'section_exit', name: 'fobech', p: { dwellMs: 8_900 } },
    { t: t0 + 9_000, type: 'scroll_depth', p: { pct: 25 } },
    { t: t0 + 16_000, type: 'scroll_depth', p: { pct: 50 } },
    { t: t0 + 24_000, type: 'scroll_depth', p: { pct: 75 } },
    {
      t: t0 + 26_000,
      type: 'click',
      p: { sel: 'section[data-section="fobech"] .panel a', text: 'FOBECH.COM', x: 712, y: 640, section: 'fobech' },
    },
    {
      t: t0 + 40_000,
      type: 'outbound',
      name: 'github.com',
      p: { href: 'https://github.com/rileybetts', label: 'GITHUB', section: 'comms' },
    },
    { t: t0 + 15_000, type: 'heartbeat', p: {} },
    { t: t0 + 30_000, type: 'heartbeat', p: {} },
    { t: t0 + 45_000, type: 'heartbeat', p: {} },
    { t: t0 + 60_000, type: 'heartbeat', p: {} },
    { t: t0 + 75_000, type: 'heartbeat', p: {} },
    { t: t0 + 90_000, type: 'heartbeat', p: {} },
    { t: t0 + 5_000, type: 'vitals', p: { ttfb: 120, lcp: 900, cls: 0.02, inp: 40 } },
  ],
}

const sentEventCount = envelopeA.events.length + envelopeB.events.length
const heartbeatCount = envelopeB.events.filter(e => e.type === 'heartbeat').length

// Minimal but VALID rrweb chunks: a Meta event (type 4), a FullSnapshot
// (type 2) with a tiny serialized DOM, then IncrementalSnapshot (type 3)
// mouse-move + scroll events in chunk 1.
function replayChunk0() {
  return [
    { type: 4, data: { href: `${baseUrl}/`, width: 1440, height: 900 }, timestamp: t0 },
    {
      type: 2,
      data: {
        node: {
          type: 0,
          childNodes: [
            { type: 1, name: 'html', publicId: '', systemId: '', id: 2 },
            {
              type: 2,
              tagName: 'html',
              attributes: {},
              childNodes: [
                { type: 2, tagName: 'head', attributes: {}, childNodes: [], id: 4 },
                {
                  type: 2,
                  tagName: 'body',
                  attributes: { style: 'background:#070a0b;color:#c8d3d5;font-family:monospace' },
                  childNodes: [
                    { type: 3, textContent: 'SEED VISIT // synthetic replay fixture', id: 6 },
                  ],
                  id: 5,
                },
              ],
              id: 3,
            },
          ],
          id: 1,
        },
        initialOffset: { left: 0, top: 0 },
      },
      timestamp: t0 + 16,
    },
  ]
}

function replayChunk1() {
  return [
    {
      type: 3,
      data: {
        source: 1, // mouse move
        positions: [
          { x: 320, y: 240, id: 5, timeOffset: 0 },
          { x: 640, y: 480, id: 5, timeOffset: -400 },
        ],
      },
      timestamp: t0 + 1_500,
    },
    { type: 3, data: { source: 3, id: 1, x: 0, y: 600 }, timestamp: t0 + 3_000 }, // scroll
  ]
}

// ------------------------------------------------------------------- main

async function main() {
  console.log(`seed-visit: server=${baseUrl} db=${dbPath}`)
  console.log(`seed-visit: vid=${vid}`)
  console.log(`seed-visit: sid=${sid}`)

  // a. pageview + section_enter
  const resA = await postCollect(envelopeA)
  check('collect: pageview envelope accepted (204)', resA.status === 204, `status ${resA.status}${resA.status === 429 ? ' - rate window from a previous run still open? wait 60s' : ''}`)

  // b. the rest of the browse: dwell, scroll, click, outbound, heartbeats, vitals
  const resB = await postCollect(envelopeB)
  check('collect: browse envelope accepted (204)', resB.status === 204, `status ${resB.status}`)

  // c. two gzipped rrweb chunks
  const resR0 = await postReplay(sid, 0, replayChunk0())
  const resR1 = await postReplay(sid, 1, replayChunk1())
  check('replay: chunk seq 0 accepted (204)', resR0.status === 204, `status ${resR0.status}`)
  check('replay: chunk seq 1 accepted (204)', resR1.status === 204, `status ${resR1.status}`)

  // d. verify what landed, straight from the SQLite file
  if (!existsSync(dbPath)) {
    check(`db: file exists at ${dbPath}`, false, 'wrong dbPath? pass it as argv[3]')
  } else {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const visitor = db.prepare('SELECT * FROM visitors WHERE vid = ?').get(vid)
      check('db: visitors row exists', visitor !== undefined)
      check('db: visitors.visit_count = 1', visitor?.visit_count === 1, `got ${visitor?.visit_count}`)

      const session = db.prepare('SELECT * FROM sessions WHERE sid = ?').get(sid)
      check('db: sessions row exists', session !== undefined)
      check(
        `db: sessions.duration_ms = ${heartbeatCount * HEARTBEAT_MS}`,
        session?.duration_ms === heartbeatCount * HEARTBEAT_MS,
        `got ${session?.duration_ms}`,
      )
      check('db: sessions.pageviews = 1', session?.pageviews === 1, `got ${session?.pageviews}`)
      check('db: sessions.max_scroll_pct = 75', session?.max_scroll_pct === 75, `got ${session?.max_scroll_pct}`)
      check('db: sessions.browser = Chrome', session?.browser === 'Chrome', `got ${session?.browser}`)
      check('db: sessions.is_bot = 0', session?.is_bot === 0, `got ${session?.is_bot}`)
      check('db: sessions.has_replay = 1', session?.has_replay === 1, `got ${session?.has_replay}`)

      const { n: eventCount } = db.prepare('SELECT COUNT(*) AS n FROM events WHERE sid = ?').get(sid)
      check(`db: ${sentEventCount} events stored`, eventCount === sentEventCount, `got ${eventCount}`)

      const { n: chunkCount } = db.prepare('SELECT COUNT(*) AS n FROM replay_chunks WHERE sid = ?').get(sid)
      check('db: 2 replay_chunks rows', chunkCount === 2, `got ${chunkCount}`)

      const replayDir = join(dirname(dbPath), 'replays', sid)
      for (const seq of [0, 1]) {
        const file = join(replayDir, `${String(seq).padStart(5, '0')}.json.gz`)
        check(`fs: replay chunk file ${String(seq).padStart(5, '0')}.json.gz exists`, existsSync(file), file)
      }
    } finally {
      db.close()
    }
  }

  // f. bot visit — runs BEFORE the rate-limit burst on purpose: the burst
  // exhausts the per-IP window and would 429 this envelope otherwise.
  const botSid = randomUUID()
  const resBot = await postCollect(
    { v: 1, vid: randomUUID(), sid: botSid, returning: false, url: '/', events: [] },
    'curl/8.0',
  )
  check('collect: bot envelope accepted (204)', resBot.status === 204, `status ${resBot.status}`)
  if (existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const botSession = db.prepare('SELECT is_bot FROM sessions WHERE sid = ?').get(botSid)
      check('db: curl/8.0 session flagged is_bot = 1', botSession?.is_bot === 1, `got ${botSession?.is_bot}`)
    } finally {
      db.close()
    }
  }

  // e. rate limit burst — LAST, because it poisons the window for ~60s.
  const burst = await Promise.all(
    Array.from({ length: 100 }, () =>
      postCollect({ v: 1, vid: randomUUID(), sid: randomUUID(), returning: false, url: '/', events: [] })
        .then(r => r.status)
        .catch(() => 0)),
  )
  const count429 = burst.filter(s => s === 429).length
  check('ratelimit: burst of 100 envelopes hits at least one 429', count429 >= 1, `${count429} of 100 got 429`)

  console.log(failures === 0
    ? '\nseed-visit: all checks passed'
    : `\nseed-visit: ${failures} check(s) FAILED`)
  console.log('note: the burst step exhausted the per-IP collect rate limit — wait ~60s before re-running or browsing with analytics on.')
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(`FAIL  seed-visit crashed: ${err?.message ?? err}`)
  console.error('      is the server running? start it with: npm run dev (or node .output/server/index.mjs)')
  process.exit(1)
})
