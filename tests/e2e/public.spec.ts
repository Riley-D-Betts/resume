import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Public site contract: the mock-NetSuite résumé renders its dashboard,
 * navigates between records, and stays free of console errors. Runs in
 * both projects (desktop + mobile). Screenshots land in
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

test('dashboard renders portlets and navigates records, zero console errors', async ({ page }, testInfo) => {
  const errors = collectErrors(page)

  // -- Home dashboard --------------------------------------------------
  await page.goto('/')
  await expect(page.getByLabel('NetSuite home')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
  await expect(page.getByText('Welcome, Riley')).toBeVisible()
  await expect(page.getByText('Key Performance Indicators')).toBeVisible()
  await expect(page.getByText('Reminders', { exact: true })).toBeVisible()
  await page.waitForTimeout(400) // let the report bars / meter settle
  await page.screenshot({ path: path.join(SCREENS_DIR, `dashboard-${testInfo.project.name}.png`), fullPage: true })

  // -- Employee record (via the masthead user pill) --------------------
  await page.getByLabel('Employee record').first().click()
  await expect(page).toHaveURL(/\/employee$/)
  // scope to the record header so the (mobile-hidden) masthead name isn't matched
  await expect(page.locator('.ns-record__name')).toContainText('Riley Betts')
  await expect(page.locator('.ns-record__name')).toContainText('Information Technology Manager')
  // a subtab switch works
  await page.getByRole('tab', { name: 'Human Resources' }).click()
  await expect(page.getByText('NetSuite', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: path.join(SCREENS_DIR, `employee-${testInfo.project.name}.png`), fullPage: true })

  // -- Projects list ---------------------------------------------------
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'SunApps MES' })).toBeVisible()
  await page.screenshot({ path: path.join(SCREENS_DIR, `projects-${testInfo.project.name}.png`), fullPage: true })

  // -- Project record --------------------------------------------------
  await page.getByRole('link', { name: 'KidCam' }).click()
  await expect(page).toHaveURL(/\/projects\/kidcam$/)
  await expect(page.getByText('Prototype').first()).toBeVisible()

  // -- Fobech subsidiary -----------------------------------------------
  await page.goto('/fobech')
  await expect(page.getByText('Complexity Is Our Problem').first()).toBeVisible()
  await page.screenshot({ path: path.join(SCREENS_DIR, `fobech-${testInfo.project.name}.png`), fullPage: true })

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('dashboard is readable immediately, splash suppressed', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('Welcome, Riley')).toBeVisible({ timeout: 5_000 })
    // the loading splash is display:none under reduced motion
    await expect(page.locator('.ns-splash')).toBeHidden()
  })
})
