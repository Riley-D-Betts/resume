// Share links: the token grammar and its collision retry, the preview-agent
// table that names WHICH platform unfurled a link, the capture statement's
// "unknown token writes nothing" guarantee, and the forwarded heuristic —
// which is deliberately evidence ("3 people · 2 organisations"), never a
// verdict, because the design has no per-visitor token to prove more.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isBotUA } from '../../server/utils/bots.ts'
import { PREVIEW_PLATFORMS, classifyFetch } from '../../server/utils/previewAgents.ts'
import {
  SHARE_HIT_SQL,
  SHARE_TOKEN_ALPHABET,
  SHARE_TOKEN_LEN,
  SHARE_TOKEN_TRIES,
  isForwarded,
  isShareToken,
  mintShareToken,
  newShareToken,
  refererHost,
} from '../../server/utils/share.ts'
import { foldShareLinks, shareHitKind, shareHitRollupSql, shareSessionRollupSql, shareUrl } from '../../server/utils/shareOps.ts'
import { migratedDb, seedSession } from './_memdb.ts'

// ---------------------------------------------------------------------------
// 1. Who fetched the link
// ---------------------------------------------------------------------------

const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

/** The twelve platforms the table can name, with a real-world UA for each. */
const UNFURLS: Array<[platform: string, ua: string]> = [
  ['Slack', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
  ['Slack', 'Slackbot 1.0 (+https://api.slack.com/robots)'],
  ['Teams', 'SkypeUriPreview Preview/0.5 skype-url-preview@microsoft.com'],
  ['LinkedIn', 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/3.1 +http://www.linkedin.com)'],
  ['WhatsApp', 'WhatsApp/2.23.20.0 A'],
  ['Telegram', 'TelegramBot (like TwitterBot)'],
  ['Discord', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
  ['Facebook', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
  ['X', 'Mozilla/5.0 (compatible; Twitterbot/1.0)'],
  ['Google', 'Mozilla/5.0 (compatible; Google-PageRenderer; Google-Read-Aloud; +http://www.google.com/bot.html)'],
  ['Bing', 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) BingPreview/1.0b'],
  ['Apple', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1)'],
  ['Mastodon', 'http.rb/5.1.1 (Mastodon/4.2.1; +https://mastodon.social/)'],
]

test('classifyFetch names every preview platform, and only those', () => {
  assert.equal(PREVIEW_PLATFORMS.length, 12, `platforms: ${PREVIEW_PLATFORMS.join(', ')}`)
  const named = new Set<string>()
  for (const [platform, ua] of UNFURLS) {
    const c = classifyFetch(ua)
    assert.deepEqual(c, { kind: 'unfurl', agent: platform }, ua)
    named.add(platform)
  }
  assert.deepEqual([...named].sort(), [...PREVIEW_PLATFORMS].sort(), 'every platform in the table has a case here')

  // A person on a real browser is a view; automation nothing names is a bot;
  // an absent UA is automation too (nothing legitimate omits it).
  assert.deepEqual(classifyFetch(BROWSER), { kind: 'view', agent: null })
  assert.deepEqual(classifyFetch('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36'), { kind: 'view', agent: null })
  assert.deepEqual(classifyFetch('curl/8.4.0'), { kind: 'bot', agent: null })
  assert.deepEqual(classifyFetch('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), { kind: 'bot', agent: null })
  assert.deepEqual(classifyFetch(''), { kind: 'bot', agent: null })
  assert.deepEqual(classifyFetch(null), { kind: 'bot', agent: null })
})

test('isBotUA no longer passes the four preview agents through as humans', () => {
  for (const ua of [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.23.20.0 A',
    'http.rb/5.1.1 (Mastodon/4.2.1; +https://mastodon.social/)',
    'Mozilla/5.0 (compatible; Google-PageRenderer; +http://www.google.com/bot.html)',
  ]) {
    assert.equal(isBotUA(ua), true, ua)
  }
  assert.equal(isBotUA(BROWSER), false, 'a real browser is still not a bot')
})

// ---------------------------------------------------------------------------
// 2. The token
// ---------------------------------------------------------------------------

test('token grammar: 4 unambiguous lowercase characters, no l / 1 / o / 0', () => {
  assert.equal(SHARE_TOKEN_ALPHABET.length, 32)
  for (const bad of ['l', '1', 'o', '0']) {
    assert.ok(!SHARE_TOKEN_ALPHABET.includes(bad), `${bad} must not be mintable`)
  }
  // 4 000 draws: every character is in the alphabet and the shape never varies.
  for (let i = 0; i < 1000; i++) {
    const t = newShareToken()
    assert.equal(t.length, SHARE_TOKEN_LEN)
    assert.ok(isShareToken(t), t)
    for (const ch of t) assert.ok(SHARE_TOKEN_ALPHABET.includes(ch), `${ch} not in the alphabet`)
  }
  // The extremes of the random source stay inside the alphabet.
  assert.equal(newShareToken(() => 0), 'aaaa')
  assert.equal(newShareToken(() => 0.999999), '9999')
  assert.equal(newShareToken(() => 1), '9999', 'a degenerate rand() cannot index past the end')

  assert.equal(isShareToken('7fq2'), true)
  for (const bad of ['7fq', '7fq22', '7FQ2', '7fq-', 'loo0', '', null, undefined, 42]) {
    assert.equal(isShareToken(bad), false, String(bad))
  }
})

test('mintShareToken retries past collisions and gives up rather than looping', async () => {
  // Deterministic source: aaaa, bbbb, cccc, … one distinct token per call.
  let n = 0
  const rand = (): number => {
    const i = Math.floor(n++ / SHARE_TOKEN_LEN)
    return i / SHARE_TOKEN_ALPHABET.length
  }
  const seen: string[] = []
  const taken = new Set(['aaaa', 'bbbb'])
  const token = await mintShareToken(async (t) => {
    seen.push(t)
    return taken.has(t)
  }, rand)
  assert.deepEqual(seen, ['aaaa', 'bbbb', 'cccc'], 'each collision costs exactly one more attempt')
  assert.equal(token, 'cccc')

  // Everything taken: null after SHARE_TOKEN_TRIES, never an endless loop.
  let tries = 0
  const none = await mintShareToken(async () => {
    tries++
    return true
  })
  assert.equal(none, null)
  assert.equal(tries, SHARE_TOKEN_TRIES)
})

test('refererHost keeps the host and nothing else', () => {
  assert.equal(refererHost('https://WWW.LinkedIn.com/feed/update/123?x=1'), 'linkedin.com')
  assert.equal(refererHost('https://app.slack.com/client/T1/C2'), 'app.slack.com')
  assert.equal(refererHost('http://localhost:3200/'), 'localhost')
  for (const bad of ['', '   ', 'not a url', null, undefined]) assert.equal(refererHost(bad), null, String(bad))
})

// ---------------------------------------------------------------------------
// 3. The capture statement
// ---------------------------------------------------------------------------

const HIT = (db: ReturnType<typeof migratedDb>, token: string, kind: string, agent: string | null, org: string | null, country: string | null, ts = 1_700_000_000_000): void => {
  // 9 params: the 8 columns plus the token again for the EXISTS guard.
  db.prepare(SHARE_HIT_SQL).run(token, ts, kind, agent, org, country, null, '/', token)
}

test('an unknown token writes nothing: `?k=` cannot be walked to create rows', () => {
  const db = migratedDb()
  db.prepare("INSERT INTO share_links (token, label, created_at) VALUES ('7fq2', 'Jane Okafor — Acme', 1)").run()

  HIT(db, 'zzzz', 'view', null, null, 'US')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM share_hits').get() as { n: number }).n, 0, 'no row for a token nobody minted')

  HIT(db, '7fq2', 'view', null, 'Acme Corp', 'US')
  const row = db.prepare('SELECT * FROM share_hits').get() as Record<string, unknown>
  assert.equal(row.token, '7fq2')
  assert.equal(row.kind, 'view')
  assert.equal(row.path, '/')
  assert.ok(!('ip' in row) && !('ua' in row), 'no IP and no raw user agent columns exist at all')
  db.close()
})

// ---------------------------------------------------------------------------
// 4. Forwarded — evidence, not a verdict
// ---------------------------------------------------------------------------

test('isForwarded: more than one reader OR more than one organisation', () => {
  assert.equal(isForwarded(0, 0), false, 'never opened')
  assert.equal(isForwarded(1, 1), false, 'the one person it was sent to')
  assert.equal(isForwarded(2, 1), true, 'two readers inside one company')
  assert.equal(isForwarded(1, 2), true, 'one reader identity seen from two organisations')
  assert.equal(isForwarded(0, 2), true, 'unfurled in two places, nobody clicked yet')
})

test('shareHitKind falls back to automation for anything unexpected', () => {
  assert.equal(shareHitKind('view'), 'view')
  assert.equal(shareHitKind('unfurl'), 'unfurl')
  assert.equal(shareHitKind('bot'), 'bot')
  assert.equal(shareHitKind('nonsense'), 'bot')
  assert.equal(shareHitKind(null), 'bot')
})

test('the rollups run on real SQLite and fold into the console rows', () => {
  const db = migratedDb()
  const now = 1_700_000_000_000
  db.prepare("INSERT INTO share_links (token, label, channel, created_at) VALUES ('7fq2', 'Jane Okafor — Acme', 'email', ?)").run(now)
  db.prepare("INSERT INTO share_links (token, label, created_at, revoked) VALUES ('mk93', 'Recruiter, Northwind', ?, 1)").run(now)

  // 7fq2: unfurled in Slack, then opened by two people at two organisations.
  HIT(db, '7fq2', 'unfurl', 'Slack', null, null, now + 1000)
  HIT(db, '7fq2', 'view', null, 'Acme Corp', 'US', now + 2000)
  HIT(db, '7fq2', 'view', null, 'Northwind Traders', 'GB', now + 3000)
  HIT(db, '7fq2', 'bot', null, null, 'US', now + 4000)
  // mk93: minted and revoked, never opened.

  // Two sessions on 7fq2 — two distinct vids — plus a bot session that must
  // not count as a reader.
  const link = (sid: string) => db.prepare("UPDATE session_net SET share_token = '7fq2' WHERE sid = ?").run(sid)
  for (const [sid, vid, isBot] of [['s-1', 'v-1', 0], ['s-2', 'v-2', 0], ['s-3', 'v-3', 1]] as const) {
    seedSession(db, sid, { vid, isBot, startedAt: now })
    db.prepare('INSERT INTO session_net (sid, created_at) VALUES (?, ?)').run(sid, now)
    link(sid)
  }

  const rows = (sql: string, ...args: unknown[]): Record<string, unknown>[] =>
    db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[]

  const links = rows('SELECT token, label, note, channel, created_at, revoked FROM share_links ORDER BY created_at DESC, token')
  const folded = foldShareLinks(links, rows(shareHitRollupSql()), rows(shareSessionRollupSql()), 'https://rileybetts.dev')
  const jane = folded.find((l) => l.token === '7fq2')!
  assert.equal(jane.label, 'Jane Okafor — Acme')
  assert.equal(jane.url, shareUrl('https://rileybetts.dev', '7fq2'))
  assert.deepEqual([jane.opens, jane.views, jane.unfurls, jane.bots], [4, 2, 1, 1])
  assert.deepEqual(jane.platforms, ['Slack'])
  assert.deepEqual([...jane.orgs].sort(), ['Acme Corp', 'Northwind Traders'])
  assert.deepEqual([...jane.countries].sort(), ['GB', 'US'])
  assert.equal(jane.readers, 2, 'the bot session has a vid but is not a reader')
  assert.equal(jane.sessions, 2)
  assert.equal(jane.forwarded, true)
  assert.equal(jane.firstHit, now + 1000)
  assert.equal(jane.lastHit, now + 4000)
  assert.equal(jane.revoked, false)

  const other = folded.find((l) => l.token === 'mk93')!
  assert.deepEqual([other.opens, other.readers, other.sessions, other.forwarded, other.revoked], [0, 0, 0, false, true])
  assert.equal(other.firstHit, null)

  // The single-token form of both rollups agrees with the grouped one.
  const oneHit = rows(shareHitRollupSql(true), '7fq2')
  const oneSess = rows(shareSessionRollupSql(true), '7fq2')
  const onlyJane = foldShareLinks(links.filter((l) => l.token === '7fq2'), oneHit, oneSess, 'https://rileybetts.dev')
  assert.deepEqual(onlyJane[0], jane)
  db.close()
})
