#!/usr/bin/env node
/**
 * Seed a realistic synthetic visit through the REAL analytics pipeline of a
 * running server, then verify what landed in the local D1 database.
 *
 *   node scripts/seed-visit.mjs [baseUrl] [dbPath] [--bulk N] [--ops]
 *
 * Defaults: http://localhost:3000 and the local D1 SQLite file miniflare
 * keeps under .wrangler/state (both `npm run dev` and `npm run preview`
 * write there). Run `npm run db:migrate:local` once before first use.
 *
 * Modes
 *   (default)   a three-page v2 visit (/ → /employee → /contact) carrying
 *               every event type, two gzipped rrweb chunks, then the edge
 *               cases: replay auth (401/403), a pre-pruned visitor, a minimal
 *               v2 envelope, a v1 envelope, Sec-GPC, a bot UA, the honeypot
 *               (UA-keyed, cross-site-safe) and — LAST — a 150-envelope burst
 *               that must trip the 120/min rate limit.
 *   --bulk N    writes N synthetic sessions (+ net/env/page_visits/page_perf/
 *               events, spread over 30 days) to .wrangler/bulk.sql and applies
 *               it with `wrangler d1 execute --local --file`, so every /ops
 *               view has something to render. The dev server may stay up.
 *   --ops       logs into /api/ops/login (OPS_PASSWORD, default `test`) and
 *               exercises the SQL console (read-only guard) and the export.
 *   Flags can be combined; with a flag present the default visit is skipped.
 *
 * Every request carries `x-forwarded-for: <one random TEST-NET address per
 * run>` so the rate limiter, the honeypot and the per-IP session cap all see
 * ONE stable client (undici's happy-eyeballs can otherwise flip localhost
 * between ::1 and 127.0.0.1). That relies on NUXT_TRUST_PROXY (default true,
 * dev-only relevance); the script reports what the server actually stored.
 *
 * Prints PASS/FAIL per assertion and exits 1 if any assertion failed.
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { randomInt, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'

// ---------------------------------------------------------------- arguments

const positional = []
let bulkN = null
let opsMode = false
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a === '--bulk') {
    bulkN = Number(process.argv[++i])
  } else if (a.startsWith('--bulk=')) {
    bulkN = Number(a.slice(7))
  } else if (a === '--ops') {
    opsMode = true
  } else if (a.startsWith('--')) {
    console.error(`unknown flag ${a}`)
    process.exit(2)
  } else {
    positional.push(a)
  }
}
if (bulkN !== null && (!Number.isInteger(bulkN) || bulkN < 1 || bulkN > 20_000)) {
  console.error('--bulk N must be an integer between 1 and 20000')
  process.exit(2)
}

/** Newest real database file under miniflare's local D1 state (never metadata.sqlite). */
function findLocalD1() {
  const dir = resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter(f => /^[0-9a-f]{64}\.sqlite$/.test(f))
  if (files.length === 0) return null
  files.sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs)
  return join(dir, files[0])
}

const baseUrl = (positional[0] ?? 'http://localhost:3000').replace(/\/+$/, '')
const dbPath = positional[1] ? resolve(positional[1]) : findLocalD1()

const CHROME_UA
  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const HEARTBEAT_MS = 15_000
const EMAIL = 'rbetts@idamilk.com'
/** One stable, private, non-loopback client address per run (TEST-NET-2). */
const RUN_IP = `198.51.100.${randomInt(1, 255)}`

let passes = 0
let failures = 0

function check(label, ok, detail = '') {
  const suffix = detail ? `  (${detail})` : ''
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${suffix}`)
  if (ok) passes++
  else failures++
}

const pause = ms => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------- http

function cookieFrom(res, name) {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  for (const c of all) {
    const m = c.match(new RegExp(`^${name}=([^;]*)`))
    if (m) return m[1]
  }
  return null
}

/** POST /api/collect. Returns the Response (status + Set-Cookie readable). */
async function postCollect(envelope, { ua = CHROME_UA, headers = {}, ip = RUN_IP } = {}) {
  return fetch(`${baseUrl}/api/collect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': ua,
      'x-forwarded-for': ip,
      ...headers,
    },
    body: JSON.stringify(envelope),
  })
}

/** POST /api/replay — one gzipped rrweb chunk with the WP1 header set + the rb_rt cookie. */
async function postReplay({ sid, rid, seq, events, cookie, pageStartedAt, ua = CHROME_UA }) {
  const body = gzipSync(Buffer.from(JSON.stringify(events)))
  const headers = {
    'content-type': 'application/octet-stream',
    'user-agent': ua,
    'x-forwarded-for': RUN_IP,
    'x-rb-sid': sid,
    'x-rb-rid': rid,
    'x-rb-seq': String(seq),
    'x-rb-gz': '1',
    'x-rb-ps': String(pageStartedAt),
  }
  if (cookie) headers.cookie = `rb_rt=${cookie}`
  return fetch(`${baseUrl}/api/replay`, { method: 'POST', headers, body })
}

// ---------------------------------------------------------------- sqlite

function openDb({ write = false } = {}) {
  if (!dbPath || !existsSync(dbPath)) return null
  const db = new DatabaseSync(dbPath, { readOnly: !write })
  if (write) db.exec('PRAGMA busy_timeout = 5000')
  return db
}

/** Run `fn(db)` on a fresh connection (WAL reads stay current that way). */
function withDb(fn, opts) {
  const db = openDb(opts)
  if (!db) {
    check('db: local D1 sqlite file found', false, 'run `npm run db:migrate:local` first, or pass the path as argv[3]')
    return undefined
  }
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

const one = (db, sql, ...args) => db.prepare(sql).get(...args)
const count = (db, sql, ...args) => Number(db.prepare(sql).get(...args)?.n ?? 0)

// ---------------------------------------------------------------- visit fixture (v2)

function ev(t, type, name, p, u) {
  const e = { t, type, name: name ?? null, u }
  if (p !== undefined) e.p = p
  return e
}

function envProbe() {
  return {
    webdriver: false,
    uad: { brands: 'Chromium/126;Google Chrome/126;Not-A.Brand/8', mobile: false, platform: 'Windows' },
    uadHi: {
      architecture: 'x86',
      bitness: '64',
      model: '',
      platformVersion: '15.0.0',
      fullVersionList: 'Chromium/126.0.6478.127;Google Chrome/126.0.6478.127',
      formFactors: 'Desktop',
      wow64: false,
    },
    languages: 'en-US,en',
    maxTouchPoints: 0,
    pdfViewer: true,
    cookies: true,
    gpc: false,
    dnt: false,
    gpu: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    webgpu: { vendor: 'nvidia', architecture: 'ampere', device: '', description: '' },
    battery: null,
    storage: { quotaMb: 120_000, usageMb: 12 },
    media: { audioinput: 1, videoinput: 1, audiooutput: 2 },
    prefers: { scheme: 'light', reducedMotion: false, contrast: 'none', forcedColors: false, invertedColors: false, reducedTransparency: false },
    screen: { availW: 2560, availH: 1400, colorDepth: 24, orientation: 'landscape-primary' },
    memory: { limitMb: 4096, usedMb: 38 },
    net: { type: 'wifi', effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
    voices: 22,
    tz: { name: 'America/Boise', offsetMin: -360 },
    locale: 'en-US',
    display: 'browser',
    outer: { w: 1456, h: 1000 },
    inner: { w: 1440, h: 900 },
    deviceMemory: 16,
    cores: 12,
    platform: 'Windows',
    touch: false,
  }
}

/**
 * The visit: / (initial) → /employee (spa) → /contact, four envelopes.
 * Heartbeats are spread 3 + 1 + 1 + 1: the server caps them per envelope at
 * ⌈wall-clock since the last envelope ÷ 15 s⌉ + 1 (3 for a brand-new sid),
 * and these envelopes arrive back to back.
 */
function buildVisit() {
  const vid = randomUUID()
  const sid = randomUUID()
  const rid = randomUUID()
  const pv0 = randomUUID()
  const pv1 = randomUUID()
  const pv2 = randomUUID()
  const t0 = Date.now() - 95_000 // the visit "started" ~95 s ago
  const subject = 'Hiring / role inquiry'

  const e1 = [
    ev(t0, 'pageview', null, {
      pvid: pv0,
      path: '/',
      from: null,
      kind: 'initial',
      referrer: 'https://news.ycombinator.com/',
      utm: { source: 'hn', medium: 'social', campaign: 'launch', term: null, content: null },
      screen: { w: 2560, h: 1440, dpr: 1 },
      viewport: { w: 1440, h: 900 },
      tz: 'America/Boise',
      tzOffsetMin: -360,
      lang: 'en-US',
      nav: { site: 'none', mode: 'navigate', dest: 'document', user: true, referer: null, ray: null, earlyData: false },
    }, '/'),
    ev(t0 + 1_200, 'first_interaction', null, { ms: 1200, kind: 'pointer' }, '/'),
    ev(t0 + 600, 'section_enter', 'home.kpi', undefined, '/'),
    ev(t0 + 5_600, 'section_exit', 'home.kpi', { dwellMs: 5_000, pvid: pv0 }, '/'),
    ev(t0 + 5_700, 'section_enter', 'home.trend', undefined, '/'),
    ev(t0 + 9_700, 'section_exit', 'home.trend', { dwellMs: 4_000, pvid: pv0 }, '/'),
    ev(t0 + 4_000, 'scroll_depth', null, { pct: 25 }, '/'),
    ev(t0 + 8_000, 'scroll_depth', null, { pct: 50 }, '/'),
    ev(t0 + 6_000, 'click', null, {
      sel: '[data-section="home.kpi"] table.ns-kpi a', text: 'Network Uptime', x: 712, y: 640,
      section: 'home.kpi', tag: 'a', button: 0, kind: 'pointer', href: '/employee', mod: false,
    }, '/'),
    ev(t0 + 7_000, 'click', null, {
      sel: '[data-section="home.trend"] svg', text: '', x: 900, y: 700,
      section: 'home.trend', tag: 'svg', button: 2, kind: 'pointer', mod: false,
    }, '/'),
    ev(t0 + 6_900, 'hover', 'kpi:network-uptime', { ms: 800 }, '/'),
    ev(t0 + 10_000, 'viewport', null, { w: 1440, h: 900, scale: 1, dpr: 1.25, orientation: 'landscape-primary', cause: 'zoom' }, '/'),
    ev(t0 + 11_000, 'site_search', 'kidcam', { q: 'kidcam', results: 1, chosen: 'KidCam' }, '/'),
    ev(t0 + 12_000, 'easter_egg', 'konami', undefined, '/'),
    ev(t0 + 13_000, 'js_error', null, {
      msg: 'TypeError: Cannot read properties of undefined (reading "x")',
      src: '/_nuxt/entry.js',
      line: 42,
      stack: 'TypeError: Cannot read properties of undefined\n    at chrome-extension://abcdefghijkl/content.js:1:1',
    }, '/'),
    ev(t0 + 15_000, 'heartbeat', null, { pvid: pv0, activeMs: 15_000, maxScrollPct: 50 }, '/'),
    ev(t0 + 30_000, 'heartbeat', null, { pvid: pv0, activeMs: 30_000, maxScrollPct: 50 }, '/'),
    ev(t0 + 45_000, 'heartbeat', null, { pvid: pv0, activeMs: 45_000, maxScrollPct: 50 }, '/'),
    ev(t0 + 3_000, 'vitals', null, { pvid: pv0, ttfb: 120, fcp: 600, lcp: 900, lcpSel: 'main > h1', lcpSize: 12_000, cls: 0.02, inp: 40 }, '/'),
    ev(t0 + 3_500, 'perf', null, {
      pvid: pv0,
      nav: { dns: 12, connect: 30, tls: 25, request: 80, response: 40, domInteractive: 500, dcl: 520, load: 900, transfer: 48_000, encoded: 46_000, decoded: 160_000, redirects: 0, protocol: 'h2', type: 'navigate' },
      resources: {
        count: 14, bytes: 310_000, cached: 3,
        byType: { script: 6, css: 1, font: 2, img: 2, fetch: 1, other: 2 },
        slowest: [
          { name: 'fonts.gstatic.com/s/x.woff2', dur: 210, size: 30_000, type: 'font' },
          { name: '/_nuxt/entry.js', dur: 180, size: 90_000, type: 'script' },
          { name: '/_nuxt/entry.css', dur: 60, size: 20_000, type: 'css' },
        ],
      },
      longTasks: { count: 1, totalMs: 80, longestMs: 80 },
      loaf: { count: 1, totalMs: 60, longestMs: 60, script: '/_nuxt/entry.js' },
    }, '/'),
    ev(t0 + 4_500, 'env', null, envProbe(), '/'),
  ]

  const e2 = [
    ev(t0 + 50_000, 'section_enter', 'home.recent', undefined, '/'),
    ev(t0 + 55_000, 'section_exit', 'home.recent', { dwellMs: 5_000, pvid: pv0 }, '/'),
    ev(t0 + 52_000, 'scroll_depth', null, { pct: 75 }, '/'),
    ev(t0 + 53_000, 'rage_click', null, { n: 3, sel: '[data-section="home.recent"] .ns-recent__row', x: 300, y: 500, section: 'home.recent' }, '/'),
    ev(t0 + 54_000, 'dead_click', null, { sel: '[data-section="home.report"] .ns-report__bar', text: 'Skills Coverage', section: 'home.report' }, '/'),
    ev(t0 + 56_000, 'find', null, undefined, '/'),
    ev(t0 + 57_000, 'select', null, { len: 40, hasEmail: false, section: 'home.report' }, '/'),
    ev(t0 + 60_000, 'heartbeat', null, { pvid: pv0, activeMs: 60_000, maxScrollPct: 75 }, '/'),
    ev(t0 + 61_000, 'page_leave', null, {
      pvid: pv0, path: '/', enteredAt: t0, activeMs: 61_000, hiddenMs: 0, blurs: 0, maxScrollPct: 75,
      scrollPx: 1_800, scrollReversals: 2, maxScrollVel: 1_400, sectionsSeen: 3, clicks: 3, ptr: 5, touch: 0, key: 2,
      consoleErrors: 0, textLen: 5_400, reason: 'spa',
    }, '/'),
  ]

  const t1 = t0 + 61_200
  const e3 = [
    ev(t1, 'pageview', null, { pvid: pv1, path: '/employee', from: '/', kind: 'spa', softNavMs: 140 }, '/employee'),
    ev(t1 + 600, 'section_enter', 'employee.primary', undefined, '/employee'),
    ev(t1 + 3_600, 'section_exit', 'employee.primary', { dwellMs: 3_000, pvid: pv1 }, '/employee'),
    ev(t1 + 3_700, 'section_enter', 'employee.skills', undefined, '/employee'),
    ev(t1 + 9_700, 'section_exit', 'employee.skills', { dwellMs: 6_000, pvid: pv1 }, '/employee'),
    ev(t1 + 1_000, 'scroll_depth', null, { pct: 25 }, '/employee'),
    ev(t1 + 4_000, 'scroll_depth', null, { pct: 50 }, '/employee'),
    ev(t1 + 8_000, 'scroll_depth', null, { pct: 100 }, '/employee'),
    ev(t1 + 5_000, 'subtab', 'Access', { index: 1 }, '/employee'),
    ev(t1 + 6_000, 'outbound', 'github.com', {
      href: 'https://github.com/Riley-D-Betts', label: 'GitHub', button: 0, newTab: true, zone: 'record-actions',
    }, '/employee'),
    ev(t1 + 7_000, 'resource_error', null, { tag: 'img', src: '/missing-avatar.png', sel: 'img.ns-avatar' }, '/employee'),
    ev(t1 + 9_000, 'exit_intent', null, { x: 640, y: 0 }, '/employee'),
    ev(t1 + 15_000, 'heartbeat', null, { pvid: pv1, activeMs: 15_000, maxScrollPct: 100 }, '/employee'),
    ev(t1 + 16_000, 'page_leave', null, {
      pvid: pv1, path: '/employee', enteredAt: t1, activeMs: 15_800, hiddenMs: 0, blurs: 1, maxScrollPct: 100,
      scrollPx: 2_600, scrollReversals: 1, maxScrollVel: 2_100, sectionsSeen: 2, clicks: 2, ptr: 3, touch: 0, key: 0,
      consoleErrors: 0, textLen: 7_100, reason: 'spa',
    }, '/employee'),
  ]

  const t2 = t1 + 16_300
  const formFacts = { bodyLen: 180, authorFilled: true }
  const e4 = [
    ev(t2, 'pageview', null, { pvid: pv2, path: '/contact', from: '/employee', kind: 'spa', softNavMs: 95 }, '/contact'),
    ev(t2 + 600, 'section_enter', 'contact.form', undefined, '/contact'),
    ev(t2 + 1_000, 'hover', 'email', { ms: 650 }, '/contact'),
    ev(t2 + 2_000, 'copy', null, { len: EMAIL.length, snippet: EMAIL, hasEmail: true, section: 'contact.form', sel: 'a' }, '/contact'),
    ev(t2 + 3_000, 'form', 'contact', { step: 'focus' }, '/contact'),
    ev(t2 + 3_500, 'form', 'contact', { step: 'input' }, '/contact'),
    ev(t2 + 4_000, 'form', 'contact', { step: 'field', field: 'subject', subject, bodyLen: 0, authorFilled: false, msSinceFocus: 1_000 }, '/contact'),
    ev(t2 + 9_000, 'form', 'contact', { step: 'field', field: 'body', ...formFacts, msSinceFocus: 6_000 }, '/contact'),
    ev(t2 + 10_000, 'form', 'contact', { step: 'submit', subject, ...formFacts, msSinceFocus: 7_000 }, '/contact'),
    ev(t2 + 10_050, 'outbound', 'mailto', {
      href: `mailto:${EMAIL}`, label: EMAIL, button: 0, newTab: false, section: 'contact.form',
    }, '/contact'),
    ev(t2 + 11_000, 'print', null, { phase: 'before' }, '/contact'),
    ev(t2 + 14_000, 'print', null, { phase: 'after', ms: 3_000 }, '/contact'),
    ev(t2 + 15_000, 'heartbeat', null, { pvid: pv2, activeMs: 15_000, maxScrollPct: 60 }, '/contact'),
    ev(t2 + 15_100, 'section_exit', 'contact.form', { dwellMs: 14_500, pvid: pv2 }, '/contact'),
    ev(t2 + 16_000, 'visibility', null, { state: 'hidden', ms: 16_000, pvid: pv2, activeMs: 15_900, maxScrollPct: 60 }, '/contact'),
    ev(t2 + 16_010, 'page_leave', null, {
      pvid: pv2, path: '/contact', enteredAt: t2, activeMs: 15_900, hiddenMs: 0, blurs: 0, maxScrollPct: 60,
      scrollPx: 400, scrollReversals: 0, maxScrollVel: 600, sectionsSeen: 1, clicks: 4, ptr: 6, touch: 0, key: 210,
      consoleErrors: 0, textLen: 1_200, reason: 'unload',
    }, '/contact'),
    ev(t2 + 16_020, 'not_a_real_type', null, { x: 1 }, '/contact'),
  ]

  const envelopes = [
    { v: 2, vid, sid, returning: false, url: '/', events: e1 },
    { v: 2, vid, sid, returning: false, url: '/', events: e2 },
    { v: 2, vid, sid, returning: false, url: '/employee', events: e3 },
    { v: 2, vid, sid, returning: false, url: '/contact', events: e4 },
  ]
  const all = envelopes.flatMap(x => x.events)
  const n = type => all.filter(x => x.type === type).length
  const heartbeats = n('heartbeat')
  const merged = n('env') + n('perf') + n('vitals')
  const unknown = n('not_a_real_type')
  const expectedEvents = all.length - heartbeats - merged - unknown
  return { vid, sid, rid, pv0, pv1, pv2, t0, envelopes, sent: all.length, heartbeats, merged, unknown, expectedEvents }
}

// Minimal but VALID rrweb chunks: a Meta event (type 4), a FullSnapshot
// (type 2) with a tiny serialized DOM, then IncrementalSnapshot (type 3)
// mouse-move + scroll events in chunk 1.
function replayChunk0(t0) {
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
                  attributes: { style: 'background:#fff;color:#222;font-family:sans-serif' },
                  childNodes: [{ type: 3, textContent: 'SEED VISIT // synthetic replay fixture', id: 6 }],
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

function replayChunk1(t0) {
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

function pageviewOnly(vid, sid, path = '/', extra = {}) {
  return {
    v: 2,
    vid,
    sid,
    returning: false,
    url: path,
    events: [ev(Date.now() - 1_000, 'pageview', null, { pvid: randomUUID(), path, from: null, kind: 'initial', ...extra }, path)],
  }
}

// ---------------------------------------------------------------- default mode

async function seedVisit() {
  const fx = buildVisit()
  console.log(`seed-visit: vid=${fx.vid}`)
  console.log(`seed-visit: sid=${fx.sid}  rid=${fx.rid}`)

  // a. the four envelopes, in order; the first response carries the rb_rt cookie
  let rt = null
  for (let i = 0; i < fx.envelopes.length; i++) {
    const res = await postCollect(fx.envelopes[i])
    const hint = res.status === 429 ? ' — rate window from a previous run still open? wait 60 s' : ''
    check(`collect: envelope ${i + 1}/${fx.envelopes.length} (${fx.envelopes[i].url}) accepted (204)`, res.status === 204, `status ${res.status}${hint}`)
    if (i === 0) rt = cookieFrom(res, 'rb_rt')
  }
  check('collect: first response set the rb_rt replay token cookie', typeof rt === 'string' && /^[0-9a-f]{64}$/.test(rt ?? ''), rt ? `rb_rt=${rt.slice(0, 12)}…` : 'no Set-Cookie rb_rt')

  // b. replay: auth negatives first, then two real chunks
  const noCookie = await postReplay({ sid: fx.sid, rid: fx.rid, seq: 0, events: replayChunk0(fx.t0), cookie: null, pageStartedAt: fx.t0 })
  check('replay: chunk WITHOUT the rb_rt cookie is rejected (401)', noCookie.status === 401, `status ${noCookie.status}`)
  const wrongCookie = await postReplay({ sid: fx.sid, rid: fx.rid, seq: 0, events: replayChunk0(fx.t0), cookie: 'f'.repeat(64), pageStartedAt: fx.t0 })
  check('replay: chunk with a forged rb_rt is rejected (401)', wrongCookie.status === 401, `status ${wrongCookie.status}`)

  const r0 = await postReplay({ sid: fx.sid, rid: fx.rid, seq: 0, events: replayChunk0(fx.t0), cookie: rt, pageStartedAt: fx.t0 })
  const r1 = await postReplay({ sid: fx.sid, rid: fx.rid, seq: 1, events: replayChunk1(fx.t0), cookie: rt, pageStartedAt: fx.t0 })
  check('replay: chunk seq 0 accepted (204)', r0.status === 204, `status ${r0.status}`)
  check('replay: chunk seq 1 accepted (204)', r1.status === 204, `status ${r1.status}`)

  // c. what landed, straight from the local D1 SQLite file
  withDb((db) => {
    const { sid, vid } = fx
    const s = one(db, 'SELECT * FROM sessions WHERE sid = ?', sid)
    check('db: sessions row exists', s !== undefined)
    if (!s) return
    const ipNote = s.ip === RUN_IP ? `x-forwarded-for trusted (ip=${s.ip})` : `server stored ip=${s.ip}, not the x-forwarded-for value — NUXT_TRUST_PROXY off?`
    console.log(`info  ${ipNote}`)

    const visitor = one(db, 'SELECT * FROM visitors WHERE vid = ?', vid)
    check('db: visitors row exists with visit_count = 1', visitor?.visit_count === 1, `got ${visitor?.visit_count}`)
    check('db: visitors.first_entry_path = /', visitor?.first_entry_path === '/', `got ${visitor?.first_entry_path}`)

    check('db: sessions.pageviews = 3', s.pageviews === 3, `got ${s.pageviews}`)
    check('db: sessions.entry_path = / and nav_kind = initial', s.entry_path === '/' && s.nav_kind === 'initial', `got ${s.entry_path} / ${s.nav_kind}`)
    check('db: sessions.exit_path = last_path = /contact', s.exit_path === '/contact' && s.last_path === '/contact', `got ${s.exit_path} / ${s.last_path}`)
    check(`db: sessions.duration_ms = ${fx.heartbeats} heartbeats × 15000 (heartbeat time, labelled separately from active time)`, s.duration_ms === fx.heartbeats * HEARTBEAT_MS, `got ${s.duration_ms}`)
    const active = count(db, 'SELECT COALESCE(SUM(active_ms), 0) AS n FROM page_visits WHERE sid = ?', sid)
    check('db: SUM(page_visits.active_ms) > 0 (the active-time measure)', active > 0, `got ${active}`)
    check('db: sessions.max_scroll_pct = 100', s.max_scroll_pct === 100, `got ${s.max_scroll_pct}`)
    check('db: sessions.browser = Chrome, device_type = desktop', s.browser === 'Chrome' && s.device_type === 'desktop', `got ${s.browser} / ${s.device_type}`)
    check('db: sessions.is_bot = 0, is_webdriver = 0', s.is_bot === 0 && s.is_webdriver === 0, `got ${s.is_bot} / ${s.is_webdriver}`)
    check('db: sessions.is_returning = 0, visit_n = 1', s.is_returning === 0 && s.visit_n === 1, `got ${s.is_returning} / ${s.visit_n}`)
    check('db: sessions.referrer + utm_source stored', s.referrer === 'https://news.ycombinator.com/' && s.utm_source === 'hn', `got ${s.referrer} / ${s.utm_source}`)
    check('db: sessions.first_interaction_ms = 1200', s.first_interaction_ms === 1200, `got ${s.first_interaction_ms}`)
    check('db: sessions.asn populated (miniflare fallback 395747 locally)', typeof s.asn === 'number' && s.asn > 0, `got ${s.asn}`)

    const counters = {
      prints: 1, copies: 1, email_copies: 1, selects: 1, form_started: 1, form_submitted: 1, finds: 1, searches: 1,
      exit_intents: 1, rage_clicks: 1, dead_clicks: 1, right_clicks: 1, errors: 2, outbounds: 2, mailto_clicks: 1,
      hovers: 2, eggs: 1, subtabs: 1, blurs: 1, key_n: 212, ptr_n: 14,
    }
    for (const [col, want] of Object.entries(counters)) {
      check(`db: sessions.${col} = ${want}`, s[col] === want, `got ${s[col]}`)
    }

    const eventCount = count(db, 'SELECT COUNT(*) AS n FROM events WHERE sid = ?', sid)
    check(
      `db: events rows = sent − heartbeats − env − perf − vitals − unknown (${fx.sent} − ${fx.heartbeats} − ${fx.merged} − ${fx.unknown} = ${fx.expectedEvents})`,
      eventCount === fx.expectedEvents,
      `got ${eventCount}`,
    )
    check('db: sessions.events_n matches the stored rows', s.events_n === eventCount, `got ${s.events_n}`)
    const nullPath = count(db, 'SELECT COUNT(*) AS n FROM events WHERE sid = ? AND path IS NULL', sid)
    check('db: events.path is non-null on every row', nullPath === 0, `${nullPath} null`)
    const paths = db.prepare('SELECT DISTINCT path FROM events WHERE sid = ? ORDER BY path').all(sid).map(r => r.path)
    check('db: events.path covers /, /employee, /contact', paths.join(',') === '/,/contact,/employee', `got ${paths.join(',')}`)
    for (const type of ['heartbeat', 'env', 'perf', 'vitals', 'not_a_real_type']) {
      check(`db: no events row of type ${type} (merged / dropped)`, count(db, 'SELECT COUNT(*) AS n FROM events WHERE sid = ? AND type = ?', sid, type) === 0)
    }
    const jsErr = one(db, "SELECT payload FROM events WHERE sid = ? AND type = 'js_error'", sid)
    check('db: js_error stack has its extension URL scrubbed to <ext>', typeof jsErr?.payload === 'string' && jsErr.payload.includes('<ext>') && !jsErr.payload.includes('chrome-extension://'), jsErr?.payload?.slice(0, 80))
    const mailto = one(db, "SELECT name, payload FROM events WHERE sid = ? AND type = 'outbound' AND name = 'mailto'", sid)
    check('db: mailto outbound stored on /contact with its href', mailto !== undefined && String(mailto.payload).includes(`mailto:${EMAIL}`))

    // page_visits
    const visits = db.prepare('SELECT * FROM page_visits WHERE sid = ? ORDER BY entered_at').all(sid)
    check('db: page_visits has exactly 3 rows', visits.length === 3, `got ${visits.length}`)
    const [v0, v1, v2] = visits
    check('db: page_visits / row: nav_kind = initial, from_path IS NULL', v0?.path === '/' && v0?.nav_kind === 'initial' && v0?.from_path === null, `got ${v0?.path} ${v0?.nav_kind} ${v0?.from_path}`)
    check('db: page_visits /employee row: nav_kind = spa, from_path = /, soft_nav_ms = 140', v1?.path === '/employee' && v1?.nav_kind === 'spa' && v1?.from_path === '/' && v1?.soft_nav_ms === 140, `got ${v1?.path} ${v1?.nav_kind} ${v1?.from_path} ${v1?.soft_nav_ms}`)
    check('db: page_visits /contact row: from_path = /employee, leave_reason = unload', v2?.path === '/contact' && v2?.from_path === '/employee' && v2?.leave_reason === 'unload', `got ${v2?.path} ${v2?.from_path} ${v2?.leave_reason}`)
    check('db: every page_visits row has active_ms > 0 and left_at set', visits.every(v => v.active_ms > 0 && v.left_at !== null))
    check('db: page_visits / row merged text_len + sections_seen from page_leave', v0?.text_len === 5_400 && v0?.sections_seen === 3, `got ${v0?.text_len} / ${v0?.sections_seen}`)

    // page_perf
    const perf0 = one(db, 'SELECT * FROM page_perf WHERE pvid = ?', fx.pv0)
    const perf1 = one(db, 'SELECT * FROM page_perf WHERE pvid = ?', fx.pv1)
    check('db: page_perf / row has lcp_ms (vitals) AND dns_ms (perf) merged', perf0?.lcp_ms === 900 && perf0?.dns_ms === 12, `got lcp ${perf0?.lcp_ms} dns ${perf0?.dns_ms}`)
    check('db: page_perf / row keeps cls, inp, protocol, long tasks', perf0?.cls === 0.02 && perf0?.inp_ms === 40 && perf0?.protocol === 'h2' && perf0?.long_tasks === 1, `got ${perf0?.cls} ${perf0?.inp_ms} ${perf0?.protocol} ${perf0?.long_tasks}`)
    check('db: page_perf res_slowest keeps fonts.gstatic.com/s/x.woff2', typeof perf0?.res_slowest === 'string' && perf0.res_slowest.includes('fonts.gstatic.com/s/x.woff2'), perf0?.res_slowest?.slice(0, 80))
    check('db: page_perf /employee row has soft_nav_ms = 140 and lcp_ms IS NULL', perf1?.soft_nav_ms === 140 && perf1?.lcp_ms === null, `got soft ${perf1?.soft_nav_ms} lcp ${perf1?.lcp_ms}`)

    // side tables
    const net = one(db, 'SELECT * FROM session_net WHERE sid = ?', sid)
    check('db: session_net row exists', net !== undefined)
    check('db: session_net.client_tz_offset_min = -360 (from the pageview)', net?.client_tz_offset_min === -360, `got ${net?.client_tz_offset_min}`)
    check('db: session_net.cf_tz_offset_min present (from request.cf timezone)', typeof net?.cf_tz_offset_min === 'number', `got ${net?.cf_tz_offset_min}`)
    check('db: session_net.fetch_site = none (SSR handoff via pageview.nav)', net?.fetch_site === 'none' && net?.fetch_dest === 'document' && net?.fetch_user === 1, `got ${net?.fetch_site} ${net?.fetch_dest} ${net?.fetch_user}`)
    check('db: session_net.accept_language / ch_* columns exist (null is fine off-Chromium)', net !== undefined && 'accept_language' in net && 'ch_ua' in net)
    const env = one(db, 'SELECT * FROM session_env WHERE sid = ?', sid)
    check('db: session_env row exists', env !== undefined)
    check('db: session_env.gpu_renderer present (string or NULL)', env !== undefined && (env.gpu_renderer === null || typeof env.gpu_renderer === 'string'), `got ${String(env?.gpu_renderer).slice(0, 40)}`)
    check('db: session_env typed columns (cores, languages, color_scheme, tz_name) landed', env?.cores === 12 && env?.languages === 'en-US,en' && env?.color_scheme === 'light' && env?.tz_name === 'America/Boise', `got ${env?.cores} ${env?.languages} ${env?.color_scheme} ${env?.tz_name}`)
    check('db: session_env.webdriver = 0', env?.webdriver === 0, `got ${env?.webdriver}`)

    // replay ledger
    const chunks = db.prepare('SELECT seq, bytes, compressed, pending, page_started_at FROM replay_chunks_v2 WHERE sid = ? AND rid = ? ORDER BY seq').all(sid, fx.rid)
    check('db: replay_chunks_v2 has two rows for (sid, rid)', chunks.length === 2, `got ${chunks.length}`)
    check('db: both chunks pending = 0, compressed = 1, bytes > 0', chunks.length === 2 && chunks.every(c => c.pending === 0 && c.compressed === 1 && c.bytes > 0))
    check('db: replay chunks carry page_started_at = x-rb-ps', chunks.every(c => c.page_started_at === fx.t0), `got ${chunks.map(c => c.page_started_at).join(',')}`)
    const s2 = one(db, 'SELECT has_replay FROM sessions WHERE sid = ?', sid)
    check('db: sessions.has_replay = 1 (seq 0 landed)', s2?.has_replay === 1, `got ${s2?.has_replay}`)
  })

  // d. pre-pruned visitor: a visitors row inserted directly with visit_count = 5
  {
    const oldVid = randomUUID()
    const now = Date.now()
    const inserted = withDb((db) => {
      db.prepare('INSERT INTO visitors (vid, first_seen_at, last_seen_at, visit_count) VALUES (?, ?, ?, 5)').run(oldVid, now - 86_400_000 * 40, now - 86_400_000 * 3)
      return true
    }, { write: true })
    if (inserted) {
      const sid = randomUUID()
      const res = await postCollect(pageviewOnly(oldVid, sid))
      check('collect: session for a pre-pruned visitor accepted (204)', res.status === 204, `status ${res.status}`)
      withDb((db) => {
        const s = one(db, 'SELECT visit_n, is_returning FROM sessions WHERE sid = ?', sid)
        const v = one(db, 'SELECT visit_count FROM visitors WHERE vid = ?', oldVid)
        check('db: pre-pruned visitor → visitors.visit_count = 6', v?.visit_count === 6, `got ${v?.visit_count}`)
        check('db: pre-pruned visitor → sessions.visit_n = 6, is_returning = 1', s?.visit_n === 6 && s?.is_returning === 1, `got ${s?.visit_n} / ${s?.is_returning}`)
      })
    }
  }

  // e. minimal v2 envelope — every optional field absent (bindChecked / undefined guard)
  {
    const sid = randomUUID()
    const res = await postCollect({
      v: 2,
      vid: randomUUID(),
      sid,
      returning: false,
      url: '/',
      events: [{ t: Date.now(), type: 'pageview', name: null, u: '/', p: { pvid: randomUUID(), path: '/', from: null, kind: 'initial' } }],
    })
    check('collect: minimal v2 envelope (no optional fields) accepted (204)', res.status === 204, `status ${res.status}`)
    withDb((db) => {
      const s = one(db, 'SELECT screen_w, referrer, pageviews FROM sessions WHERE sid = ?', sid)
      check('db: minimal envelope stored a session with NULL optionals', s !== undefined && s.screen_w === null && s.referrer === null && s.pageviews === 1, s ? `screen_w ${s.screen_w} referrer ${s.referrer}` : 'no row')
      check('db: minimal envelope stored its page_visits row', count(db, 'SELECT COUNT(*) AS n FROM page_visits WHERE sid = ?', sid) === 1)
    })
  }

  // f. v1 envelope (single-page tracker era) is still accepted; path falls back to url
  {
    const sid = randomUUID()
    const res = await postCollect({
      v: 1,
      vid: randomUUID(),
      sid,
      returning: false,
      url: '/employee',
      events: [
        { t: Date.now() - 5_000, type: 'pageview', p: { referrer: '', screen: { w: 1920, h: 1080, dpr: 1 }, viewport: { w: 1900, h: 950 }, tz: 'America/Boise', lang: 'en-US', platform: 'Win32', touch: false, deviceMemory: 8, cores: 8, connection: '4g' } },
        { t: Date.now() - 4_000, type: 'section_enter', name: 'employee.primary' },
        { t: Date.now() - 1_000, type: 'section_exit', name: 'employee.primary', p: { dwellMs: 3_000 } },
      ],
    })
    check('collect: v1 envelope still accepted (204)', res.status === 204, `status ${res.status}`)
    withDb((db) => {
      const s = one(db, 'SELECT entry_path, pageviews FROM sessions WHERE sid = ?', sid)
      check('db: v1 envelope → entry_path = /employee (from url), pageviews = 1', s?.entry_path === '/employee' && s?.pageviews === 1, `got ${s?.entry_path} / ${s?.pageviews}`)
      const bad = count(db, "SELECT COUNT(*) AS n FROM events WHERE sid = ? AND (path IS NULL OR path <> '/employee')", sid)
      check('db: v1 events.path falls back to the envelope url', bad === 0 && count(db, 'SELECT COUNT(*) AS n FROM events WHERE sid = ?', sid) === 3, `${bad} rows off`)
    })
  }

  // g. Sec-GPC with honorGpc off → stored, flagged
  {
    const sid = randomUUID()
    const res = await postCollect(pageviewOnly(randomUUID(), sid), { headers: { 'sec-gpc': '1' } })
    check('collect: Sec-GPC envelope accepted (204)', res.status === 204, `status ${res.status}`)
    withDb((db) => {
      const s = one(db, 'SELECT gpc FROM sessions WHERE sid = ?', sid)
      check('db: Sec-GPC session stored with gpc = 1 (NUXT_HONOR_GPC=false records, does not drop)', s?.gpc === 1, s ? `gpc ${s.gpc}` : 'no row — is NUXT_HONOR_GPC=true on this server?')
    })
  }

  // h. bot UA: session row + net facts only, zero events; its replay token is refused (403)
  {
    const botSid = randomUUID()
    const resBot = await postCollect(
      { ...pageviewOnly(randomUUID(), botSid), events: [...pageviewOnly(randomUUID(), botSid).events, ev(Date.now(), 'click', null, { sel: 'a', text: 'x', x: 1, y: 1, tag: 'a', button: 0, kind: 'pointer', mod: false }, '/')] },
      { ua: 'curl/8.0' },
    )
    check('collect: curl/8.0 envelope accepted (204)', resBot.status === 204, `status ${resBot.status}`)
    const botRt = cookieFrom(resBot, 'rb_rt')
    withDb((db) => {
      const s = one(db, 'SELECT is_bot FROM sessions WHERE sid = ?', botSid)
      check('db: curl/8.0 session flagged is_bot = 1', s?.is_bot === 1, `got ${s?.is_bot}`)
      check('db: bot session has ZERO events rows', count(db, 'SELECT COUNT(*) AS n FROM events WHERE sid = ?', botSid) === 0)
      check('db: bot session still has its session_net row', count(db, 'SELECT COUNT(*) AS n FROM session_net WHERE sid = ?', botSid) === 1)
      check('db: bot session has no page_visits / session_env rows', count(db, 'SELECT COUNT(*) AS n FROM page_visits WHERE sid = ?', botSid) === 0 && count(db, 'SELECT COUNT(*) AS n FROM session_env WHERE sid = ?', botSid) === 0)
    })
    const forbidden = await postReplay({ sid: botSid, rid: randomUUID(), seq: 0, events: replayChunk0(Date.now()), cookie: botRt, pageStartedAt: Date.now(), ua: 'curl/8.0' })
    check('replay: valid token for a sid that is not a live non-bot session → 403', forbidden.status === 403, `status ${forbidden.status}`)
  }

  // i. honeypot: (ip, ua)-keyed, navigation-only. UA X trips /void.html; UA Y from the same IP stays clean.
  {
    const tag = randomUUID().slice(0, 8)
    const uaX = `Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0 rbseed/${tag}`
    const uaY = `Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15 rbseed/${tag}`
    const uaZ = `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0 rbseed/${tag}`
    const sidX1 = randomUUID()
    const resX1 = await postCollect(pageviewOnly(randomUUID(), sidX1), { ua: uaX })
    check('honeypot: UA X session before the trap accepted (204)', resX1.status === 204, `status ${resX1.status}`)

    const trap = await fetch(`${baseUrl}/void.html`, { headers: { 'user-agent': uaX, 'x-forwarded-for': RUN_IP } })
    check('honeypot: GET /void.html (navigation-like, UA X) answers 200', trap.status === 200, `status ${trap.status}`)

    const sidY = randomUUID()
    await postCollect(pageviewOnly(randomUUID(), sidY), { ua: uaY })
    const sidX2 = randomUUID()
    await postCollect(pageviewOnly(randomUUID(), sidX2), { ua: uaX })

    // cross-site-looking hit (an embedded <img src="/void.html"> elsewhere) must NOT flag
    const sidZ = randomUUID()
    const crossSite = await fetch(`${baseUrl}/void.html`, {
      headers: { 'user-agent': uaZ, 'x-forwarded-for': RUN_IP, 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'image', 'sec-fetch-mode': 'no-cors' },
    })
    check('honeypot: cross-site image hit still answers 200', crossSite.status === 200, `status ${crossSite.status}`)
    await postCollect(pageviewOnly(randomUUID(), sidZ), { ua: uaZ })

    withDb((db) => {
      const bot = sid => one(db, 'SELECT is_bot FROM sessions WHERE sid = ?', sid)?.is_bot
      check('honeypot: UA Y from the same IP is NOT flagged (is_bot = 0)', bot(sidY) === 0, `got ${bot(sidY)}`)
      check('honeypot: a new UA X session IS flagged (is_bot = 1)', bot(sidX2) === 1, `got ${bot(sidX2)}`)
      check('honeypot: the earlier UA X session was retro-flagged (is_bot = 1)', bot(sidX1) === 1, `got ${bot(sidX1)}`)
      check('honeypot: a cross-site-looking hit does NOT flag its (ip, ua) (is_bot = 0)', bot(sidZ) === 0, `got ${bot(sidZ)}`)
      check('db: honeypot_hits row keyed on (ip, ua X)', count(db, 'SELECT COUNT(*) AS n FROM honeypot_hits WHERE ua = ? AND expires_at > ?', uaX, Date.now()) === 1)
    })
  }

  // j. rate limit burst — LAST, because it poisons the window for ~60 s.
  //    Bot UA + empty events → no blank human sessions and no rows at all.
  const burst = await Promise.all(
    Array.from({ length: 150 }, () =>
      postCollect({ v: 2, vid: randomUUID(), sid: randomUUID(), returning: false, url: '/', events: [] }, { ua: 'curl/8.0 rb-seed-burst' })
        .then(r => r.status)
        .catch(() => 0)),
  )
  const count429 = burst.filter(s => s === 429).length
  check('ratelimit: burst of 150 bot-UA envelopes hits at least one 429 (limit 120/min)', count429 >= 1, `${count429} of 150 got 429`)
}

// ---------------------------------------------------------------- --bulk N

const ORGS = [
  { org: 'Comcast Cable', asn: 7922, country: 'US', region: 'Idaho', city: 'Boise', weight: 20 },
  { org: 'CenturyLink', asn: 209, country: 'US', region: 'Idaho', city: 'Meridian', weight: 12 },
  { org: 'Google LLC', asn: 15169, country: 'US', region: 'California', city: 'Mountain View', weight: 8 },
  { org: 'Microsoft Corporation', asn: 8075, country: 'US', region: 'Washington', city: 'Redmond', weight: 8 },
  { org: 'Amazon.com, Inc.', asn: 16509, country: 'US', region: 'Virginia', city: 'Ashburn', weight: 6 },
  { org: 'Micron Technology', asn: 14780, country: 'US', region: 'Idaho', city: 'Boise', weight: 6 },
  { org: 'Boise State University', asn: 3363, country: 'US', region: 'Idaho', city: 'Boise', weight: 5 },
  { org: 'Verizon Business', asn: 701, country: 'US', region: 'New York', city: 'New York', weight: 6 },
  { org: 'T-Mobile USA', asn: 21928, country: 'US', region: 'Texas', city: 'Austin', weight: 6 },
  { org: 'Hetzner Online GmbH', asn: 24940, country: 'DE', region: 'Bavaria', city: 'Nuremberg', weight: 5 },
  { org: 'Rogers Communications', asn: 812, country: 'CA', region: 'Ontario', city: 'Toronto', weight: 4 },
  { org: 'British Telecommunications', asn: 2856, country: 'GB', region: 'England', city: 'London', weight: 4 },
  { org: 'Reliance Jio', asn: 55836, country: 'IN', region: 'Maharashtra', city: 'Mumbai', weight: 4 },
  { org: null, asn: null, country: 'US', region: 'Idaho', city: 'Boise', weight: 6 },
]
const DEVICES = [
  { device: 'desktop', browser: 'Chrome', ver: '126.0', os: 'Windows', w: 1920, h: 1080, vw: 1900, vh: 950, dpr: 1, weight: 40 },
  { device: 'desktop', browser: 'Edge', ver: '126.0', os: 'Windows', w: 2560, h: 1440, vw: 2540, vh: 1300, dpr: 1, weight: 15 },
  { device: 'desktop', browser: 'Safari', ver: '17.5', os: 'macOS', w: 1728, h: 1117, vw: 1700, vh: 990, dpr: 2, weight: 12 },
  { device: 'desktop', browser: 'Firefox', ver: '128.0', os: 'Linux', w: 1920, h: 1080, vw: 1880, vh: 940, dpr: 1, weight: 6 },
  { device: 'mobile', browser: 'Safari', ver: '17.5', os: 'iOS', w: 390, h: 844, vw: 390, vh: 664, dpr: 3, weight: 15 },
  { device: 'mobile', browser: 'Chrome', ver: '126.0', os: 'Android', w: 412, h: 915, vw: 412, vh: 780, dpr: 2.6, weight: 9 },
  { device: 'tablet', browser: 'Safari', ver: '17.5', os: 'iPadOS', w: 1024, h: 1366, vw: 1024, vh: 1290, dpr: 2, weight: 3 },
]
const PATHS = ['/', '/employee', '/positions', '/projects', '/contact', '/colophon', '/projects/kidcam', '/positions/ida-milk']
const SECTIONS = {
  '/': ['home.kpi', 'home.trend', 'home.recent', 'home.report', 'home.reminders'],
  '/employee': ['employee.primary', 'employee.details', 'employee.skills'],
  '/positions': ['positions.list'],
  '/projects': ['projects.list'],
  '/contact': ['contact.form', 'contact.info'],
  '/colophon': ['colophon.primary', 'colophon.notes'],
  '/projects/kidcam': ['project.primary', 'project.description'],
  '/positions/ida-milk': ['position.primary', 'position.summary'],
}
const REFERRERS = [null, null, null, 'https://www.linkedin.com/', 'https://www.google.com/', 'https://github.com/Riley-D-Betts', 'https://news.ycombinator.com/', 'https://www.bing.com/']
const SUBJECTS = ['Hiring / role inquiry', 'Contract / project work', 'Networking', 'Something else']
const UAS = {
  Chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  Safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  Firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
}

function pickWeighted(list) {
  const total = list.reduce((s, x) => s + x.weight, 0)
  let r = Math.random() * total
  for (const x of list) {
    r -= x.weight
    if (r <= 0) return x
  }
  return list[list.length - 1]
}
const pick = list => list[randomInt(0, list.length)]
const chance = p => Math.random() < p
const jitter = (base, spread) => Math.max(0, Math.round(base + (Math.random() - 0.5) * 2 * spread))

const q = (v) => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? '1' : '0'
  return `'${String(v).replace(/'/g, "''")}'`
}

/** Rows → `INSERT OR IGNORE INTO t (cols) VALUES (...), (...)` statements of ≤ 40 rows. */
function insertSql(table, cols, rows) {
  const out = []
  for (let i = 0; i < rows.length; i += 40) {
    const slice = rows.slice(i, i + 40)
    out.push(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES\n${slice.map(r => `  (${cols.map(c => q(r[c])).join(', ')})`).join(',\n')};`)
  }
  return out
}

function bulkSession(now, vidPool) {
  const org = pickWeighted(ORGS)
  const dev = pickWeighted(DEVICES)
  const isBot = chance(0.1)
  const startedAt = now - randomInt(0, 30 * 86_400_000)
  const nPages = isBot ? 1 : 1 + (chance(0.55) ? randomInt(1, 5) : 0)
  const returning = chance(0.3) && vidPool.length > 0
  const vid = returning ? pick(vidPool) : randomUUID()
  const sid = randomUUID()
  const ip = `${randomInt(11, 200)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`

  const pages = []
  const perf = []
  const events = []
  let t = startedAt
  let path = chance(0.8) ? '/' : pick(PATHS)
  let from = null
  let maxScroll = 0
  const c = {
    prints: 0, copies: 0, email_copies: 0, selects: 0, form_started: 0, form_submitted: 0, finds: 0, searches: 0,
    exit_intents: 0, rage_clicks: 0, dead_clicks: 0, right_clicks: 0, errors: 0, outbounds: 0, mailto_clicks: 0,
    hovers: 0, eggs: 0, subtabs: 0, hidden_ms: 0, blurs: 0, ptr_n: 0, touch_n: 0, key_n: 0,
  }
  for (let i = 0; i < nPages; i++) {
    const pvid = randomUUID()
    const active = isBot ? 0 : jitter(dev.device === 'mobile' ? 25_000 : 45_000, 20_000)
    const scroll = isBot ? 0 : pick([25, 50, 75, 90, 100, 100])
    maxScroll = Math.max(maxScroll, scroll)
    const kind = i === 0 ? (chance(0.9) ? 'initial' : 'reload') : chance(0.85) ? 'spa' : 'spa_back'
    const soft = i === 0 ? null : jitter(120, 80)
    pages.push({
      pvid, sid, path, entered_at: t, left_at: t + active + 2_000, from_path: from, nav_kind: kind, soft_nav_ms: soft,
      active_ms: active, hidden_ms: chance(0.2) ? jitter(8_000, 6_000) : 0, max_scroll_pct: scroll, scroll_px: Math.round(scroll * 30),
      scroll_reversals: randomInt(0, 4), max_scroll_vel: jitter(1_200, 800), sections_seen: Math.min(SECTIONS[path].length, 1 + randomInt(0, 3)),
      clicks: randomInt(0, 6), text_len: jitter(5_000, 3_000), console_errors: 0, leave_reason: i === nPages - 1 ? 'unload' : 'spa',
    })
    if (!isBot) {
      const lcp = jitter(dev.device === 'mobile' ? 1_800 : 1_100, 700)
      perf.push(i === 0
        ? {
            pvid, sid, ts: t, path, ttfb_ms: jitter(180, 120), fcp_ms: Math.round(lcp * 0.7), lcp_ms: lcp, lcp_sel: 'main > h1', lcp_size: jitter(14_000, 6_000),
            cls: Math.round(Math.random() * 0.12 * 1000) / 1000, inp_ms: jitter(90, 70), dns_ms: jitter(15, 12), connect_ms: jitter(30, 20), tls_ms: jitter(25, 15),
            request_ms: jitter(80, 40), response_ms: jitter(40, 30), dom_interactive_ms: jitter(600, 300), dcl_ms: jitter(650, 300), load_ms: jitter(1_100, 500),
            transfer_bytes: jitter(48_000, 10_000), encoded_bytes: jitter(46_000, 10_000), decoded_bytes: jitter(160_000, 30_000), redirects: 0,
            protocol: pick(['h2', 'h3', 'h3', 'http/1.1']), nav_type: kind === 'reload' ? 'reload' : 'navigate', res_count: jitter(14, 4), res_bytes: jitter(300_000, 80_000), res_cached: randomInt(0, 6),
            res_by_type: JSON.stringify({ script: 6, css: 1, font: 2, img: 2, fetch: 1, other: 2 }),
            res_slowest: JSON.stringify([{ name: 'fonts.gstatic.com/s/x.woff2', dur: jitter(200, 80), size: 30_000, type: 'font' }, { name: '/_nuxt/entry.js', dur: jitter(150, 60), size: 90_000, type: 'script' }]),
            long_tasks: randomInt(0, 3), long_task_ms: jitter(60, 50), long_task_max_ms: jitter(55, 40), loaf_count: randomInt(0, 2), loaf_ms: jitter(50, 40), loaf_max_ms: jitter(45, 30), loaf_script: '/_nuxt/entry.js', soft_nav_ms: null,
          }
        : { pvid, sid, ts: t, path, soft_nav_ms: soft })

      const add = (type, name, p, at) => events.push({ sid, ts: at, type, name, payload: p ? JSON.stringify(p) : null, path })
      add('pageview', null, { pvid, path, from, kind, ...(soft !== null ? { softNavMs: soft } : {}) }, t)
      let tt = t + 500
      for (const sec of SECTIONS[path].slice(0, pages[pages.length - 1].sections_seen)) {
        const dwell = jitter(Math.max(1_000, active / 3), 1_500)
        add('section_enter', sec, null, tt)
        add('section_exit', sec, { dwellMs: dwell, pvid }, tt + dwell)
        tt += dwell + 200
      }
      for (const m of [25, 50, 75, 90, 100]) if (m <= scroll) add('scroll_depth', null, { pct: m }, t + Math.round((active * m) / 100))
      for (let k = 0; k < pages[pages.length - 1].clicks; k++) {
        add('click', null, { sel: `[data-section="${pick(SECTIONS[path])}"] a`, text: 'View', x: randomInt(100, 1200), y: randomInt(100, 800), section: pick(SECTIONS[path]), tag: 'a', button: 0, kind: dev.device === 'mobile' ? 'touch' : 'pointer', mod: false }, t + randomInt(500, Math.max(600, active)))
        if (dev.device === 'mobile') c.touch_n++
        else c.ptr_n++
      }
      if (chance(0.06)) { add('rage_click', null, { n: 3, sel: '.ns-portlet__head', x: 300, y: 200, section: SECTIONS[path][0] }, t + 3_000); c.rage_clicks++ }
      if (chance(0.08)) { add('dead_click', null, { sel: '.ns-field__value', text: 'Boise, ID', section: SECTIONS[path][0] }, t + 4_000); c.dead_clicks++ }
      if (chance(0.05)) { add('js_error', null, { msg: 'ResizeObserver loop completed with undelivered notifications.', src: '/_nuxt/entry.js', line: 1, stack: '' }, t + 2_000); c.errors++ }
      if (chance(0.04)) { add('resource_error', null, { tag: 'img', src: '/missing.png', sel: 'img' }, t + 2_500); c.errors++ }
      if (chance(0.03)) { add('find', null, {}, t + 5_000); c.finds++ }
      if (chance(0.05)) { const term = pick(['kidcam', 'netsuite', 'sql', 'projects', 'contact']); add('site_search', term, { q: term, results: randomInt(0, 5) }, t + 6_000); c.searches++ }
      if (chance(0.1) && dev.device === 'desktop') { add('exit_intent', null, { x: randomInt(0, 1400), y: 0 }, t + active); c.exit_intents++ }
      if (chance(0.15) && dev.device === 'desktop') { const key = pick(['email', 'github', 'contact-cta', 'kpi:network-uptime']); add('hover', key, { ms: jitter(900, 500) }, t + 7_000); c.hovers++ }
      if (path === '/employee' && chance(0.4)) { add('subtab', pick(['Access', 'Communication', 'Related Records']), { index: randomInt(1, 4) }, t + 8_000); c.subtabs++ }
      if (chance(0.06)) { add('print', null, { phase: 'before' }, t + 9_000); add('print', null, { phase: 'after', ms: 2_500 }, t + 11_500); c.prints++ }
      if (chance(0.08)) { const hasEmail = chance(0.5); add('copy', null, { len: hasEmail ? EMAIL.length : 42, snippet: hasEmail ? EMAIL : 'IT Manager · Systems builder', hasEmail, section: SECTIONS[path][0], sel: 'a' }, t + 9_500); c.copies++; if (hasEmail) c.email_copies++ }
      if (chance(0.07)) { add('select', null, { len: 60, hasEmail: false, section: SECTIONS[path][0] }, t + 9_800); c.selects++ }
      if (chance(0.06)) { add('outbound', 'github.com', { href: 'https://github.com/Riley-D-Betts', label: 'GitHub', button: 0, newTab: true, zone: 'record-actions' }, t + 10_000); c.outbounds++ }
      if (path === '/contact') {
        if (chance(0.5)) {
          const subject = pick(SUBJECTS)
          add('form', 'contact', { step: 'focus' }, t + 2_000); c.form_started++
          add('form', 'contact', { step: 'input' }, t + 3_000)
          add('form', 'contact', { step: 'field', field: 'subject', subject, bodyLen: 0, authorFilled: false, msSinceFocus: 1_000 }, t + 4_000)
          if (chance(0.5)) {
            add('form', 'contact', { step: 'submit', subject, bodyLen: jitter(200, 120), authorFilled: chance(0.7), msSinceFocus: jitter(40_000, 20_000) }, t + 12_000); c.form_submitted++
          } else {
            add('form', 'contact', { step: 'abandon', msSinceFocus: jitter(20_000, 10_000) }, t + active)
          }
        }
        if (chance(0.3)) { add('outbound', 'mailto', { href: `mailto:${EMAIL}`, label: EMAIL, button: 0, newTab: false, section: 'contact.form' }, t + 13_000); c.outbounds++; c.mailto_clicks++ }
      }
      add('page_leave', null, { pvid, path, enteredAt: t, activeMs: active, hiddenMs: pages[pages.length - 1].hidden_ms, blurs: 0, maxScrollPct: scroll, scrollPx: Math.round(scroll * 30), scrollReversals: 0, maxScrollVel: 1_000, sectionsSeen: pages[pages.length - 1].sections_seen, clicks: pages[pages.length - 1].clicks, ptr: 0, touch: 0, key: 0, consoleErrors: 0, textLen: 5_000, reason: i === nPages - 1 ? 'unload' : 'spa' }, t + active + 2_000)
      c.hidden_ms += pages[pages.length - 1].hidden_ms
    }
    from = path
    t += active + 2_500
    let next = pick(PATHS)
    if (next === path) next = pick(PATHS)
    path = next
  }
  const lastSeen = t
  const heartbeats = isBot ? 0 : Math.floor(pages.reduce((s, p) => s + p.active_ms, 0) / HEARTBEAT_MS)
  const session = {
    sid, vid, started_at: startedAt, last_seen_at: lastSeen, duration_ms: heartbeats * HEARTBEAT_MS, ip,
    ua: isBot ? pick(['curl/8.0', 'python-requests/2.32', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)']) : UAS[dev.browser],
    browser: isBot ? 'Unknown' : dev.browser, browser_ver: isBot ? null : dev.ver, os: isBot ? 'Unknown' : dev.os, device_type: isBot ? 'desktop' : dev.device,
    screen_w: dev.w, screen_h: dev.h, viewport_w: dev.vw, viewport_h: dev.vh, dpr: dev.dpr, lang: org.country === 'DE' ? 'de-DE' : 'en-US',
    tz: org.country === 'US' ? pick(['America/Boise', 'America/Los_Angeles', 'America/New_York', 'America/Chicago']) : org.country === 'IN' ? 'Asia/Kolkata' : 'Europe/Berlin',
    country: org.country, region: org.region, city: org.city, lat: null, lon: null,
    referrer: pick(REFERRERS), utm_source: chance(0.1) ? 'linkedin' : null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null,
    entry_path: pages[0].path, pageviews: nPages, max_scroll_pct: maxScroll, is_bot: isBot ? 1 : 0, has_replay: 0,
    exit_path: pages[pages.length - 1].path, last_path: pages[pages.length - 1].path, nav_kind: pages[0].nav_kind, asn: org.asn, as_org: org.org,
    is_webdriver: isBot && chance(0.3) ? 1 : 0, gpc: chance(0.05) ? 1 : 0, dnt: 0, save_data: 0, is_tor: 0,
    ...c, first_interaction_ms: isBot ? null : jitter(1_800, 1_200), events_n: events.length, is_returning: returning ? 1 : 0, visit_n: returning ? 2 : 1,
  }
  const net = {
    sid, created_at: startedAt, colo: pick(['SEA', 'SLC', 'DEN', 'LAX', 'IAD', 'FRA']), http_protocol: pick(['HTTP/2', 'HTTP/3', 'HTTP/1.1']),
    tls_version: 'TLSv1.3', tls_cipher: 'AEAD-AES128-GCM-SHA256', client_rtt_ms: jitter(45, 35), rtt_kind: 'tcp', request_priority: null, accept_encoding: 'gzip, deflate, br',
    tls_ciphers_sha1: null, tls_ext_sha1: null, tls_hello_len: null, cf_ray: null, continent: org.country === 'US' || org.country === 'CA' ? 'NA' : org.country === 'IN' ? 'AS' : 'EU',
    region_code: org.region.slice(0, 2).toUpperCase(), postal_code: null, metro_code: null, cf_tz: session.tz, is_eu: org.country === 'DE' ? 1 : 0,
    bot_score: null, verified_bot: null, verified_bot_category: null, ja3_hash: null, ja4: null, client_trust_score: null,
    accept_language: session.lang === 'de-DE' ? 'de-DE,de;q=0.9,en;q=0.8' : 'en-US,en;q=0.9', ch_ua: dev.browser === 'Chrome' ? 'Chromium/126;Google Chrome/126' : null, ch_mobile: dev.device === 'mobile' ? 1 : 0, ch_platform: dev.os,
    fetch_site: pick(['none', 'cross-site', 'same-origin']), fetch_mode: 'navigate', fetch_dest: 'document', fetch_user: 1, doc_referer: null, early_data: 0,
    client_tz_offset_min: -360, cf_tz_offset_min: chance(0.9) ? -360 : -300, rdns_host: chance(0.2) && org.org ? `host-${randomInt(1, 999)}.${org.org.toLowerCase().replace(/[^a-z]+/g, '-')}.net` : null,
  }
  const env = isBot
    ? null
    : {
        sid, created_at: startedAt, webdriver: 0, ua_brands: dev.browser === 'Chrome' ? 'Chromium/126;Google Chrome/126' : null, ua_mobile: dev.device === 'mobile' ? 1 : 0, ua_platform: dev.os,
        ua_arch: dev.browser === 'Safari' || dev.browser === 'Firefox' ? null : 'x86', ua_bitness: '64', ua_model: null, ua_platform_ver: null, ua_full_versions: null, ua_form_factors: dev.device === 'mobile' ? 'Mobile' : 'Desktop', ua_wow64: 0,
        languages: session.lang === 'de-DE' ? 'de-DE,de,en' : 'en-US,en', max_touch_points: dev.device === 'desktop' ? 0 : 5, pdf_viewer: 1, cookies_enabled: 1, gpc_js: session.gpc, dnt_js: 0,
        gpu_vendor: pick(['Google Inc. (NVIDIA)', 'Google Inc. (Intel)', 'Google Inc. (AMD)', 'Apple']), gpu_renderer: pick(['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Apple M2', 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)']),
        webgpu_vendor: null, webgpu_arch: null, webgpu_device: null, webgpu_desc: null, battery_level: dev.device === 'desktop' ? null : randomInt(10, 100), battery_charging: dev.device === 'desktop' ? null : (chance(0.4) ? 1 : 0),
        storage_quota_mb: jitter(100_000, 50_000), storage_usage_mb: randomInt(0, 40), media_audioinput: randomInt(0, 3), media_videoinput: randomInt(0, 2), media_audiooutput: randomInt(0, 3),
        color_scheme: pick(['light', 'light', 'dark', 'none']), reduced_motion: chance(0.1) ? 1 : 0, contrast: 'none', forced_colors: 0, inverted_colors: 0, reduced_transparency: 0,
        avail_w: dev.w, avail_h: dev.h - 40, color_depth: 24, orientation: dev.device === 'mobile' ? 'portrait-primary' : 'landscape-primary',
        js_heap_limit_mb: dev.browser === 'Chrome' || dev.browser === 'Edge' ? 4096 : null, js_heap_used_mb: dev.browser === 'Chrome' || dev.browser === 'Edge' ? randomInt(20, 80) : null,
        net_type: dev.browser === 'Chrome' || dev.browser === 'Edge' ? pick(['wifi', 'cellular', 'ethernet']) : null, net_effective: dev.browser === 'Chrome' || dev.browser === 'Edge' ? pick(['4g', '4g', '3g']) : null, net_downlink: dev.browser === 'Chrome' ? 10 : null, net_rtt: dev.browser === 'Chrome' ? jitter(50, 40) : null, net_save_data: 0,
        voices: randomInt(0, 40), tz_name: session.tz, tz_offset_min: -360, intl_locale: session.lang, display_mode: 'browser',
        outer_w: dev.w, outer_h: dev.h, inner_w: dev.vw, inner_h: dev.vh, device_memory: pick([4, 8, 8, 16, 32]), cores: pick([4, 8, 8, 12, 16]), platform: dev.os, touch: dev.device === 'desktop' ? 0 : 1,
      }
  return { vid, visitor: { vid, first_seen_at: startedAt, last_seen_at: lastSeen, visit_count: 1, first_referrer: session.referrer, first_utm_source: session.utm_source, first_utm_medium: null, first_utm_campaign: null, first_as_org: org.org, first_country: org.country, first_entry_path: session.entry_path, last_as_org: org.org, last_country: org.country }, session, net, env, pages, perf, events }
}

const SESSION_COLS = [
  'sid', 'vid', 'started_at', 'last_seen_at', 'duration_ms', 'ip', 'ua', 'browser', 'browser_ver', 'os', 'device_type',
  'screen_w', 'screen_h', 'viewport_w', 'viewport_h', 'dpr', 'lang', 'tz', 'country', 'region', 'city', 'lat', 'lon',
  'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'entry_path', 'pageviews', 'max_scroll_pct', 'is_bot', 'has_replay',
  'exit_path', 'last_path', 'nav_kind', 'asn', 'as_org', 'is_webdriver', 'gpc', 'dnt', 'save_data', 'is_tor',
  'prints', 'copies', 'email_copies', 'selects', 'form_started', 'form_submitted', 'finds', 'searches', 'exit_intents', 'rage_clicks', 'dead_clicks', 'right_clicks',
  'errors', 'outbounds', 'mailto_clicks', 'hovers', 'eggs', 'subtabs', 'hidden_ms', 'blurs', 'ptr_n', 'touch_n', 'key_n', 'first_interaction_ms', 'events_n', 'is_returning', 'visit_n',
]
const VISITOR_COLS = ['vid', 'first_seen_at', 'last_seen_at', 'visit_count', 'first_referrer', 'first_utm_source', 'first_utm_medium', 'first_utm_campaign', 'first_as_org', 'first_country', 'first_entry_path', 'last_as_org', 'last_country']
const PAGE_VISIT_COLS = ['pvid', 'sid', 'path', 'entered_at', 'left_at', 'from_path', 'nav_kind', 'soft_nav_ms', 'active_ms', 'hidden_ms', 'max_scroll_pct', 'scroll_px', 'scroll_reversals', 'max_scroll_vel', 'sections_seen', 'clicks', 'text_len', 'console_errors', 'leave_reason']
const PAGE_PERF_COLS = ['pvid', 'sid', 'ts', 'path', 'ttfb_ms', 'fcp_ms', 'lcp_ms', 'lcp_sel', 'lcp_size', 'cls', 'inp_ms', 'dns_ms', 'connect_ms', 'tls_ms', 'request_ms', 'response_ms', 'dom_interactive_ms', 'dcl_ms', 'load_ms', 'transfer_bytes', 'encoded_bytes', 'decoded_bytes', 'redirects', 'protocol', 'nav_type', 'res_count', 'res_bytes', 'res_cached', 'res_by_type', 'res_slowest', 'long_tasks', 'long_task_ms', 'long_task_max_ms', 'loaf_count', 'loaf_ms', 'loaf_max_ms', 'loaf_script', 'soft_nav_ms']
const EVENT_COLS = ['sid', 'ts', 'type', 'name', 'payload', 'path']

async function seedBulk(n) {
  const now = Date.now()
  const visitors = new Map()
  const sessions = []
  const nets = []
  const envs = []
  const pages = []
  const perfs = []
  const events = []
  const vidPool = []
  for (let i = 0; i < n; i++) {
    const s = bulkSession(now, vidPool)
    const existing = visitors.get(s.vid)
    if (existing) {
      existing.visit_count++
      existing.last_seen_at = Math.max(existing.last_seen_at, s.visitor.last_seen_at)
      existing.first_seen_at = Math.min(existing.first_seen_at, s.visitor.first_seen_at)
      s.session.visit_n = existing.visit_count
      s.session.is_returning = 1
    } else {
      visitors.set(s.vid, s.visitor)
      if (!s.session.is_bot) vidPool.push(s.vid)
    }
    sessions.push(s.session)
    nets.push(s.net)
    if (s.env) envs.push(s.env)
    pages.push(...s.pages)
    perfs.push(...s.perf)
    events.push(...s.events)
  }
  // FK order: visitors → sessions → session_net / session_env → page_visits → page_perf → events
  const sql = [
    `-- generated by scripts/seed-visit.mjs --bulk ${n} at ${new Date(now).toISOString()}`,
    ...insertSql('visitors', VISITOR_COLS, [...visitors.values()]),
    ...insertSql('sessions', SESSION_COLS, sessions),
    ...insertSql('session_net', Object.keys(nets[0]), nets),
    ...(envs.length ? insertSql('session_env', Object.keys(envs[0]), envs) : []),
    ...insertSql('page_visits', PAGE_VISIT_COLS, pages),
    ...insertSql('page_perf', PAGE_PERF_COLS, perfs),
    ...insertSql('events', EVENT_COLS, events),
  ].join('\n')
  const outDir = resolve('.wrangler')
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, 'bulk.sql')
  writeFileSync(file, sql)
  console.log(`bulk: wrote ${file} (${sessions.length} sessions, ${visitors.size} visitors, ${pages.length} page_visits, ${perfs.length} page_perf, ${events.length} events, ${(sql.length / 1024).toFixed(0)} KiB)`)

  const before = withDb(db => count(db, 'SELECT COUNT(*) AS n FROM sessions')) ?? 0
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'resume-analytics', '--local', '--file', file], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  check('bulk: wrangler d1 execute --local --file succeeded', r.status === 0, r.status === 0 ? `${out.split('\n').filter(l => /queries|rows/i.test(l)).join(' ').trim().slice(0, 120)}` : out.slice(-600))
  const after = withDb(db => count(db, 'SELECT COUNT(*) AS n FROM sessions')) ?? 0
  check(`bulk: sessions grew by ${n}`, after - before === n, `${before} → ${after}`)
  withDb((db) => {
    check('bulk: every bulk session has a session_net row', count(db, 'SELECT COUNT(*) AS n FROM sessions s WHERE NOT EXISTS (SELECT 1 FROM session_net n WHERE n.sid = s.sid)') === 0)
    check('bulk: no page_visits / events orphaned from sessions (FK order held)', count(db, 'SELECT COUNT(*) AS n FROM page_visits p WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s.sid = p.sid)') === 0 && count(db, 'SELECT COUNT(*) AS n FROM events e WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s.sid = e.sid)') === 0)
  })
}

// ---------------------------------------------------------------- --ops

async function seedOps() {
  const password = process.env.OPS_PASSWORD || 'test'
  const login = async pw => fetch(`${baseUrl}/api/ops/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': CHROME_UA, 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ password: pw }),
  })
  let res = await login(password)
  if (res.status === 401 && password !== 'dev') {
    console.log('info  OPS_PASSWORD rejected — retrying with the dev fallback password')
    res = await login('dev')
  }
  check('ops: POST /api/ops/login accepted (200)', res.status === 200, `status ${res.status}${res.status === 503 ? ' — NUXT_ADMIN_PASSWORD not set on a non-dev server' : ''}`)
  const rbops = cookieFrom(res, 'rbops')
  check('ops: login set the rbops session cookie', typeof rbops === 'string' && rbops.length > 10)
  if (!rbops) return
  const headers = { 'content-type': 'application/json', 'user-agent': CHROME_UA, 'x-forwarded-for': RUN_IP, cookie: `rbops=${rbops}`, 'x-rb-ops': '1' }
  const sql = (statement, extra = {}) => fetch(`${baseUrl}/api/ops/sql`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify({ sql: statement }) })

  const ok = await sql('SELECT COUNT(*) AS n FROM sessions')
  const body = await ok.json().catch(() => null)
  check('ops: SELECT COUNT(*) AS n FROM sessions → 200', ok.status === 200, `status ${ok.status} ${JSON.stringify(body)?.slice(0, 120)}`)
  check("ops: result columns = ['n']", Array.isArray(body?.columns) && body.columns.length === 1 && body.columns[0] === 'n', JSON.stringify(body?.columns))
  check('ops: result rowsRead is a number', typeof body?.rowsRead === 'number', `got ${body?.rowsRead}`)
  check('ops: result row holds a numeric count', typeof body?.rows?.[0]?.[0] === 'number', `got ${JSON.stringify(body?.rows?.[0])}`)

  const del = await sql('DELETE FROM sessions')
  const delBody = await del.json().catch(() => null)
  check('ops: DELETE FROM sessions → 400 with { error }', del.status === 400 && typeof delBody?.error === 'string', `status ${del.status} ${JSON.stringify(delBody)?.slice(0, 100)}`)
  const semi = await sql('SELECT 1; SELECT 2')
  check('ops: SELECT 1; SELECT 2 → 400 (one statement only)', semi.status === 400, `status ${semi.status}`)
  const comment = await sql('SELECT 1 AS one -- trailing comment')
  check('ops: SELECT 1 -- comment → 200 (comments are whitespace)', comment.status === 200, `status ${comment.status}`)
  const noHeader = await fetch(`${baseUrl}/api/ops/sql`, { method: 'POST', headers: { ...headers, 'x-rb-ops': '0' }, body: JSON.stringify({ sql: 'SELECT 1' }) })
  check('ops: SQL console without x-rb-ops: 1 → 400', noHeader.status === 400, `status ${noHeader.status}`)
  const anon = await fetch(`${baseUrl}/api/ops/sql`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-rb-ops': '1', 'x-forwarded-for': RUN_IP }, body: JSON.stringify({ sql: 'SELECT 1' }) })
  check('ops: SQL console without the session cookie → 401', anon.status === 401, `status ${anon.status}`)

  const exp = await fetch(`${baseUrl}/api/ops/export?entity=sessions&format=csv&range=all&limit=5`, { headers })
  const csv = await exp.text()
  check('ops: GET /api/ops/export?entity=sessions&format=csv → 200 attachment', exp.status === 200 && /attachment/.test(exp.headers.get('content-disposition') ?? ''), `status ${exp.status} ${exp.headers.get('content-disposition')}`)
  check('ops: export carries x-rb-rows and a CSV header line', /^\d+$/.test(exp.headers.get('x-rb-rows') ?? '') && csv.split('\n')[0].includes('sid'), `x-rb-rows ${exp.headers.get('x-rb-rows')} first line ${csv.split('\n')[0].slice(0, 40)}`)
}

// ---------------------------------------------------------------- main

async function main() {
  console.log(`seed-visit: server=${baseUrl} db=${dbPath ?? '(not found)'} client-ip=${RUN_IP}`)
  const health = await fetch(`${baseUrl}/api/health`).catch(() => null)
  check('server: GET /api/health answers 200', health?.status === 200, `status ${health?.status ?? 'unreachable'}`)
  if (!health) throw new Error('server unreachable')

  const flagged = bulkN !== null || opsMode
  if (!flagged) await seedVisit()
  if (bulkN !== null) await seedBulk(bulkN)
  if (opsMode) await seedOps()

  console.log(failures === 0
    ? `\nseed-visit: all ${passes} checks passed`
    : `\nseed-visit: ${failures} check(s) FAILED, ${passes} passed`)
  if (!flagged) console.log('note: the burst step exhausted the per-IP collect rate limit for this run\'s client address (x-forwarded-for) — the browser at 127.0.0.1 is unaffected unless NUXT_TRUST_PROXY is off; wait ~60 s before re-running the seed.')
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(`FAIL  seed-visit crashed: ${err?.message ?? err}`)
  console.error('      is the server running? start it with: npm run dev (or npm run preview after a build)')
  process.exit(1)
})
