import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Public site contract: the mock-Bettsuite résumé renders its Role
 * Center, navigates between records, carries the analytics hooks the
 * tracker relies on (data-page / data-section), plants the bot honeypot
 * without exposing it to humans, and stays free of console errors.
 * Runs in both projects (desktop + mobile). Screenshots land in
 * test-results/screens/ (run playwright from the repo root).
 */

const SCREENS_DIR = path.join(process.cwd(), 'test-results', 'screens')

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    // net::ERR_* messages are aborted/blocked resource loads, not JS errors.
    if (msg.type() === 'error' && !msg.text().includes('net::ERR')) errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(String(err)))
  return errors
}

test('role center renders, records navigate, zero console errors', async ({ page }, testInfo) => {
  const errors = collectErrors(page)

  // -- Home dashboard (Role Center) ------------------------------------
  await page.goto('/')
  await expect(page.getByLabel('Riley Bettsuite home')).toBeVisible()
  await expect(page.getByText('Welcome, Riley')).toBeVisible()
  await expect(page.getByText('Key Performance Indicators')).toBeVisible()
  await expect(page.getByText('Reminders', { exact: true })).toBeVisible()
  // The main menu carries Bettsuite's real tab names. On mobile the menu
  // collapses behind the hamburger and leaves the a11y tree entirely, so
  // only assert it on the desktop viewport.
  if ((page.viewportSize()?.width ?? 0) > 900) {
    await expect(page.getByRole('button', { name: 'Transactions' })).toBeVisible()
  }
  // Analytics hooks (WP2): the page root and the portlets the tracker observes.
  await expect(page.locator('[data-page="home"]')).toHaveCount(1)
  await expect(page.locator('[data-section="home.kpi"]')).toHaveCount(1)
  await expect(page.locator('[data-section="home.trend"]')).toHaveCount(1)
  expect(await page.locator('[data-section]').count(), 'dashboard portlets carry data-section').toBeGreaterThanOrEqual(5)
  await page.waitForTimeout(400) // let the meter + report bars settle
  await page.screenshot({ path: path.join(SCREENS_DIR, `dashboard-${testInfo.project.name}.png`), fullPage: true })

  // -- Employee record -------------------------------------------------
  await page.goto('/employee')
  // Bettsuite's title block: the record TYPE is the heading, the name below
  await expect(page.getByRole('heading', { name: 'Employee' })).toBeVisible()
  await expect(page.locator('.ns-record-name')).toContainText('Betts, Riley')
  await expect(page.locator('.ns-record-status')).toContainText(/ACTIVE/i)
  await expect(page.locator('[data-page="employee"]')).toHaveCount(1)
  await expect(page.locator('[data-section="employee.primary"]')).toHaveCount(1)
  await expect(page.locator('[data-section="employee.skills"]')).toHaveCount(1)
  // a subtab switch works
  await page.getByRole('tab', { name: /Human Resources/ }).click()
  await expect(page.getByText('ERP / Business Systems')).toBeVisible()
  await page.screenshot({ path: path.join(SCREENS_DIR, `employee-${testInfo.project.name}.png`), fullPage: true })

  // -- Employment History list ----------------------------------------
  await page.goto('/positions')
  await expect(page.getByRole('heading', { name: 'Employment History' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ida Milk, LLC' })).toBeVisible()

  // -- Projects list + record -----------------------------------------
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await page.getByRole('link', { name: 'KidCam' }).click()
  await expect(page).toHaveURL(/\/projects\/kidcam$/)
  await expect(page.getByRole('heading', { name: 'Project' })).toBeVisible()
  await page.screenshot({ path: path.join(SCREENS_DIR, `project-${testInfo.project.name}.png`), fullPage: true })

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

test('footer: honeypot link is invisible to humans, opt-out link is real', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')

  // -- honeypot (K5 / A18): exactly one bait link, unreachable by a person --
  const bait = page.locator('a.void-link')
  await expect(bait).toHaveCount(1)
  await expect(bait).toHaveAttribute('href', '/void.html')
  await expect(bait).toHaveAttribute('aria-hidden', 'true')
  await expect(bait).toHaveAttribute('tabindex', '-1')
  await expect(bait).toHaveAttribute('rel', 'nofollow')
  await expect(bait).toHaveCSS('pointer-events', 'none')
  await expect(bait).toHaveCSS('visibility', 'hidden')
  await expect(bait).toBeHidden()
  const box = await bait.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { w: r.width, h: r.height }
  })
  expect(box.w, 'bait link is 1px wide').toBeLessThanOrEqual(1)
  expect(box.h, 'bait link is 1px tall').toBeLessThanOrEqual(1)
  // Crawlers must be told to stay away from it too.
  const robots = await page.request.get('/robots.txt')
  expect(await robots.text()).toContain('Disallow: /void.html')

  // -- opt-out: the privacy notice renders ?optout=1 as a real link --------
  const optout = page.locator('footer a[href="?optout=1"]')
  await expect(optout).toHaveCount(1)
  await expect(page.locator('.ns-footer__privacy')).toContainText(/first-party analytics/i)

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('dashboard is readable immediately, splash suppressed', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Welcome, Riley')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('Key Performance Indicators')).toBeVisible({ timeout: 5_000 })
    // the loading splash is display:none under reduced motion
    await expect(page.locator('.ns-splash')).toBeHidden()
  })
})
