// Pins contract C.5: every /api/collect statement stays under D1's 100
// bound-parameter cap, binds exactly the documented number, and is valid SQL
// against the migrated schema (prepare() on node:sqlite, the engine under D1).
// Also exercises the bindChecked guard (d1.ts) and runs the real ingest
// mapping (sanitize.ts → collectBind.ts → the SQL) end to end on node:sqlite.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import {
  EVENTS_ROWS_PER_STATEMENT,
  EVENT_COLUMNS,
  PAGE_PERF_COLUMNS,
  PAGE_PERF_SQL,
  PAGE_VISIT_COLUMNS,
  PAGE_VISITS_SQL,
  COLLECT_PARAM_COUNTS,
  COLLECT_SESSION_COLUMNS,
  SESSION_ENV_COLUMNS,
  SESSION_ENV_SQL,
  SESSION_NET_COLUMNS,
  SESSION_NET_SQL,
  SESSION_SQL,
  COLLECT_STATEMENTS,
  VISITORS_SQL,
  eventsSql,
} from '../../server/utils/collectSql.ts'
import { D1_MAX_PARAMS, checkArgs, countPlaceholders } from '../../server/utils/d1.ts'
import { isEmptyEnvelope, parseEnvelope } from '../../server/utils/sanitize.ts'
import { buildCollectBinds, type CollectFacts } from '../../server/utils/collectBind.ts'
import { parseUA } from '../../server/utils/ua.ts'
import { offsetMin } from '../../server/utils/tz.ts'
import { EVENT_TYPES } from '../../shared/analytics/events.ts'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

/** Same splitter as migrations.test.ts: `;` outside strings and comments. */
function splitStatements(sql: string): string[] {
  const out: string[] = []
  let buf = ''
  let state: 'code' | 'string' | 'line' | 'block' = 'code'
  const push = (): void => {
    const s = buf.trim()
    if (s.length > 0) out.push(s)
    buf = ''
  }
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i] as string
    const next = sql[i + 1]
    if (state === 'code') {
      if (ch === '-' && next === '-') {
        state = 'line'
        i++
      } else if (ch === '/' && next === '*') {
        state = 'block'
        i++
      } else if (ch === "'") {
        state = 'string'
        buf += ch
      } else if (ch === ';') {
        push()
      } else {
        buf += ch
      }
    } else if (state === 'string') {
      buf += ch
      if (ch === "'") {
        if (next === "'") {
          buf += next
          i++
        } else {
          state = 'code'
        }
      }
    } else if (state === 'line') {
      if (ch === '\n') {
        state = 'code'
        buf += '\n'
      }
    } else if (ch === '*' && next === '/') {
      state = 'code'
      i++
    }
  }
  assert.equal(state, 'code', 'unterminated string literal or comment')
  push()
  return out
}

function migrated(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
  assert.ok(files.length >= 3, 'expected migrations 0001..0003')
  for (const f of files) {
    for (const s of splitStatements(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))) db.exec(s)
  }
  return db
}

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((r) => r.name)
}

test('countPlaceholders skips string literals, comments and quoted identifiers', () => {
  assert.equal(countPlaceholders("SELECT '?' AS q, \"?\" AS i, 1 -- ?\n FROM t /* ? */ WHERE a = ? AND b = ?"), 2)
  assert.equal(countPlaceholders("INSERT INTO t VALUES ('it''s ?', ?)"), 1)
  assert.equal(countPlaceholders('UPDATE t SET a = ?1 WHERE b = ?1'), 1)
  assert.equal(countPlaceholders('SELECT ?1, ?2, ?7'), 7)
  assert.equal(countPlaceholders('SELECT 1'), 0)
})

test('every statement binds ≤ 100 distinct placeholders and exactly the documented number', (t) => {
  for (const { name, sql } of COLLECT_STATEMENTS) {
    const n = countPlaceholders(sql)
    t.diagnostic(`${name}: ${n} params`)
    assert.ok(n <= D1_MAX_PARAMS, `${name} binds ${n} > ${D1_MAX_PARAMS}`)
    assert.equal(n, COLLECT_PARAM_COUNTS[name], `${name}: SQL has ${n} placeholders, COLLECT_PARAM_COUNTS says ${COLLECT_PARAM_COUNTS[name]}`)
  }
  // The headline numbers from contract C.5 / plan.
  assert.deepEqual(
    { ...COLLECT_PARAM_COUNTS },
    {
      visitors: 13,
      sessions: 70,
      session_net: 39,
      session_env: 62,
      page_visits: 19,
      page_perf: 38,
      events_chunk: 96,
      precheck: 1,
      ip_cap: 2,
      honeypot_check: 3,
    },
  )
})

test('every statement prepares against the migrated schema (syntax + column check)', () => {
  const db = migrated()
  for (const { name, sql } of COLLECT_STATEMENTS) {
    assert.doesNotThrow(() => db.prepare(sql), `${name} failed to prepare`)
  }
  for (let n = 1; n <= EVENTS_ROWS_PER_STATEMENT; n++) {
    assert.doesNotThrow(() => db.prepare(eventsSql(n)), `eventsSql(${n})`)
    assert.equal(countPlaceholders(eventsSql(n)), n * EVENT_COLUMNS.length)
  }
  assert.throws(() => eventsSql(0))
  assert.throws(() => eventsSql(EVENTS_ROWS_PER_STATEMENT + 1))
  db.close()
})

test('bind-order column lists match the live tables', () => {
  const db = migrated()
  const sessions = columns(db, 'sessions')
  assert.equal(sessions.length, 71)
  const bound = COLLECT_SESSION_COLUMNS.map((c) => c.split(':')[0] as string)
  assert.equal(bound.length, 70)
  for (const c of bound) assert.ok(sessions.includes(c), `sessions.${c}`)
  // 70 bound + has_replay literal = every column exactly once.
  assert.deepEqual([...bound, 'has_replay'].sort(), [...sessions].sort())

  assert.deepEqual([...SESSION_NET_COLUMNS], columns(db, 'session_net'))
  assert.deepEqual([...SESSION_ENV_COLUMNS], columns(db, 'session_env'))
  assert.deepEqual([...PAGE_VISIT_COLUMNS], columns(db, 'page_visits'))
  assert.deepEqual([...PAGE_PERF_COLUMNS], columns(db, 'page_perf'))
  const events = columns(db, 'events')
  for (const c of EVENT_COLUMNS) assert.ok(events.includes(c), `events.${c}`)
  db.close()
})

test('the batch runs end to end on node:sqlite with the documented arity and merges like the contract says', () => {
  const db = migrated()
  const sid = '11111111-1111-4111-8111-111111111111'
  const vid = '22222222-2222-4222-8222-222222222222'
  const now = 1_700_000_000_000

  const visitorsArgs = [vid, now, now, 'https://x.test/', null, null, null, null, 'US', '/', null, 'US', sid]
  assert.equal(visitorsArgs.length, COLLECT_PARAM_COUNTS.visitors)
  db.prepare(VISITORS_SQL).run(...(visitorsArgs as never[]))

  const sessionArgs = (startedAt: number, pageviews: number, exitPath: string | null) => {
    const a: unknown[] = []
    for (const c of COLLECT_SESSION_COLUMNS) {
      const col = c.split(':')[0] as string
      switch (col) {
        case 'sid': a.push(sid); break
        case 'vid': a.push(vid); break
        case 'started_at': a.push(startedAt); break
        case 'last_seen_at': a.push(startedAt); break
        case 'is_returning': case 'visit_n': a.push(vid); break
        case 'pageviews': a.push(pageviews); break
        case 'exit_path': case 'last_path': a.push(exitPath); break
        case 'entry_path': a.push(exitPath); break
        case 'ip': a.push('203.0.113.7'); break
        case 'ua': a.push('ua'); break
        case 'browser': case 'browser_ver': case 'os': case 'device_type': case 'lang': case 'tz':
        case 'country': case 'region': case 'city': case 'referrer': case 'utm_source': case 'utm_medium':
        case 'utm_campaign': case 'utm_term': case 'utm_content': case 'nav_kind': case 'as_org':
          a.push(null); break
        case 'screen_w': case 'screen_h': case 'viewport_w': case 'viewport_h': case 'dpr': case 'lat': case 'lon':
        case 'asn': case 'first_interaction_ms':
          a.push(null); break
        default: a.push(0) // counters and flags
      }
    }
    return a
  }
  const first = sessionArgs(now + 5000, 1, '/')
  assert.equal(first.length, COLLECT_PARAM_COUNTS.sessions)
  db.prepare(SESSION_SQL).run(...(first as never[]))
  // An earlier-stamped envelope arriving second: started_at = MIN, counters add, exit_path guarded.
  const second = sessionArgs(now, 2, '/late')
  db.prepare(SESSION_SQL).run(...(second as never[]))
  const s = db.prepare('SELECT started_at, last_seen_at, pageviews, exit_path, is_returning, visit_n FROM sessions WHERE sid = ?').get(sid) as Record<string, unknown>
  assert.equal(s.started_at, now)
  assert.equal(s.last_seen_at, now + 5000)
  assert.equal(s.pageviews, 3)
  assert.equal(s.exit_path, '/', 'older envelope must not overwrite exit_path')
  assert.equal(s.is_returning, 0)
  assert.equal(s.visit_n, 1)

  // A second visitors upsert for an EXISTING sid does not bump visit_count (B9).
  db.prepare(VISITORS_SQL).run(...(visitorsArgs as never[]))
  assert.equal((db.prepare('SELECT visit_count FROM visitors WHERE vid = ?').get(vid) as { visit_count: number }).visit_count, 1)
  // …but for a new sid it does.
  db.prepare(VISITORS_SQL).run(...([...visitorsArgs.slice(0, 12), 'other-sid-0000000000'] as never[]))
  assert.equal((db.prepare('SELECT visit_count FROM visitors WHERE vid = ?').get(vid) as { visit_count: number }).visit_count, 2)
  db.close()
})

test('checkArgs coerces undefined / NaN / booleans and reports arity problems', () => {
  const sql = 'INSERT INTO t (a, b, c) VALUES (?, ?, ?)'
  const clean = checkArgs(sql, [1, 'x', null])
  assert.deepEqual(clean.problems, [])
  const bad = checkArgs(sql, [undefined, Number.NaN, true])
  assert.deepEqual(bad.args, [null, null, 1])
  assert.equal(bad.problems.length, 2)
  assert.ok(checkArgs(sql, [1, 2]).problems.some((p) => /placeholders/.test(p)))
  const tooMany = checkArgs(eventsSql(16), new Array(101).fill(0))
  assert.ok(tooMany.problems.some((p) => /> 100/.test(p)))
})

// ---------------------------------------------------------------------------
// Ingest mapping end to end: sanitize → binds → SQL, on node:sqlite.
// ---------------------------------------------------------------------------

const CF = {
  asn: 395747, asOrg: null, country: 'US', region: 'Texas', city: 'Austin', lat: 30.27, lon: -97.74, isTor: 0 as const,
  colo: 'DFW', httpProtocol: 'HTTP/1.1', tlsVersion: 'TLSv1.3', tlsCipher: null, clientRttMs: null, rttKind: null,
  requestPriority: null, acceptEncoding: null, tlsCiphersSha1: null, tlsExtSha1: null, tlsHelloLen: null,
  continent: 'NA', regionCode: 'TX', postalCode: '78701', metroCode: '635', cfTz: 'America/Chicago', isEu: null,
  botScore: 99, verifiedBot: 0 as const, verifiedBotCategory: null, ja3Hash: 'abc', ja4: null, clientTrustScore: 99,
}
const HDR = {
  cfRay: null, acceptLanguage: 'en-US,en;q=0.9', gpc: 0 as const, dnt: 0 as const, saveData: 0 as const,
  chUa: 'Chromium/126;Google Chrome/126', chMobile: 0 as const, chPlatform: 'Windows',
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** Run the collect batch the way collect.post.ts does, with checkArgs on every statement. */
function persist(db: DatabaseSync, parsed: NonNullable<ReturnType<typeof parseEnvelope>>, opts: { isNew: boolean; bot?: boolean; heartbeats?: number; now: number }) {
  const bot = opts.bot ?? false
  const facts: CollectFacts = {
    now: opts.now, storeIp: '203.0.113.9', ua: UA, dev: parseUA(UA, { maxTouchPoints: parsed.maxTouchPoints }), cf: CF, hdr: HDR, bot,
    heartbeats: opts.heartbeats ?? parsed.heartbeats, rows: bot ? [] : parsed.events, cfTzOffsetMin: offsetMin(CF.cfTz, opts.now), rdnsHost: null,
  }
  const binds = buildCollectBinds(parsed, facts)
  const exec = (label: string, sql: string, args: unknown[]): void => {
    const { args: clean, problems } = checkArgs(sql, args)
    assert.deepEqual(problems, [], `${label}: ${problems.join('; ')}`)
    db.prepare(sql).run(...(clean as never[]))
  }
  if (opts.isNew) exec('visitors', VISITORS_SQL, binds.visitors)
  exec('sessions', SESSION_SQL, binds.session)
  exec('session_net', SESSION_NET_SQL, binds.net)
  if (!bot) {
    if (binds.env) exec('session_env', SESSION_ENV_SQL, binds.env)
    for (const a of binds.pageVisits) exec('page_visits', PAGE_VISITS_SQL, a)
    for (const a of binds.pagePerf) exec('page_perf', PAGE_PERF_SQL, a)
    for (let i = 0; i < binds.events.length; i += EVENTS_ROWS_PER_STATEMENT) {
      const chunk = binds.events.slice(i, i + EVENTS_ROWS_PER_STATEMENT)
      exec(`events×${chunk.length}`, eventsSql(chunk.length), chunk.flat())
    }
  }
  return binds
}

const get = (db: DatabaseSync, sql: string, ...a: unknown[]): Record<string, unknown> => db.prepare(sql).get(...(a as never[])) as Record<string, unknown>

test('ingest mapping: every event type flows through sanitize → binds → SQL with the documented arity', () => {
  const db = migrated()
  const now = 1_800_000_000_000
  const t0 = now - 60_000
  const sid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const vid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const pv1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const pv2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const ev = (type: string, p: unknown, extra: Record<string, unknown> = {}, dt = 0) => ({ t: t0 + dt, type, name: null, u: '/', p, ...extra })
  const env = {
    webdriver: false, uad: { brands: 'Chromium/126;Google Chrome/126', mobile: false, platform: 'Windows' },
    uadHi: { architecture: 'x86', bitness: '64', model: '', platformVersion: '15.0.0', fullVersionList: 'Chromium/126.0.1', formFactors: 'Desktop', wow64: false },
    languages: 'en-US,en', maxTouchPoints: 0, pdfViewer: true, cookies: true, gpc: false, dnt: false,
    gpu: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA)' }, webgpu: null, battery: { level: 88, charging: true },
    storage: { quotaMb: 120000, usageMb: 3 }, media: { audioinput: 1, videoinput: 1, audiooutput: 1 },
    prefers: { scheme: 'dark', reducedMotion: false, contrast: 'none', forcedColors: false, invertedColors: false, reducedTransparency: false },
    screen: { availW: 2560, availH: 1400, colorDepth: 24, orientation: 'landscape-primary' }, memory: { limitMb: 4096, usedMb: 40 },
    net: { type: 'wifi', effectiveType: '4g', downlink: 10, rtt: 50, saveData: false }, voices: 20, tz: { name: 'America/Boise', offsetMin: -360 },
    locale: 'en-US', display: 'browser', outer: { w: 2560, h: 1360 }, inner: { w: 2540, h: 1250 }, deviceMemory: 8, cores: 12, platform: 'Win32', touch: false,
    bogus: 'dropped',
  }
  const events = [
    ev('pageview', { pvid: pv1, path: '/', from: null, kind: 'initial', referrer: 'https://www.linkedin.com/', utm: { source: 'li' }, screen: { w: 2560, h: 1440, dpr: 1 }, viewport: { w: 2540, h: 1250 }, tz: 'America/Boise', tzOffsetMin: -360, lang: 'en-US',
      nav: { site: 'cross-site', mode: 'navigate', dest: 'document', user: true, referer: 'https://www.linkedin.com/', ray: '8a1b2c3d4e5f6071-SLC', earlyData: false } }),
    ev('env', env, {}, 100),
    ev('vitals', { pvid: pv1, ttfb: 120, fcp: 400, lcp: 700, lcpSel: 'main>img', lcpSize: 12000, cls: 0.01, inp: 40 }, {}, 200),
    ev('perf', { pvid: pv1, nav: { dns: 1, connect: 2, tls: 3, request: 50, response: 60, domInteractive: 300, dcl: 350, load: 500, transfer: 40000, encoded: 39000, decoded: 120000, redirects: 0, protocol: 'h2', type: 'navigate' },
      resources: { count: 12, bytes: 300000, cached: 4, byType: { script: 4, css: 1, font: 2, img: 3, fetch: 1, other: 1 }, slowest: [{ name: '/_nuxt/entry.js', dur: 80, size: 90000, type: 'script' }, { name: 'bad?name', dur: 1, size: 1, type: 'x' }] },
      longTasks: { count: 2, totalMs: 120, longestMs: 90 }, loaf: { count: 1, totalMs: 70, longestMs: 70, script: '/_nuxt/entry.js' } }, {}, 250),
    ev('first_interaction', { ms: 1500, kind: 'pointer' }, {}, 1500),
    ev('section_enter', undefined, { name: 'home.kpi' }, 1600),
    ev('scroll_depth', { pct: 50 }, {}, 2500),
    ev('heartbeat', { pvid: pv1, activeMs: 15000, maxScrollPct: 50 }, {}, 15000),
    ev('click', { sel: 'a.x', text: 'Employee', x: 10, y: 20, tag: 'a', button: 0, kind: 'pointer', href: '/employee', mod: false, zone: 'nav' }, {}, 16000),
    ev('click', { sel: 'p', text: '', x: 10, y: 20, tag: 'p', button: 2, kind: 'pointer', mod: false }, {}, 16100),
    ev('hover', { ms: 800 }, { name: 'email' }, 16200),
    ev('hover', { ms: 800 }, { name: 'evil key' }, 16300),
    ev('section_exit', { dwellMs: 14_000, pvid: pv1 }, { name: 'home.kpi' }, 17000),
    ev('page_leave', { pvid: pv1, path: '/', enteredAt: t0, activeMs: 17_000, hiddenMs: 0, blurs: 0, maxScrollPct: 55, scrollPx: 1200, scrollReversals: 2, maxScrollVel: 900, sectionsSeen: 3, clicks: 2, ptr: 2, touch: 0, key: 0, consoleErrors: 0, textLen: 4200, reason: 'spa' }, {}, 17100),
    ev('pageview', { pvid: pv2, path: '/employee', from: '/', kind: 'spa', softNavMs: 90 }, { u: '/employee' }, 17200),
    ev('subtab', { index: 2 }, { name: 'Skills', u: '/employee' }, 18000),
    ev('visibility', { state: 'hidden', ms: 18000, pvid: pv2, activeMs: 800, maxScrollPct: 10 }, { u: '/employee' }, 18100),
    ev('viewport', { w: 1200, h: 800, scale: 1, dpr: 1, orientation: 'landscape-primary', cause: 'resize' }, { u: '/employee' }, 19000),
    ev('rage_click', { n: 4, sel: 'button.dead', x: 1, y: 1 }, { u: '/employee' }, 19500),
    ev('dead_click', { sel: 'button.dead', text: 'Save' }, { u: '/employee' }, 19600),
    ev('outbound', { href: 'https://github.com/x', label: 'GitHub', button: 0, newTab: true }, { name: 'github.com', u: '/employee' }, 20000),
    ev('outbound', { href: 'mailto:riley@example.com', label: 'email', button: 0, newTab: false }, { name: 'mailto', u: '/employee' }, 20100),
    ev('print', { phase: 'before' }, { u: '/employee' }, 21000),
    ev('print', { phase: 'after', ms: 3000 }, { u: '/employee' }, 24000),
    ev('copy', { len: 40, snippet: 'riley@example.com', hasEmail: true, sel: 'a' }, { u: '/employee' }, 25000),
    ev('select', { len: 300, hasEmail: false }, { u: '/employee' }, 25100),
    ev('form', { step: 'focus', field: 'body' }, { name: 'contact', u: '/contact' }, 26000),
    ev('form', { step: 'submit', subject: 'Job', bodyLen: 120, authorFilled: true, msSinceFocus: 40000 }, { name: 'contact', u: '/contact' }, 26500),
    ev('form', { step: 'submit' }, { name: 'other', u: '/contact' }, 26600),
    ev('find', undefined, { u: '/contact' }, 27000),
    ev('site_search', { q: 'NetSuite', results: 3, chosen: 'Employee' }, { u: '/contact' }, 27500),
    ev('exit_intent', { x: 500, y: -2 }, { u: '/contact' }, 28000),
    ev('js_error', { msg: 'boom chrome-extension://abcdefghijklmnop/x.js', src: 'chrome-extension://abcdefghijklmnop/x.js', line: 1, stack: 'at chrome-extension://abcdefghijklmnop/x.js:1' }, { u: '/contact' }, 28100),
    ev('resource_error', { tag: 'img', src: 'moz-extension://abc-def/x.png', sel: 'img.x' }, { u: '/contact' }, 28200),
    ev('console_error', { msg: 'safari-web-extension://abc/x' }, { u: '/contact' }, 28300),
    ev('easter_egg', undefined, { name: 'konami', u: '/contact' }, 28400),
    ev('replay_stopped', { reason: 'cap' }, { u: '/contact' }, 28500),
    ev('replay_chunk_lost', { seq: 3, rid: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 413 }, { u: '/contact' }, 28600),
    ev('bogus_type', {}, {}, 28700),
    { t: 'nope', type: 'click', name: null, u: '/', p: {} },
  ]
  const covered = new Set(events.map((e) => e.type))
  for (const t of EVENT_TYPES) assert.ok(covered.has(t), `fixture lacks ${t}`)

  const parsed = parseEnvelope({ v: 2, vid, sid, returning: false, url: '/', events }, now)
  assert.ok(parsed)
  assert.equal(isEmptyEnvelope(parsed), false)
  assert.equal(parsed.pageviews, 2)
  assert.equal(parsed.heartbeats, 1)
  assert.deepEqual([parsed.entryPath, parsed.exitPath, parsed.lastPath, parsed.navKind], ['/', '/employee', '/contact', 'initial'])
  assert.deepEqual(parsed.counters, {
    prints: 1, copies: 1, emailCopies: 1, selects: 1, formStarted: 1, formSubmitted: 1, finds: 1, searches: 1,
    exitIntents: 1, rageClicks: 1, deadClicks: 1, rightClicks: 1, errors: 3, outbounds: 2, mailtoClicks: 1, hovers: 1, eggs: 1, subtabs: 1,
  })
  assert.equal(parsed.firstInteractionMs, 1500)
  assert.equal(parsed.docFacts?.site, 'cross-site')
  assert.equal(parsed.docFacts?.ray, '8a1b2c3d4e5f6071-SLC')
  assert.equal(parsed.clientTzOffsetMin, -360)
  const types = parsed.events.map((e) => e.type)
  for (const t of ['heartbeat', 'env', 'vitals', 'perf', 'bogus_type']) assert.ok(!types.includes(t as never), `${t} must not become a row`)
  assert.equal(types.filter((t) => t === 'hover').length, 1, 'bad hover key dropped')
  assert.equal(types.filter((t) => t === 'form').length, 2, 'non-contact form dropped')
  assert.equal(types.filter((t) => t === 'click').length, 2, 'NaN-t click dropped')
  for (const t of ['js_error', 'resource_error', 'console_error']) {
    const e = parsed.events.find((x) => x.type === t)!
    assert.ok(e.payload!.includes('<ext>') && !e.payload!.includes('abcdefghijklmnop'), `${t}: extension URL scrubbed`)
  }
  assert.equal(parsed.pageVisits.get(pv1)?.activeMs, 17_000)
  assert.equal(parsed.pageVisits.get(pv1)?.leaveReason, 'spa')
  assert.equal(parsed.pageVisits.get(pv2)?.fromPath, '/')
  assert.equal(parsed.pageVisits.get(pv2)?.leftAt, t0 + 18100)
  assert.equal(parsed.pagePerf.get(pv1)?.lcp, 700)
  assert.equal(JSON.parse(parsed.pagePerf.get(pv1)!.resSlowest!).length, 1, 'bad resource name dropped')
  assert.equal(parsed.pagePerf.get(pv2)?.softNavMs, 90)
  assert.equal(parsed.env?.cores, 12)
  assert.ok(parsed.env && !('bogus' in parsed.env))

  const binds = persist(db, parsed, { isNew: true, now })
  assert.equal(binds.visitors.length, COLLECT_PARAM_COUNTS.visitors)
  assert.equal(binds.session.length, COLLECT_PARAM_COUNTS.sessions)
  assert.equal(binds.net.length, COLLECT_PARAM_COUNTS.session_net)
  assert.equal(binds.env?.length, COLLECT_PARAM_COUNTS.session_env)
  assert.equal(binds.pageVisits[0]?.length, COLLECT_PARAM_COUNTS.page_visits)
  assert.equal(binds.pagePerf[0]?.length, COLLECT_PARAM_COUNTS.page_perf)

  const s1 = get(db, 'SELECT * FROM sessions WHERE sid = ?', sid)
  assert.equal(s1.pageviews, 2)
  assert.equal(s1.duration_ms, 15000)
  assert.equal(s1.entry_path, '/')
  assert.equal(s1.exit_path, '/employee')
  assert.equal(s1.last_path, '/contact')
  assert.equal(s1.is_returning, 0)
  assert.equal(s1.visit_n, 1)
  assert.equal(s1.browser, 'Chrome')
  assert.equal(s1.asn, 395747)
  assert.equal(s1.as_org, null, 'miniflare "" → null')
  assert.equal(s1.mailto_clicks, 1)
  assert.equal(s1.right_clicks, 1)
  assert.equal(s1.first_interaction_ms, 1500)
  assert.equal(s1.events_n, parsed.events.length)
  const n1 = get(db, 'SELECT * FROM session_net WHERE sid = ?', sid)
  assert.equal(n1.fetch_site, 'cross-site')
  assert.equal(n1.doc_referer, 'https://www.linkedin.com/')
  assert.equal(n1.client_tz_offset_min, -360)
  assert.equal(n1.cf_tz_offset_min, offsetMin('America/Chicago', now))
  assert.equal(n1.ch_ua, 'Chromium/126;Google Chrome/126')
  const e1 = get(db, 'SELECT * FROM session_env WHERE sid = ?', sid)
  assert.equal(e1.gpu_vendor, 'Google Inc. (NVIDIA)')
  assert.equal(e1.color_scheme, 'dark')
  assert.equal(e1.tz_offset_min, -360)
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM events WHERE sid = ?', sid).n, parsed.events.length)
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM events WHERE sid = ? AND path IS NULL', sid).n, 0)
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM page_visits WHERE sid = ?', sid).n, 2)
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM page_perf WHERE sid = ?', sid).n, 2)

  // Second envelope (merge path): heartbeats + a later page_leave for pv2 + a third pageview.
  const pv3 = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  const parsed2 = parseEnvelope({ v: 2, vid, sid, returning: false, url: '/contact', events: [
    ev('heartbeat', { pvid: pv2, activeMs: 30000, maxScrollPct: 80 }, { u: '/employee' }, 30000),
    ev('page_leave', { pvid: pv2, path: '/employee', enteredAt: t0 + 17200, activeMs: 31000, hiddenMs: 500, blurs: 1, maxScrollPct: 85, scrollPx: 3000, scrollReversals: 4, maxScrollVel: 1200, sectionsSeen: 5, clicks: 6, ptr: 6, touch: 0, key: 3, consoleErrors: 1, textLen: 9000, reason: 'spa' }, { u: '/employee' }, 31000),
    ev('pageview', { pvid: pv3, path: '/contact', from: '/employee', kind: 'spa', softNavMs: 40 }, { u: '/contact' }, 31100),
  ] }, now + 40_000)
  assert.ok(parsed2)
  persist(db, parsed2, { isNew: false, heartbeats: 2, now: now + 40_000 })
  const s2 = get(db, 'SELECT * FROM sessions WHERE sid = ?', sid)
  assert.equal(s2.pageviews, 3)
  assert.equal(s2.duration_ms, 45000)
  assert.equal(s2.started_at, now, 'started_at = first receipt')
  assert.equal(s2.last_seen_at, now + 40_000)
  assert.equal(s2.entry_path, '/')
  assert.equal(s2.exit_path, '/contact')
  assert.equal(s2.hidden_ms, 500)
  assert.equal(s2.visit_n, 1, 'visit_n untouched on merge')
  const v2 = get(db, 'SELECT * FROM page_visits WHERE pvid = ?', pv2)
  assert.equal(v2.active_ms, 31000)
  assert.equal(v2.max_scroll_pct, 85)
  assert.equal(v2.left_at, t0 + 31000)
  assert.equal(v2.leave_reason, 'spa')
  assert.equal(v2.from_path, '/')
  assert.equal(v2.soft_nav_ms, 90)
  assert.equal(get(db, 'SELECT visit_count FROM visitors WHERE vid = ?', vid).visit_count, 1)

  // Second session of the same visitor: visit_count 2 → is_returning 1, visit_n 2 (B8 / B9).
  const sidB = '99999999-9999-4999-8999-999999999999'
  const parsedB = parseEnvelope({ v: 2, vid, sid: sidB, returning: true, url: '/', events: [ev('pageview', { pvid: 'aaaaaaaa-1111-4111-8111-111111111111', path: '/', from: null, kind: 'initial' })] }, now)
  persist(db, parsedB!, { isNew: true, now })
  const sB = get(db, 'SELECT is_returning, visit_n FROM sessions WHERE sid = ?', sidB)
  assert.deepEqual([sB.is_returning, sB.visit_n], [1, 2])
  assert.equal(get(db, 'SELECT visit_count FROM visitors WHERE vid = ?', vid).visit_count, 2)

  // Bot session (D25): sessions + session_net only.
  const sidBot = '77777777-7777-4777-8777-777777777777'
  const parsedBot = parseEnvelope({ v: 2, vid: '66666666-6666-4666-8666-666666666666', sid: sidBot, returning: false, url: '/', events: [
    ev('pageview', { pvid: 'aaaaaaaa-2222-4222-8222-222222222222', path: '/', from: null, kind: 'initial' }), ev('env', env), ev('click', { sel: 'a', text: '', x: 1, y: 1, tag: 'a', button: 0, kind: 'pointer', mod: false }),
  ] }, now)
  persist(db, parsedBot!, { isNew: true, bot: true, now })
  assert.equal(get(db, 'SELECT is_bot FROM sessions WHERE sid = ?', sidBot).is_bot, 1)
  for (const t of ['events', 'page_visits', 'page_perf', 'session_env']) assert.equal(get(db, `SELECT COUNT(*) AS n FROM ${t} WHERE sid = ?`, sidBot).n, 0, t)
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM session_net WHERE sid = ?', sidBot).n, 1)

  // v1 envelope: server-minted pvid, envelope url as the path, boot_* dropped, heartbeat merged.
  const sidV1 = '55555555-5555-4555-8555-555555555555'
  const parsedV1 = parseEnvelope({ v: 1, vid: '44444444-4444-4444-8444-444444444444', sid: sidV1, returning: false, url: '/positions', events: [
    { t: t0, type: 'pageview', name: null, p: { referrer: '', screen: { w: 390, h: 844, dpr: 3 }, viewport: { w: 390, h: 700 }, tz: 'Asia/Kolkata', lang: 'en-IN', platform: 'iPhone', touch: true } },
    { t: t0 + 1, type: 'heartbeat', name: null, p: {} },
    { t: t0 + 2, type: 'boot_done', name: null },
    { t: t0 + 3, type: 'section_enter', name: 'skills' },
  ] }, now)
  assert.ok(parsedV1)
  assert.equal(parsedV1.pageviews, 1)
  assert.equal(parsedV1.entryPath, '/positions')
  assert.match([...parsedV1.pageVisits.values()][0]!.pvid, /^[0-9a-f-]{36}$/)
  assert.equal(parsedV1.events.length, 2)
  persist(db, parsedV1, { isNew: true, now })
  assert.equal(get(db, 'SELECT entry_path FROM sessions WHERE sid = ?', sidV1).entry_path, '/positions')
  db.close()
})

test('envelope validation and plausibility clamps (A33)', () => {
  const now = 1_800_000_000_000
  const sid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const vid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const pv1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const ev = (type: string, p: unknown, extra: Record<string, unknown> = {}, dt = 0) => ({ t: now - 1000 + dt, type, name: null, u: '/', p, ...extra })
  assert.equal(parseEnvelope({ v: 3, vid, sid, returning: false, url: '/', events: [] }, now), null)
  assert.equal(parseEnvelope({ v: 2, vid: 'x', sid, returning: false, url: '/', events: [] }, now), null)
  assert.equal(parseEnvelope({ v: 2, vid, sid, returning: 'yes', url: '/', events: [] }, now), null)
  assert.equal(parseEnvelope({ v: 2, vid, sid, returning: false, url: '', events: [] }, now), null)
  assert.equal(parseEnvelope({ v: 2, vid, sid, returning: false, url: '/', events: {} }, now), null)
  assert.equal(isEmptyEnvelope(parseEnvelope({ v: 2, vid, sid, returning: false, url: '/', events: [] }, now)!), true)
  assert.equal(isEmptyEnvelope(parseEnvelope({ v: 2, vid, sid, returning: false, url: '/', events: [ev('heartbeat', {})] }, now)!), false)

  const big = parseEnvelope({ v: 2, vid, sid, returning: false, url: '/x?y=1', events: [
    ev('section_exit', { dwellMs: 99e9, pvid: pv1 }, { name: 'a.b' }),
    ev('vitals', { pvid: pv1, ttfb: 9e9, fcp: -5, lcp: 1e6, cls: 400, inp: 130000 }),
    ev('click', { sel: 'a', text: 'x', x: 1, y: 1, tag: 'a', button: 0, kind: 'pointer', mod: false }, { u: '/bad?q' }),
    ...Array.from({ length: 12 }, (_, i) => ev('scroll_depth', { pct: 100 }, {}, i)),
    ...Array.from({ length: 30 }, (_, i) => ev('heartbeat', { pvid: pv1, activeMs: 9e9 }, {}, i)),
  ] }, now)!
  assert.equal(JSON.parse(big.events.find((e) => e.type === 'section_exit')!.payload!).dwellMs, 6 * 3600 * 1000)
  assert.deepEqual(
    [big.pagePerf.get(pv1)!.ttfb, big.pagePerf.get(pv1)!.fcp, big.pagePerf.get(pv1)!.lcp, big.pagePerf.get(pv1)!.cls, big.pagePerf.get(pv1)!.inp],
    [120000, 0, 120000, 10, 120000],
  )
  assert.equal(big.events.filter((e) => e.type === 'scroll_depth').length, 5, 'PAGE_CAPS re-applied per envelope')
  assert.equal(big.heartbeats, 30, 'the wall-clock heartbeat cap is applied by the handler')
  assert.equal(big.pageVisits.get(pv1)!.activeMs, 6 * 3600 * 1000)
  assert.equal(big.events.find((e) => e.type === 'click')!.path, '/', 'invalid u and invalid url both fall back to /')
})

test('parseUA: audit A30 additions', () => {
  const cases: Array<[string, number | null, string, string, string]> = [
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36', null, 'Samsung Internet', 'Android', 'mobile'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 5, 'Safari', 'iPadOS', 'tablet'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 0, 'Safari', 'macOS', 'desktop'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]', null, 'LinkedIn app', 'iOS', 'mobile'],
    ['Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.0;]', null, 'Facebook app', 'Android', 'mobile'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0', null, 'Instagram app', 'iOS', 'mobile'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Vivaldi/6.8', null, 'Vivaldi', 'Windows', 'desktop'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaBrowser/24.6.0.0 Safari/537.36', null, 'Yandex', 'Windows', 'desktop'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15', null, 'DuckDuckGo', 'iOS', 'mobile'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0', null, 'Edge', 'Windows', 'desktop'],
    ['Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1', null, 'Safari', 'iPadOS', 'tablet'],
    ['curl/8.0', null, 'Unknown', 'Unknown', 'bot'],
    ['', null, 'Unknown', 'Unknown', 'bot'],
    ['SomethingWeird/1.0', null, 'Unknown', 'Unknown', 'desktop'],
  ]
  for (const [ua, tp, browser, os, device] of cases) {
    const r = parseUA(ua, { maxTouchPoints: tp })
    assert.deepEqual([r.browser, r.os, r.deviceType], [browser, os, device], ua)
  }
})
