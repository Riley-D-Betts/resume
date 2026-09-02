import path from 'node:path'
import { expect, request, test } from '@playwright/test'
import type { APIResponse, BrowserContext, Cookie, Page } from '@playwright/test'

/**
 * /ops admin console (contract §F.3 + plan A8/A27/A36/A37): the login gate,
 * the overview widgets, a console-error-free smoke of every console page
 * (the /ops CSP is validated here — a violation surfaces as a console
 * error), a custom range, the seeded replay session's detail with a real
 * rrweb player, org / page drill-downs, the read-only SQL console, the CSV
 * export and a 401 sweep of every /api/ops route without the cookie.
 *
 * Desktop only. The server under test must have NUXT_ADMIN_PASSWORD set to
 * OPS_PASSWORD (default 'test') and carry the seed's traffic
 * (`npm run seed` — it writes the one session with `has_replay = 1`).
 *
 * The login endpoint is throttled at 5 attempts / minute per IP (successes
 * included), so the suite logs in ONCE through the UI and shares the rbops
 * cookie between tests via `authed()`.
 */

const OPS_PASSWORD = process.env.OPS_PASSWORD || 'test'
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const SCREENS_DIR = path.join(process.cwd(), 'test-results', 'screens')

test.skip(({ isMobile }) => isMobile, 'ops console is asserted once, on desktop')

// ---------------------------------------------------------------- helpers

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    // net::ERR_* messages are aborted/blocked resource loads, not JS errors.
    if (msg.type() === 'error' && !msg.text().includes('net::ERR')) errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(String(err)))
  return errors
}

let opsCookies: Cookie[] | null = null

/** Log in through the form (once) and remember the session cookies. */
async function loginViaForm(page: Page): Promise<void> {
  await page.goto('/ops')
  const password = page.getByTestId('ops-login-password')
  await expect(password).toBeVisible({ timeout: 20_000 })
  await password.fill(OPS_PASSWORD)
  await page.getByTestId('ops-login-submit').click()
  await expect(page.getByTestId('stat-card').first()).toBeVisible({ timeout: 20_000 })
  opsCookies = (await page.context().cookies()).filter(c => c.name === 'rbops')
  expect(opsCookies.length, 'login set the rbops cookie').toBeGreaterThan(0)
}

/** Reuse the cookie from the form login; fall back to one API login. */
async function authed(context: BrowserContext): Promise<void> {
  if (!opsCookies) {
    const api = await request.newContext({ baseURL: BASE_URL })
    const res = await api.post('/api/ops/login', { data: { password: OPS_PASSWORD } })
    expect(res.status(), 'POST /api/ops/login').toBe(200)
    opsCookies = (await api.storageState()).cookies.filter(c => c.name === 'rbops')
    await api.dispose()
    expect(opsCookies.length, 'login set the rbops cookie').toBeGreaterThan(0)
  }
  await context.addCookies(opsCookies)
}

/** Every page shows `... POLLING` until its first fetch lands; wait it out. */
async function settled(page: Page): Promise<void> {
  await expect(page.getByText('... POLLING')).toHaveCount(0, { timeout: 25_000 })
}

/** Type a statement, run it, and return the console endpoint's response. */
async function runSql(page: Page, sql: string): Promise<APIResponse | { status(): number }> {
  await page.getByTestId('sql-editor').fill(sql)
  const [res] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/ops/sql') && r.request().method() === 'POST'),
    page.getByTestId('sql-run').click(),
  ])
  return res
}

const RANGE_GROUP = { name: 'Time range' } as const

// ---------------------------------------------------------------- 1. gate

test('login gate: a wrong password is refused with a role=alert denial', async ({ page }) => {
  await page.goto('/ops')

  // Unauthenticated hit ends at the login form (/ops is client-rendered).
  const password = page.getByTestId('ops-login-password')
  await expect(password).toBeVisible({ timeout: 20_000 })

  await password.fill('definitely-not-the-password')
  await page.getByTestId('ops-login-submit').click()

  // A36: assert on the denial itself, not on the always-present hint text.
  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible()
  await expect(alert).toHaveText(/ACCESS DENIED|denied|invalid/i)
  await expect(page.getByTestId('ops-login-password')).toBeVisible()
  await expect(page.getByTestId('stat-card')).toHaveCount(0)
})

// ---------------------------------------------------------------- 2. overview

test('overview: tiles, sparkline, filter bar, live strip, ranges, compare, D1 readout', async ({ page }, testInfo) => {
  const errors = collectErrors(page)
  await loginViaForm(page)

  const statCards = page.getByTestId('stat-card')
  expect(await statCards.count(), 'at least 4 stat cards').toBeGreaterThanOrEqual(4)
  await expect(page.getByTestId('sparkline').first()).toBeVisible()
  await expect(page.getByTestId('filter-bar').first()).toBeVisible()
  await expect(page.getByTestId('live-strip')).toHaveCount(1)
  await settled(page)

  // Storage readouts: a real size (or an explicit PRAGMA fallback) and ≈ counts.
  const storage = page.locator('.ov__readouts')
  await expect(storage).toBeVisible()
  await expect(storage).toContainText('D1 SIZE')
  await expect(storage).toContainText(/(\d[\d.]*\s*(B|KB|MB|GB)\b)|PRAGMA UNAVAILABLE/)
  await expect(storage).toContainText(/≈\s*[\d,]+/)

  await page.screenshot({ path: path.join(SCREENS_DIR, `ops-overview-${testInfo.project.name}.png`), fullPage: true })

  // Range switching keeps the page error-free and the URL in sync.
  const ranges = page.getByRole('group', RANGE_GROUP)
  for (const [label, key] of [['24H', '24h'], ['30D', '30d'], ['ALL', 'all']] as const) {
    const chip = ranges.getByRole('button', { name: label, exact: true })
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/ops/overview') && r.url().includes(`range=${key}`)),
      chip.click(),
    ])
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(new RegExp(`range=${key}`))
    await settled(page)
    await expect(page.getByText(/LINK FAULT/)).toHaveCount(0)
    await expect(statCards.first()).toBeVisible()
  }

  // COMPARE renders a delta on the tiles.
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/ops/overview') && r.url().includes('compare=1')),
    page.getByTestId('compare-toggle').click(),
  ])
  await expect(page.getByTestId('stat-delta').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/LINK FAULT/)).toHaveCount(0)

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

// ---------------------------------------------------------------- 3. page smoke

interface Smoke {
  path: string
  /** row test ids that prove data rendered */
  rows: string[]
  /** empty-state text accepted instead of rows */
  empty: RegExp
}

const SMOKE: Smoke[] = [
  { path: '/ops/pages', rows: ['page-row'], empty: /NO DATA \/\/ PAGES/ },
  { path: '/ops/flows', rows: ['funnel'], empty: /NO DATA \/\/ FLOWS/ },
  { path: '/ops/orgs', rows: ['org-row'], empty: /NO DATA \/\/ ORGS/ },
  { path: '/ops/visitors', rows: ['visitor-row'], empty: /NO DATA \/\/ VISITORS/ },
  { path: '/ops/sessions', rows: ['session-row'], empty: /NO SESSIONS IN RANGE/ },
  { path: '/ops/intent', rows: ['intent-card'], empty: /NO DATA \/\/ INTENT/ },
  { path: '/ops/performance', rows: ['perf-tile'], empty: /NO DATA \/\/ PERFORMANCE/ },
  { path: '/ops/technology', rows: ['tech-panel'], empty: /NO DATA \/\/ TECHNOLOGY/ },
  { path: '/ops/errors', rows: ['error-row'], empty: /NO DATA \/\/ ERRORS/ },
  { path: '/ops/sql', rows: ['sql-editor'], empty: /NEVER/ },
]

for (const s of SMOKE) {
  test(`smoke ${s.path}: renders rows or its empty state, zero console errors`, async ({ page, context }) => {
    const errors = collectErrors(page)
    await authed(context)
    await page.goto(s.path)

    await expect(page.getByTestId('filter-bar').first()).toBeVisible({ timeout: 20_000 })
    await settled(page)
    await expect(page.getByText(/LINK FAULT/)).toHaveCount(0)

    let rows = 0
    for (const id of s.rows) rows += await page.getByTestId(id).count()
    if (rows === 0) {
      await expect(page.getByText(s.empty).first(), `${s.path}: neither rows nor empty state`).toBeVisible()
    }

    expect(errors, `${s.path} console errors:\n${errors.join('\n')}`).toEqual([])
  })
}

// ---------------------------------------------------------------- 4. custom range

test('custom range in the future yields NO SESSIONS IN RANGE', async ({ page, context }) => {
  const errors = collectErrors(page)
  await authed(context)
  const from = Date.now() + 86_400_000
  const to = from + 86_400_000
  await page.goto(`/ops/sessions?range=custom&from=${from}&to=${to}`)

  await expect(page.getByTestId('range-custom-from')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('range-custom-to')).toBeVisible()
  await expect(page.getByText('NO SESSIONS IN RANGE')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('session-row')).toHaveCount(0)
  await expect(page.getByText(/LINK FAULT/)).toHaveCount(0)

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

// ---------------------------------------------------------------- 5. session detail + replay

test('sessions → the seeded replay session: timeline, env, path, a mounted rrweb player', async ({ page, context }, testInfo) => {
  const errors = collectErrors(page)
  await authed(context)

  // A8: pick a session that HAS a replay (the seed's), not the newest row.
  const list = await page.request.get('/api/ops/sessions?replay=1&range=all&limit=5')
  expect(list.status(), 'GET /api/ops/sessions?replay=1').toBe(200)
  const body = (await list.json()) as { rows: { sid: string; has_replay: number }[] }
  expect(body.rows.length, 'a session with has_replay = 1 exists (run the seed)').toBeGreaterThan(0)
  expect(body.rows[0]!.has_replay).toBe(1)

  await page.goto('/ops/sessions?replay=1&range=all')
  const rows = page.getByTestId('session-row')
  await expect(rows.first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('filter-replay')).toHaveAttribute('aria-pressed', 'true')

  await rows.first().click()
  await expect(page).toHaveURL(/\/ops\/sessions\/[0-9a-f-]{8,}/, { timeout: 20_000 })
  const sid = new URL(page.url()).pathname.split('/').pop()!

  // Event timeline with real rows.
  const timeline = page.getByTestId('event-timeline')
  await expect(timeline.first()).toBeVisible({ timeout: 20_000 })
  await expect(timeline.first()).not.toContainText(/NO EVENTS RECORDED/i)
  expect(await timeline.first().locator('.tl__row').count(), 'event timeline has rows').toBeGreaterThan(0)

  await expect(page.getByTestId('env-panel')).toHaveCount(1)
  await expect(page.getByTestId('path-timeline')).toHaveCount(1)

  // A37: the player must actually mount rrweb (not just its wrapper).
  const player = page.getByTestId('replay-player')
  await expect(player).toBeVisible({ timeout: 20_000 })
  await expect(player.locator('.rr-player')).toBeVisible({ timeout: 30_000 })
  await expect(player).not.toContainText(/NO REPLAY CAPTURED|REPLAY LINK FAULT/)

  // The segment picker appears exactly when the session has > 1 recording.
  const replay = await page.request.get(`/api/ops/replay/${encodeURIComponent(sid)}`)
  expect(replay.status()).toBe(200)
  const segments = ((await replay.json()) as { segments: unknown[] }).segments
  expect(segments.length, 'stitcher returned at least one segment').toBeGreaterThan(0)
  await expect(page.getByTestId('replay-segment')).toHaveCount(segments.length > 1 ? segments.length : 0)

  await page.screenshot({ path: path.join(SCREENS_DIR, `ops-session-detail-${testInfo.project.name}.png`), fullPage: true })

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

// ---------------------------------------------------------------- 6. orgs / pages drill-down

test('orgs → detail renders tiles and a sessions table', async ({ page, context }) => {
  const errors = collectErrors(page)
  await authed(context)
  await page.goto('/ops/orgs?range=all')

  const rows = page.getByTestId('org-row')
  await expect(rows.first()).toBeVisible({ timeout: 20_000 })
  await rows.first().click()
  await expect(page).toHaveURL(/\/ops\/orgs\/detail\?.*org=/, { timeout: 20_000 })
  await settled(page)

  await expect(page.getByText(/LINK FAULT/)).toHaveCount(0)
  expect(await page.getByTestId('stat-card').count(), 'org detail tiles').toBeGreaterThanOrEqual(4)
  await expect(page.getByText('SESSIONS // NEWEST 100')).toBeVisible()
  await expect(page.getByTestId('session-row').first()).toBeVisible()
  await expect(page.getByTestId('intent-card').first()).toBeVisible()

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

test('pages → detail renders tiles and the recent visits table', async ({ page, context }) => {
  const errors = collectErrors(page)
  await authed(context)
  await page.goto('/ops/pages?range=all')

  const rows = page.getByTestId('page-row')
  await expect(rows.first()).toBeVisible({ timeout: 20_000 })
  await rows.first().click()
  await expect(page).toHaveURL(/\/ops\/pages\/detail\?.*path=/, { timeout: 20_000 })
  await settled(page)

  await expect(page.getByText(/LINK FAULT/)).toHaveCount(0)
  expect(await page.getByTestId('stat-card').count(), 'page detail tiles').toBeGreaterThanOrEqual(4)
  await expect(page.getByText('RECENT VISITS')).toBeVisible()
  await expect(page.getByTestId('line-chart').first()).toBeVisible()

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

// ---------------------------------------------------------------- 7. SQL console

test('SQL console: comments ok, multi-statement and DELETE rejected, EXPLAIN works, schema lists sessions', async ({ page, context }) => {
  const errors = collectErrors(page)
  await authed(context)
  await page.goto('/ops/sql')

  await expect(page.getByTestId('sql-editor')).toBeVisible({ timeout: 20_000 })
  const results = page.getByTestId('sql-results')
  const sqlError = page.getByTestId('sql-error')

  // Schema browser lists the sessions table.
  const sessionsTable = page.getByTestId('schema-table').filter({ has: page.locator('.sb__name', { hasText: /^sessions$/ }) })
  await expect(sessionsTable).toHaveCount(1, { timeout: 20_000 })

  // Comments are whitespace.
  expect((await runSql(page, 'SELECT 1 -- x')).status()).toBe(200)
  await expect(results).toBeVisible()
  await expect(results.locator('th').first()).toHaveText('1')
  await expect(results.locator('td').first()).toHaveText('1')
  await expect(sqlError).toHaveCount(0)
  await expect(page.getByTestId('sql-status')).toBeVisible()

  // Baseline count.
  expect((await runSql(page, 'SELECT COUNT(*) AS n FROM sessions')).status()).toBe(200)
  await expect(results.locator('th').first()).toHaveText('n')
  const before = Number(await results.locator('td').first().textContent())
  expect(Number.isInteger(before) && before > 0, `sessions count before: ${before}`).toBe(true)

  // One statement only.
  expect((await runSql(page, 'SELECT 1; SELECT 2')).status()).toBe(400)
  await expect(sqlError).toBeVisible()
  await expect(sqlError).toContainText(/REJECTED/)

  // Mutations are refused …
  expect((await runSql(page, 'DELETE FROM sessions')).status()).toBe(400)
  await expect(sqlError).toBeVisible()
  await expect(sqlError).toContainText(/REJECTED/)

  // … and nothing changed.
  expect((await runSql(page, 'SELECT COUNT(*) AS n2 FROM sessions')).status()).toBe(200)
  await expect(results.locator('th').first()).toHaveText('n2')
  const after = Number(await results.locator('td').first().textContent())
  expect(after, 'DELETE did not touch sessions').toBe(before)
  await expect(sqlError).toHaveCount(0)

  // EXPLAIN QUERY PLAN passes the guard and returns a plan.
  expect((await runSql(page, 'EXPLAIN QUERY PLAN SELECT * FROM sessions WHERE started_at > 0')).status()).toBe(200)
  await expect(results).toContainText(/SCAN|SEARCH/)
  await expect(sqlError).toHaveCount(0)

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

// ---------------------------------------------------------------- 8. export

test('export: the sessions CSV button completes and the endpoint sets its headers', async ({ page, context }) => {
  const errors = collectErrors(page)
  await authed(context)

  // Endpoint contract, with the cookie.
  const res = await page.request.get('/api/ops/export?entity=sessions&format=csv&range=all&limit=10')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-disposition'] ?? '').toMatch(/attachment; filename="rb-sessions-.*\.csv"/)
  expect(res.headers()['x-rb-rows'] ?? '').toMatch(/^\d+$/)
  expect(res.headers()['content-type'] ?? '').toMatch(/text\/csv/)
  const csv = await res.text()
  const header = csv.split(/\r?\n/)[0] ?? ''
  expect(header, 'CSV header line').toMatch(/(^|,)sid(,|$)/)
  expect(header.split(',').length).toBeGreaterThan(3)

  // The button: loops the cursor pages, builds the file, shows DONE + a link.
  await page.goto('/ops/sessions?range=all')
  await expect(page.getByTestId('session-row').first()).toBeVisible({ timeout: 20_000 })
  const button = page.getByTestId('export-link').first()
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/ops/export?') && r.url().includes('entity=sessions')),
    button.click(),
  ])
  await expect(button).toHaveText(/(DONE|CAPPED) \/\/ [\d ]+ ROWS/, { timeout: 30_000 })
  const file = page.getByTestId('export-file')
  await expect(file).toBeVisible()
  await expect(file).toHaveAttribute('download', /rb-sessions-.*\.csv/)

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

// ---------------------------------------------------------------- 9. 401 sweep

/** Every /api/ops route that `requireAdmin`s first (wp4 route table). */
const OPS_ROUTES: { method: 'GET' | 'POST'; url: string }[] = [
  { method: 'GET', url: '/api/ops/overview' },
  { method: 'GET', url: '/api/ops/overview?compare=1' },
  { method: 'GET', url: '/api/ops/live' },
  { method: 'GET', url: '/api/ops/aggregates' },
  { method: 'GET', url: '/api/ops/pages' },
  { method: 'GET', url: '/api/ops/pages/detail?path=%2F' },
  { method: 'GET', url: '/api/ops/flows' },
  { method: 'GET', url: '/api/ops/orgs' },
  { method: 'GET', url: '/api/ops/orgs/detail?org=(unknown)' },
  { method: 'GET', url: '/api/ops/visitors' },
  { method: 'GET', url: '/api/ops/visitors/00000000-0000-4000-8000-000000000000' },
  { method: 'GET', url: '/api/ops/cohorts' },
  { method: 'GET', url: '/api/ops/intent' },
  { method: 'GET', url: '/api/ops/performance' },
  { method: 'GET', url: '/api/ops/technology' },
  { method: 'GET', url: '/api/ops/errors' },
  { method: 'GET', url: '/api/ops/sessions' },
  { method: 'GET', url: '/api/ops/sessions/00000000-0000-4000-8000-000000000000' },
  { method: 'GET', url: '/api/ops/sessions/00000000-0000-4000-8000-000000000000/events' },
  { method: 'GET', url: '/api/ops/filters' },
  { method: 'GET', url: '/api/ops/schema' },
  { method: 'POST', url: '/api/ops/sql' },
  { method: 'GET', url: '/api/ops/export?entity=sessions&format=csv' },
  { method: 'GET', url: '/api/ops/replay/00000000-0000-4000-8000-000000000000' },
]

test('every /api/ops route answers 401 without the cookie', async () => {
  const api = await request.newContext({ baseURL: BASE_URL })
  const wrong: string[] = []
  for (const r of OPS_ROUTES) {
    const res = r.method === 'POST'
      ? await api.post(r.url, { data: { sql: 'SELECT 1' }, headers: { 'x-rb-ops': '1' } })
      : await api.get(r.url)
    if (res.status() !== 401) wrong.push(`${r.method} ${r.url} → ${res.status()}`)
  }
  await api.dispose()
  expect(wrong, `routes that did not 401:\n${wrong.join('\n')}`).toEqual([])
})
