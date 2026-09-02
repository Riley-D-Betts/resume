import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

/**
 * End-to-end analytics (contract §F.3): drive real browse sessions through
 * the public pages and assert what the pipeline landed in the local D1
 * database — per-page visits with paths, section dwell and scroll depth on
 * the SECOND page (K1–K3), a mailto handoff, the typed side tables and an
 * rrweb chunk keyed by its recording id — plus one intercept test that pins
 * the exact wire payloads without touching D1.
 *
 * Desktop only. The dev server keeps its D1 state under .wrangler/state
 * relative to the playwright cwd — run from the repo root against a locally
 * running server (`npm run db:migrate:local` once, then `npm run dev`).
 * D1_DB_PATH overrides the discovered SQLite path.
 *
 * Every test gets its own browser context (fresh rb_sid / vid).
 */

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

interface SessionRow {
  sid: string
  started_at: number
  pageviews: number
  mailto_clicks: number
  max_scroll_pct: number
}

interface PageVisitRow {
  pvid: string
  path: string
  from_path: string | null
  nav_kind: string | null
  entered_at: number
}

interface CountRow {
  n: number
}

interface Envelope {
  v: number
  sid: string
  url: string
  events: WireEvent[]
}

interface WireEvent {
  t: number
  type: string
  name: string | null
  u?: string
  p?: Record<string, unknown>
}

/**
 * Poll the local D1 SQLite file until `query` returns a value or the
 * deadline hits. A fresh readonly connection per attempt keeps WAL reads
 * current and never blocks the server's writer; the path is re-resolved
 * per attempt because miniflare creates it lazily.
 */
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
      // db file not created yet — keep polling
    } finally {
      db?.close()
    }
    if (Date.now() >= deadline) return undefined
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
}

function countRows(db: DatabaseSync, sql: string, ...args: (string | number)[]): number {
  const row = db.prepare(sql).get(...args) as unknown as CountRow
  return Number(row?.n ?? 0)
}

/** The sid the client minted into its cookie. */
async function sidOf(page: Page): Promise<string> {
  const sid = (await page.context().cookies()).find(c => c.name === 'rb_sid')?.value
  expect(sid, 'analytics client should set an rb_sid cookie').toBeTruthy()
  return sid!
}

/**
 * Wait until Nuxt has finished hydrating (the Vue app is mounted on #__nuxt
 * and `nuxtApp.isHydrating` is false) and the tracker bridge is installed —
 * clicking a NuxtLink before that would be a full document load, not an SPA
 * navigation.
 */
async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as (Element & { __vue_app__?: { config?: { globalProperties?: { $nuxt?: { isHydrating?: boolean } } } } }) | null
    const nuxt = root?.__vue_app__?.config?.globalProperties?.$nuxt
    return nuxt !== undefined && nuxt.isHydrating === false
      && typeof (window as unknown as { __rbTrack?: unknown }).__rbTrack === 'function'
  }, undefined, { timeout: 20_000 })
}

/** Dwell on the current page: scroll to the bottom in one jump, then wait. */
async function dwell(page: Page, ms = 2_600): Promise<void> {
  await page.waitForTimeout(700) // sections get their 500 ms enter debounce first
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(ms)
}

/** Open the Shortcuts icon tab (hover — click would toggle it closed again) and follow a link in it. */
async function viaShortcuts(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Shortcuts' }).hover()
  await page.locator('.ns-nav__panel').getByRole('link', { name: label, exact: true }).click()
}

/** Capture every /api/collect envelope; `fulfill` answers 204 locally so nothing reaches D1. */
async function interceptCollect(page: Page, envelopes: Envelope[], mode: 'continue' | 'fulfill'): Promise<void> {
  await page.route('**/api/collect', async (route: Route) => {
    try {
      const body = route.request().postDataJSON() as Envelope | null
      if (body && Array.isArray(body.events)) envelopes.push(body)
    } catch {
      /* non-JSON body — ignore */
    }
    if (mode === 'fulfill') await route.fulfill({ status: 204, body: '' })
    else await route.continue()
  })
}

const flat = (envelopes: Envelope[]): WireEvent[] => envelopes.flatMap(e => e.events)

test.skip(({ isMobile }) => isMobile, 'analytics pipeline is asserted once, on desktop')

// ---------------------------------------------------------------------------

test('a five-page SPA browse lands per-page visits, sections, scroll, a mailto and a replay chunk', async ({ page }) => {
  test.setTimeout(180_000)

  const browseStart = Date.now()
  await page.goto('/')
  await hydrated(page)
  const sid = await sidOf(page)
  await dwell(page)

  // / → /employee via the masthead user link (a NuxtLink → SPA navigation)
  await page.getByLabel('User name and role').click()
  await expect(page).toHaveURL(/\/employee$/)
  await expect(page.getByRole('heading', { name: 'Employee' })).toBeVisible()
  await dwell(page)

  // /employee → /positions → /projects via the Shortcuts menu
  await viaShortcuts(page, 'Employment History')
  await expect(page).toHaveURL(/\/positions$/)
  await expect(page.getByRole('heading', { name: 'Employment History' })).toBeVisible()
  await dwell(page)

  await viaShortcuts(page, 'Projects')
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await dwell(page)

  // /projects → /contact via the masthead "Create New"
  await page.getByLabel('Create New').click()
  await expect(page).toHaveURL(/\/contact$/)
  await expect(page.getByText('Contact Information')).toBeVisible()
  await dwell(page, 1_500)

  // A mailto handoff: pointerdown on the Recipient link, dispatched so the
  // browser never actually navigates to the mail client. isPrimary matters —
  // the tracker ignores secondary pointers.
  await page.locator('[data-section="contact.form"] a[href^="mailto:"]').evaluate((el) => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerType: 'mouse', clientX: 10, clientY: 10 }))
  })
  // Let the 5 s flush timer drain the queue and rrweb (uploading every 10 s
  // after the first collect ack) produce a chunk.
  await page.waitForTimeout(6_000)

  // -- session row ------------------------------------------------------
  const session = await pollDb(20_000, (db) => {
    const row = db.prepare('SELECT sid, started_at, pageviews, mailto_clicks, max_scroll_pct FROM sessions WHERE sid = ?')
      .get(sid) as unknown as SessionRow | undefined
    return row && row.pageviews >= 5 ? row : undefined
  })
  expect(session, 'sessions row with pageviews >= 5 for this sid').toBeTruthy()
  expect(session!.started_at, 'session started when this test started browsing').toBeGreaterThan(browseStart - 60_000)
  expect(session!.max_scroll_pct, 'scrolling to the bottom reached 100 %').toBe(100)

  // -- page visits (K1): one row per page, chained by from_path ----------
  const visits = await pollDb(15_000, (db) => {
    const rows = db.prepare('SELECT pvid, path, from_path, nav_kind, entered_at FROM page_visits WHERE sid = ? ORDER BY entered_at')
      .all(sid) as unknown as PageVisitRow[]
    return rows.length >= 5 ? rows : undefined
  })
  expect(visits, 'at least five page_visits rows').toBeTruthy()
  const byPath = new Map(visits!.map(v => [v.path, v]))
  expect([...byPath.keys()]).toEqual(expect.arrayContaining(['/', '/employee', '/positions', '/projects', '/contact']))
  expect(byPath.get('/')!.nav_kind).toBe('initial')
  expect(byPath.get('/')!.from_path).toBeNull()
  expect(byPath.get('/employee')!.from_path, '/employee was reached from /').toBe('/')
  expect(byPath.get('/employee')!.nav_kind, '/employee was an SPA navigation').toBe('spa')
  expect(byPath.get('/contact')!.from_path).toBe('/projects')

  // -- events on the SECOND page carry its path (K2 / K3 / K4) -----------
  const secondPage = await pollDb(15_000, (db) => {
    const sections = countRows(db, "SELECT COUNT(*) AS n FROM events WHERE sid = ? AND type = 'section_enter' AND path = '/employee' AND name LIKE 'employee.%'", sid)
    const scrolls = countRows(db, "SELECT COUNT(*) AS n FROM events WHERE sid = ? AND type = 'scroll_depth' AND path = '/employee'", sid)
    return sections > 0 && scrolls > 0 ? { sections, scrolls } : undefined
  })
  expect(secondPage, 'section_enter (employee.*) and scroll_depth rows with path = /employee').toBeTruthy()
  const nullPaths = await pollDb(1_000, db => countRows(db, 'SELECT COUNT(*) AS n FROM events WHERE sid = ? AND path IS NULL', sid))
  expect(nullPaths, 'every events row carries a path').toBe(0)

  // -- the mailto handoff counted on the session ------------------------
  const mailto = await pollDb(15_000, (db) => {
    const n = countRows(db, 'SELECT mailto_clicks AS n FROM sessions WHERE sid = ?', sid)
    return n >= 1 ? n : undefined
  })
  expect(mailto, 'sessions.mailto_clicks >= 1').toBeGreaterThanOrEqual(1)

  // -- typed side tables --------------------------------------------------
  const env = await pollDb(15_000, db => (countRows(db, 'SELECT COUNT(*) AS n FROM session_env WHERE sid = ?', sid) === 1 ? true : undefined))
  expect(env, 'session_env row exists (the env probe landed)').toBe(true)
  // asn only: miniflare fills request.cf with whatever cf.json it fetched for
  // this machine (or its static fallback) — never assert org / geo locally.
  const asn = await pollDb(5_000, (db) => {
    const row = db.prepare('SELECT asn FROM sessions WHERE sid = ?').get(sid) as unknown as { asn: number | null } | undefined
    return typeof row?.asn === 'number' && row.asn > 0 ? row.asn : undefined
  })
  expect(asn, 'sessions.asn populated from request.cf').toBeGreaterThan(0)
  const net = await pollDb(1_000, db => countRows(db, 'SELECT COUNT(*) AS n FROM session_net WHERE sid = ?', sid))
  expect(net, 'session_net row exists').toBe(1)

  // -- replay chunk keyed by its recording id (A0) -----------------------
  // The page is still open (rrweb keeps recording/uploading); poll up to 30 s.
  const chunk = await pollDb(30_000, db =>
    db.prepare("SELECT rid, seq FROM replay_chunks_v2 WHERE sid = ? AND rid <> 'legacy' AND pending = 0 LIMIT 1").get(sid) as unknown as { rid: string; seq: number } | undefined)
  expect(chunk, 'at least one completed replay chunk stored for this session').toBeTruthy()
  expect(chunk!.rid).toMatch(/^[0-9a-f-]{36}$/)
})

// ---------------------------------------------------------------------------

test('a deep landing on /employee is one initial page visit', async ({ page }) => {
  await page.goto('/employee')
  await hydrated(page)
  const sid = await sidOf(page)
  await expect(page.getByRole('heading', { name: 'Employee' })).toBeVisible()
  await page.waitForTimeout(6_500) // one flush interval

  const session = await pollDb(15_000, (db) => {
    const row = db.prepare('SELECT pageviews FROM sessions WHERE sid = ?').get(sid) as unknown as { pageviews: number } | undefined
    return row ? row : undefined
  })
  expect(session, 'sessions row for the deep landing').toBeTruthy()
  expect(session!.pageviews, 'exactly one pageview').toBe(1)

  const visits = await pollDb(5_000, (db) => {
    const rows = db.prepare('SELECT pvid, path, from_path, nav_kind, entered_at FROM page_visits WHERE sid = ?').all(sid) as unknown as PageVisitRow[]
    return rows.length > 0 ? rows : undefined
  })
  expect(visits, 'page_visits rows').toBeTruthy()
  expect(visits!.length, 'one page_visits row').toBe(1)
  expect(visits![0]!.path).toBe('/employee')
  expect(visits![0]!.from_path, 'a deep landing has no from_path').toBeNull()
  expect(visits![0]!.nav_kind).toBe('initial')
})

// ---------------------------------------------------------------------------

test.describe('K3', () => {
  // The Bettsuite pages are compact: at 1440×900 /employee fits the viewport,
  // and a page that fits is 100 % scrolled by definition (A6). A short desktop
  // viewport makes /employee genuinely taller than the screen so the
  // "nothing carries over from the previous page" rule has something to bite.
  test.use({ viewport: { width: 1280, height: 420 } })

  test('K3: scroll milestones reset per page and never carry over an SPA navigation', async ({ page }) => {
  test.setTimeout(120_000)
  const envelopes: Envelope[] = []
  await interceptCollect(page, envelopes, 'continue')

  await page.goto('/')
  await hydrated(page)
  await page.waitForTimeout(700)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(1_000)

  await page.getByLabel('User name and role').click()
  await expect(page).toHaveURL(/\/employee$/)
  await expect(page.getByRole('heading', { name: 'Employee' })).toBeVisible()
  // The router scrolls the new page to the top; with `scroll-behavior: smooth`
  // that is an animation, so wait for it to settle before measuring.
  await expect.poll(() => page.evaluate(() => scrollY), { timeout: 5_000, message: 'the SPA navigation scrolled /employee to the top' }).toBe(0)
  // How much of /employee the first (unscrolled) viewport covers — the only
  // milestones the tracker may legitimately report before any scroll (A6).
  const cover = await page.evaluate(() => ({
    pct: (innerHeight / document.documentElement.scrollHeight) * 100,
    scrollable: document.documentElement.scrollHeight > innerHeight + 1,
  }))
  expect(cover.scrollable, '/employee is taller than the desktop viewport').toBe(true)
  await page.waitForTimeout(6_000) // let the post-navigation flush go out

  const depths = (path: string): number[] =>
    flat(envelopes).filter(e => e.type === 'scroll_depth' && e.u === path).map(e => Number(e.p?.pct))
  const home = depths('/')
  expect(home, 'scrolling / to the bottom recorded its 100 % milestone').toContain(100)
  const before = depths('/employee')
  // Nothing from /'s bottom position may leak into /employee: only milestones
  // the unscrolled first viewport actually covers are allowed here.
  expect(before, `no /employee milestone before scrolling beyond what the first viewport covers (${cover.pct.toFixed(0)} %) — a higher one means the previous page's scroll position leaked into the new page's measurement`)
    .toEqual(before.filter(pct => pct <= cover.pct + 1))
  expect(before, 'no 100 % milestone for /employee before scrolling').not.toContain(100)

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(6_000)
  const after = depths('/employee')
  expect(after, '/employee milestones arrive once the page is actually scrolled').toContain(100)
  expect(after.length).toBeGreaterThan(before.length)
  })
})

// ---------------------------------------------------------------------------

test('wire contract: initial pageview, per-event paths, docPvid pinning, env.gpu, resource_error, copy.hasEmail', async ({ page }) => {
  test.setTimeout(120_000)
  const envelopes: Envelope[] = []
  // Lifecycle flushes prefer sendBeacon; force the fetch(keepalive) fallback
  // so page.route sees them too. Nothing here needs the server or D1.
  await page.addInitScript(() => {
    navigator.sendBeacon = () => false
  })
  await interceptCollect(page, envelopes, 'fulfill')

  await page.goto('/')
  await hydrated(page)
  // First flush (5 s timer) — the initial pageview must be in it.
  await expect.poll(() => flat(envelopes).some(e => e.type === 'pageview'), { timeout: 15_000 }).toBe(true)

  let events = flat(envelopes)
  const initial = events.filter(e => e.type === 'pageview')
  expect(initial, 'exactly one pageview before any navigation').toHaveLength(1)
  expect(initial[0]!.p?.kind).toBe('initial')
  expect(initial[0]!.p?.path).toBe('/')
  expect(initial[0]!.p?.from).toBeNull()
  expect(typeof initial[0]!.p?.pvid).toBe('string')
  expect(events.filter(e => e.type === 'page_leave'), 'no page_leave before any navigation').toHaveLength(0)
  for (const env of envelopes) expect(env.v, 'envelope version').toBe(2)
  const docPvid = initial[0]!.p!.pvid as string

  // A broken image → resource_error (capture-phase error listener).
  await page.evaluate(() => {
    const img = document.createElement('img')
    img.src = `/nope-${Date.now()}.png`
    document.body.appendChild(img)
  })

  // SPA navigation to /contact via the masthead "Create New".
  await page.getByLabel('Create New').click()
  await expect(page).toHaveURL(/\/contact$/)
  await expect(page.getByText('Contact Information')).toBeVisible()
  await page.waitForTimeout(800)

  // Select the email and dispatch a synthetic copy — never inside an input.
  const copied = await page.evaluate(() => {
    const a = document.querySelector('[data-section="contact.form"] a[href^="mailto:"]')
    if (!a) return false
    const range = document.createRange()
    range.selectNodeContents(a)
    const sel = getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true }))
    return sel?.toString().includes('@') ?? false
  })
  expect(copied, 'the Recipient email was selected before the copy event').toBe(true)

  // Wait for the env probe (idle after load, 3 s fallback), the perf report
  // (load + 3 s) and the SPA pageview to flush.
  await expect
    .poll(() => {
      const ev = flat(envelopes)
      return ['env', 'perf', 'copy', 'resource_error'].every(t => ev.some(e => e.type === t))
        && ev.some(e => e.type === 'pageview' && e.p?.kind === 'spa')
    }, { timeout: 30_000, message: 'env, perf, copy, resource_error and the spa pageview all flushed' })
    .toBe(true)

  // A synthetic pagehide: page_leave(unload) + vitals + perf → beacon flush.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await expect.poll(() => flat(envelopes).some(e => e.type === 'vitals'), { timeout: 15_000, message: 'vitals flushed on pagehide' }).toBe(true)

  events = flat(envelopes)
  // u on every event, and it matches the page the event belongs to.
  for (const e of events) {
    expect(typeof e.u, `event ${e.type} carries u`).toBe('string')
    expect(e.u, `event ${e.type} u is a pathname`).toMatch(/^\/[^?#\s]*$/)
  }
  const pageviews = events.filter(e => e.type === 'pageview')
  expect(pageviews.map(p => p.p?.kind)).toEqual(['initial', 'spa'])
  expect(pageviews[1]!.p?.from).toBe('/')
  expect(pageviews[1]!.p?.path).toBe('/contact')
  expect(pageviews[1]!.u).toBe('/contact')
  expect(pageviews[1]!.p?.pvid).not.toBe(docPvid)

  // vitals / perf are per DOCUMENT LOAD: pinned to the first pageview's pvid
  // even though they flushed after the SPA navigation.
  const vitals = events.find(e => e.type === 'vitals')!
  const perf = events.find(e => e.type === 'perf')!
  expect(vitals.p?.pvid, 'vitals.pvid === first pageview.pvid').toBe(docPvid)
  expect(perf.p?.pvid, 'perf.pvid === first pageview.pvid').toBe(docPvid)
  expect(typeof vitals.p?.cls).toBe('number')
  expect(typeof (perf.p?.nav as Record<string, unknown> | undefined)?.dns).toBe('number')
  expect(Array.isArray((perf.p?.resources as Record<string, unknown> | undefined)?.slowest)).toBe(true)

  const leaves = events.filter(e => e.type === 'page_leave')
  expect(leaves.map(l => l.p?.reason)).toEqual(['spa', 'unload'])
  expect(leaves[0]!.p?.pvid).toBe(docPvid)
  expect(leaves[0]!.p?.path).toBe('/')

  const env = events.find(e => e.type === 'env')!
  expect('gpu' in env.p!, 'env carries a gpu key (string / object or null)').toBe(true)
  const gpu = env.p!.gpu as null | string | { vendor?: unknown; renderer?: unknown }
  expect(gpu === null || typeof gpu === 'string' || (typeof gpu === 'object' && typeof gpu.renderer === 'string')).toBe(true)
  expect(typeof env.p!.webdriver).toBe('boolean')
  expect(typeof env.p!.languages).toBe('string')

  const resErr = events.find(e => e.type === 'resource_error')!
  expect(resErr.p?.tag).toBe('img')
  expect(String(resErr.p?.src)).toContain('/nope-')

  const copy = events.find(e => e.type === 'copy')!
  expect(copy.p?.hasEmail, 'copying the email sets hasEmail').toBe(true)
  expect(copy.u).toBe('/contact')
  expect(String(copy.p?.snippet).length).toBeLessThanOrEqual(80)
})
