import path from 'node:path'
import { expect, test } from '@playwright/test'

/**
 * /ops admin console: auth gate, overview widgets, session detail, replay.
 * Desktop only. The server under test must have NUXT_ADMIN_PASSWORD set to
 * OPS_PASSWORD (default 'test'), and some traffic should exist — either
 * from `npm run seed` or from analytics.spec.ts, which runs first.
 */

const OPS_PASSWORD = process.env.OPS_PASSWORD || 'test'
const SCREENS_DIR = path.join(process.cwd(), 'test-results', 'screens')

test.skip(({ isMobile }) => isMobile, 'ops console is asserted once, on desktop')

test('/ops gates on login and rejects a wrong password', async ({ page }) => {
  await page.goto('/ops')

  // Unauthenticated hit ends at the login form (/ops is client-rendered).
  const password = page.getByTestId('ops-login-password')
  await expect(password).toBeVisible({ timeout: 20_000 })

  await password.fill('definitely-not-the-password')
  await page.getByTestId('ops-login-submit').click()

  await expect(page.getByText(/denied|invalid|incorrect|wrong|unauthorized/i).first()).toBeVisible()
  await expect(page.getByTestId('ops-login-password')).toBeVisible()
  await expect(page.getByTestId('stat-card')).toHaveCount(0)
})

test('login reaches the overview and a session detail with an event timeline', async ({ page }, testInfo) => {
  await page.goto('/ops')

  const password = page.getByTestId('ops-login-password')
  await expect(password).toBeVisible({ timeout: 20_000 })
  await password.fill(OPS_PASSWORD)
  await page.getByTestId('ops-login-submit').click()

  // -- overview ---------------------------------------------------------
  const statCards = page.getByTestId('stat-card')
  await expect(statCards.first()).toBeVisible({ timeout: 20_000 })
  expect(await statCards.count(), 'at least 4 stat cards').toBeGreaterThanOrEqual(4)
  await expect(page.getByTestId('sparkline').first()).toBeVisible()

  await page.screenshot({
    path: path.join(SCREENS_DIR, `ops-overview-${testInfo.project.name}.png`),
    fullPage: true,
  })

  // -- sessions list ----------------------------------------------------
  // session-row testids live on the dedicated sessions page, not the
  // overview's recent-sessions mini-list.
  await page.goto('/ops/sessions')
  const rows = page.getByTestId('session-row')
  await expect(rows.first(), 'sessions table has rows (run the seed script or analytics spec first)')
    .toBeVisible({ timeout: 20_000 })

  // -- session detail ---------------------------------------------------
  await rows.first().click()

  const timeline = page.getByTestId('event-timeline')
  await expect(timeline.first()).toBeVisible({ timeout: 20_000 })
  // The timeline renders a placeholder child when empty — require real rows.
  await expect(timeline.first()).not.toContainText(/no events/i)
  expect(await timeline.first().locator(':scope > *').count(), 'event timeline has rows').toBeGreaterThan(0)

  // Replay is conditional — only sessions that recorded rrweb chunks show a
  // player. When the container is present it must actually mount.
  const player = page.getByTestId('replay-player')
  if (await player.count() > 0) {
    await expect(player.first()).toBeVisible({ timeout: 30_000 })
  }

  await page.screenshot({
    path: path.join(SCREENS_DIR, `ops-session-detail-${testInfo.project.name}.png`),
    fullPage: true,
  })
})
