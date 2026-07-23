import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Public page contract: boot overlay, six sections, no console errors.
 * Runs in both projects (desktop + mobile). Screenshots land in
 * test-results/screens/ (run playwright from the repo root).
 */

const SECTIONS = ['sys', 'profile', 'opslog', 'fobech', 'bays', 'comms'] as const
const SCREENS_DIR = path.join(process.cwd(), 'test-results', 'screens')

/** Skip the boot animation if the overlay is up, then wait for it to clear. */
async function skipBoot(page: Page): Promise<void> {
  const skip = page.getByTestId('boot-skip')
  try {
    await skip.waitFor({ state: 'visible', timeout: 5_000 })
    await skip.click()
  } catch {
    // boot already finished or never rendered (reduced motion / revisit)
  }
  await page.getByTestId('boot').waitFor({ state: 'hidden', timeout: 15_000 })
}

test('boots, renders all six sections, zero console errors', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    // net::ERR_* messages are aborted/blocked resource loads, not JS errors.
    if (msg.type() === 'error' && !msg.text().includes('net::ERR')) {
      errors.push(msg.text())
    }
  })
  page.on('pageerror', (err) => {
    errors.push(String(err))
  })

  await page.goto('/')

  // The boot overlay mounts on a fresh visit; skip it either way.
  await expect(page.getByTestId('boot')).toBeVisible()
  await skipBoot(page)

  for (const name of SECTIONS) {
    const section = page.locator(`section[data-section="${name}"]`)
    await expect(section, `section "${name}" should be attached`).toBeAttached()
    await section.scrollIntoViewIfNeeded()
    await expect(section, `section "${name}" should be visible`).toBeVisible()
    // Let the scroll-triggered entrance animation settle so the screenshot
    // captures the fully-styled section, not a mid-tween frame.
    await page.waitForTimeout(800)
    await section.screenshot({
      path: path.join(SCREENS_DIR, `${name}-${testInfo.project.name}.png`),
    })
  }

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('hero text is visible immediately, no boot gate', async ({ page }) => {
    await page.goto('/')
    // With prefers-reduced-motion the boot overlay self-skips and the hero
    // must be readable without waiting on any animation.
    const hero = page.locator('section[data-section="sys"]')
    await expect(hero).toBeVisible({ timeout: 5_000 })
    await expect(hero).toContainText(/RILEY/i, { timeout: 5_000 })
    await expect(page.getByTestId('boot')).toBeHidden()
  })
})
