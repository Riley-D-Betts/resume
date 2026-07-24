import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Public site contract: the mock-NetSuite résumé renders its Role
 * Center, navigates between records, and stays free of console errors.
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
  await expect(page.getByLabel('Oracle NetSuite home')).toBeVisible()
  await expect(page.getByText('Welcome, Riley')).toBeVisible()
  await expect(page.getByText('Key Performance Indicators')).toBeVisible()
  await expect(page.getByText('Reminders', { exact: true })).toBeVisible()
  // The main menu carries NetSuite's real tab names. On mobile the menu
  // collapses behind the hamburger and leaves the a11y tree entirely, so
  // only assert it on the desktop viewport.
  if ((page.viewportSize()?.width ?? 0) > 900) {
    await expect(page.getByRole('button', { name: 'Transactions' })).toBeVisible()
  }
  await page.waitForTimeout(400) // let the meter + report bars settle
  await page.screenshot({ path: path.join(SCREENS_DIR, `dashboard-${testInfo.project.name}.png`), fullPage: true })

  // -- Employee record -------------------------------------------------
  await page.goto('/employee')
  // NetSuite's title block: the record TYPE is the heading, the name below
  await expect(page.getByRole('heading', { name: 'Employee' })).toBeVisible()
  await expect(page.locator('.ns-record-name')).toContainText('Betts, Riley')
  await expect(page.locator('.ns-record-status')).toContainText(/ACTIVE/i)
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

  // -- Fobech subsidiary ----------------------------------------------
  await page.goto('/fobech')
  await expect(page.getByRole('heading', { name: 'Subsidiary' })).toBeVisible()
  await expect(page.getByText('Complexity Is Our Problem').first()).toBeVisible()
  await page.screenshot({ path: path.join(SCREENS_DIR, `fobech-${testInfo.project.name}.png`), fullPage: true })

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
