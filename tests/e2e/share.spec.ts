import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, request, test } from '@playwright/test'
import type { APIRequestContext, Cookie, Page } from '@playwright/test'

/**
 * Share links (docs/ANALYTICS.md §11): mint a link for one named recipient,
 * then prove what the server records when it is opened.
 *
 * The assertions go straight to the local D1 SQLite file, because the point of
 * this feature is what lands SERVER-SIDE on the document request — no
 * client-side JavaScript takes part, and a preview bot never runs any.
 *
 * Desktop only, and it shares the rbops cookie ops.spec cached: the login
 * endpoint allows 5 attempts a minute per IP, successes included.
 */

const OPS_PASSWORD = process.env.OPS_PASSWORD || 'test'
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const COOKIE_FILE = path.join(process.cwd(), 'test-results', 'ops-cookies.json')
const SLACK_UA = 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'
/** Well-formed (the grammar accepts it) but never minted. */
const UNMINTED = 'zzzz'

test.skip(({ isMobile }) => isMobile, 'the share console is asserted once, on desktop')

// ---------------------------------------------------------------- local D1

/** Newest real .sqlite under miniflare's local D1 state (never metadata.sqlite). */
function findLocalD1(): string | undefined {
  if (process.env.D1_DB_PATH) return path.resolve(process.env.D1_DB_PATH)
  const dir = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
  if (!existsSync(dir)) return undefined
  const files = readdirSync(dir).filter(f => /^[0-9a-f]{64}\.sqlite$/.test(f))
  if (files.length === 0) return undefined
  files.sort((a, b) => statSync(path.join(dir, b)).mtimeMs - statSync(path.join(dir, a)).mtimeMs)
  return path.join(dir, files[0]!)
}

/** Poll the local D1 file until `query` returns something or the deadline hits. */
async function pollDb<T>(timeoutMs: number, query: (db: DatabaseSync) => T | undefined): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let db: DatabaseSync | undefined
    try {
      const dbPath = findLocalD1()
      if (dbPath) {
        db = new DatabaseSync(dbPath, { readOnly: true })
        const out = query(db)
        if (out !== undefined) return out
      }
    } catch {
      // the file is created lazily and may be mid-write — keep polling
    } finally {
      db?.close()
    }
    if (Date.now() >= deadline) return undefined
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

/** One read of the local D1 file (no polling); undefined when it is unreadable. */
function readDb<T>(query: (db: DatabaseSync) => T): T | undefined {
  const dbPath = findLocalD1()
  if (!dbPath) return undefined
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return query(db)
  } finally {
    db.close()
  }
}

interface HitRow {
  id: number
  kind: string
  agent: string | null
  path: string | null
  referrer_host: string | null
}

const hitsOf = (db: DatabaseSync, token: string): HitRow[] =>
  db.prepare('SELECT id, kind, agent, path, referrer_host FROM share_hits WHERE token = ? ORDER BY id').all(token) as unknown as HitRow[]

// ------------------------------------------------------------------- admin

let cachedCookies: Cookie[] | null = null

function cookieHeader(cookies: Cookie[]): string {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

async function stillAdmin(cookies: Cookie[]): Promise<boolean> {
  const api = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { cookie: cookieHeader(cookies) } })
  try {
    const me = await api.get('/api/ops/me')
    return me.ok() && ((await me.json()) as { admin?: boolean }).admin === true
  } catch {
    return false
  } finally {
    await api.dispose()
  }
}

/** The rbops cookie ops.spec cached, re-validated; one API login when there is none. */
async function adminCookies(): Promise<Cookie[]> {
  let have = cachedCookies
  if (!have) {
    try {
      const parsed = JSON.parse(readFileSync(COOKIE_FILE, 'utf8')) as Cookie[]
      have = Array.isArray(parsed) && parsed.length > 0 ? parsed : null
    } catch {
      have = null
    }
  }
  if (have && (await stillAdmin(have))) {
    cachedCookies = have
    return have
  }
  const api = await request.newContext({ baseURL: BASE_URL })
  const res = await api.post('/api/ops/login', { data: { password: OPS_PASSWORD } })
  expect(res.status(), 'POST /api/ops/login').toBe(200)
  const cookies = (await api.storageState()).cookies.filter(c => c.name === 'rbops') as Cookie[]
  await api.dispose()
  expect(cookies.length, 'login set the rbops cookie').toBeGreaterThan(0)
  cachedCookies = cookies
  try {
    mkdirSync(path.dirname(COOKIE_FILE), { recursive: true })
    writeFileSync(COOKIE_FILE, JSON.stringify(cookies))
  } catch {
    // the module cache still holds them
  }
  return cookies
}

async function adminApi(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { cookie: cookieHeader(await adminCookies()) } })
}

/** A plain HTTP client with a chosen user agent — no browser, no JavaScript. */
async function fetcher(ua: string): Promise<APIRequestContext> {
  return request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'user-agent': ua, 'accept': 'text/html' } })
}

// --------------------------------------------------------------- the link

/** Minted once for the whole file; every test reads the same link. */
let token = ''
let linkUrl = ''

test.beforeAll(async () => {
  const api = await adminApi()
  try {
    const res = await api.post('/api/ops/share', {
      data: { label: 'Playwright Recruiter — E2E', channel: 'email', note: 'minted by tests/e2e/share.spec.ts' },
    })
    expect(res.status(), 'POST /api/ops/share').toBe(200)
    const body = (await res.json()) as { token: string; url: string }
    token = body.token
    linkUrl = body.url
  } finally {
    await api.dispose()
  }
  expect(token, 'the minted token uses the unambiguous alphabet').toMatch(/^[a-km-np-z2-9]{4}$/)
  expect(linkUrl).toContain(`/?k=${token}`)
})

const IGNORED_CONSOLE
  = /net::ERR|Failed to load resource: the server responded with a status of/

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text())) errors.push(msg.text())
  })
  page.on('pageerror', err => errors.push(String(err)))
  return errors
}

// ---------------------------------------------------------------- 1. a person

test('a browser opening the link is recorded as a VIEW and gets the rb_k cookie', async ({ page, context }) => {
  await page.goto(`/?k=${token}`)
  await expect(page.getByText('Welcome, Riley')).toBeVisible({ timeout: 20_000 })

  // The join into /api/collect: server-set, HttpOnly, no client JS involved.
  const rbk = (await context.cookies()).find(c => c.name === 'rb_k')
  expect(rbk?.value, 'the document response set rb_k').toBe(token)
  expect(rbk?.httpOnly, 'rb_k is HttpOnly').toBe(true)

  // The row is written AFTER the response (waitUntil), so poll for it.
  const hit = await pollDb(20_000, (db) => {
    const rows = hitsOf(db, token)
    return rows.length > 0 ? rows[rows.length - 1] : undefined
  })
  expect(hit, 'a share_hits row for the opened link').toBeTruthy()
  expect(hit!.kind).toBe('view')
  expect(hit!.agent).toBeNull()
  expect(hit!.path).toBe('/')

  // No IP and no raw user agent are stored — the columns do not even exist.
  const cols = readDb(db => (db.prepare('PRAGMA table_info("share_hits")').all() as Array<{ name: string }>).map(r => r.name))
  expect(cols).toBeTruthy()
  expect(cols).not.toContain('ip')
  expect(cols).not.toContain('ua')
})

// ---------------------------------------------------------------- 2. a preview bot

test('a Slack unfurl is recorded as UNFURL naming Slack, and an unminted token writes nothing', async () => {
  const before = readDb(db => hitsOf(db, token).length) ?? 0

  const slack = await fetcher(SLACK_UA)
  const unfurl = await slack.get(`/?k=${token}`)
  expect(unfurl.status()).toBe(200)
  await slack.dispose()

  const named = await pollDb(20_000, (db) => {
    const rows = hitsOf(db, token).filter(r => r.kind === 'unfurl')
    return rows.length > 0 ? rows[rows.length - 1] : undefined
  })
  expect(named, 'an unfurl hit').toBeTruthy()
  expect(named!.agent).toBe('Slack')

  // A well-formed token nobody minted: the INSERT … WHERE EXISTS makes it a
  // no-op, so `?k=` cannot be walked to write rows.
  const plain = await fetcher('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15')
  const unknown = await plain.get(`/?k=${UNMINTED}`)
  expect(unknown.status(), 'the page still renders normally').toBe(200)
  // (The cookie IS still set: the capture never reads share_links on the hot
  // path, by design. An orphan token is invisible everywhere downstream —
  // every rollup joins through share_links.)
  // Barrier: a LATER hit on the real link must have landed before we can call
  // the unminted one absent.
  const after = await plain.get(`/?k=${token}`)
  expect(after.status()).toBe(200)
  await plain.dispose()
  const landed = await pollDb(20_000, (db) => (hitsOf(db, token).length > before + 1 ? true : undefined))
  expect(landed, 'the barrier hit landed').toBe(true)

  expect(readDb(db => hitsOf(db, UNMINTED).length), 'no row for a token nobody minted').toBe(0)
})

test('an opted-out browser is not recorded, by query parameter or by cookie', async () => {
  const before = readDb(db => hitsOf(db, token).length) ?? 0
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

  // The footer promises "?optout=1 to any URL to opt out". The tracker's own
  // flag lives in localStorage, which a middleware cannot read, so the capture
  // honours the parameter on the request that opts out and the rb_optout
  // cookie the tracker mirrors it into afterwards.
  const optingOut = await fetcher(UA)
  expect((await optingOut.get(`/?k=${token}&optout=1`)).status()).toBe(200)
  await optingOut.dispose()

  const optedOut = await request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { 'user-agent': UA, 'accept': 'text/html', 'cookie': 'rb_optout=1' },
  })
  expect((await optedOut.get(`/?k=${token}`)).status()).toBe(200)
  await optedOut.dispose()

  // Barrier: a hit that MUST be recorded, so "nothing landed" is a real
  // absence rather than a race against waitUntil.
  const plain = await fetcher(UA)
  expect((await plain.get(`/?k=${token}`)).status()).toBe(200)
  await plain.dispose()
  const landed = await pollDb(20_000, (db) => (hitsOf(db, token).length > before ? true : undefined))
  expect(landed, 'the barrier hit landed').toBe(true)

  expect(readDb(db => hitsOf(db, token).length), 'exactly one hit: both opted-out requests wrote nothing').toBe(before + 1)
})

// ---------------------------------------------------------------- 3. the session join

test('a browse that started on the link lands session_net.share_token', async ({ page }) => {
  await page.goto(`/?k=${token}`)
  await expect(page.getByText('Welcome, Riley')).toBeVisible({ timeout: 20_000 })
  // The tracker flushes on a 5 s timer; the first envelope carries the cookie.
  await page.waitForResponse(r => r.url().includes('/api/collect'), { timeout: 30_000 })

  const attributed = await pollDb(20_000, (db) => {
    const row = db.prepare('SELECT COUNT(*) AS n FROM session_net WHERE share_token = ?').get(token) as { n: number }
    return row.n > 0 ? row.n : undefined
  })
  expect(attributed, 'the link resolves to a real session').toBeGreaterThan(0)
})

// ---------------------------------------------------------------- 4. the console

test('/ops/share renders the link with its counts, the Slack badge and the hit log', async ({ page, context }) => {
  const errors = collectErrors(page)
  await context.addCookies(await adminCookies())
  await page.goto('/ops/share')

  const row = page.getByTestId('share-row').filter({ hasText: token })
  await expect(row).toHaveCount(1, { timeout: 25_000 })
  await expect(page.getByText('... POLLING')).toHaveCount(0, { timeout: 25_000 })
  await expect(page.getByText(/LINK FAULT/)).toHaveCount(0)

  await expect(row).toContainText('Playwright Recruiter')
  await expect(row).toContainText('Slack')
  await expect(row).toContainText('LIVE')

  // Expand the link: the hit log and the attributed sessions come from
  // /api/ops/share/:token.
  await row.getByRole('button', { name: token }).click()
  await expect(page.getByTestId('share-hit-row').first()).toBeVisible({ timeout: 20_000 })
  const kinds = await page.getByTestId('share-hit-row').allInnerTexts()
  expect(kinds.join(' ')).toMatch(/VIEW/)
  expect(kinds.join(' ')).toMatch(/UNFURL/)
  await expect(page.getByTestId('share-session-row').first()).toBeVisible({ timeout: 20_000 })

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

// ---------------------------------------------------------------- 5. revoke

test('revoking marks the link but keeps recording — that is the signal', async () => {
  const api = await adminApi()
  try {
    const res = await api.post(`/api/ops/share/${token}/revoke`, { data: { revoked: true } })
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ token, revoked: true })

    const before = readDb(db => hitsOf(db, token).length) ?? 0
    const plain = await fetcher('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
    expect((await plain.get(`/?k=${token}`)).status()).toBe(200)
    await plain.dispose()
    const still = await pollDb(20_000, db => (hitsOf(db, token).length > before ? true : undefined))
    expect(still, 'a revoked link is still recorded').toBe(true)

    const detail = await api.get(`/api/ops/share/${token}`)
    expect(detail.status()).toBe(200)
    const body = (await detail.json()) as { link: { revoked: boolean; label: string; unfurls: number; views: number } }
    expect(body.link.revoked).toBe(true)
    expect(body.link.label).toBe('Playwright Recruiter — E2E')
    expect(body.link.unfurls).toBeGreaterThanOrEqual(1)
    expect(body.link.views).toBeGreaterThanOrEqual(2)

    // Put it back so a re-run starts from a live link.
    expect((await api.post(`/api/ops/share/${token}/revoke`, { data: { revoked: false } })).status()).toBe(200)
  } finally {
    await api.dispose()
  }
})
