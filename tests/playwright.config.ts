import { defineConfig, devices } from '@playwright/test'

/**
 * E2E suite. Run from the REPO ROOT with:
 *
 *   npx playwright test -c tests
 *
 * There is deliberately NO webServer block — the tests assume an already
 * running server (so they can target dev, a prod build, or Docker alike):
 *
 *   NUXT_ADMIN_PASSWORD=test \
 *   NUXT_SESSION_PASSWORD=$(openssl rand -hex 32) \
 *   npm run dev
 *
 * Environment knobs:
 * - BASE_URL      target server (default http://localhost:3000)
 * - OPS_PASSWORD  /ops password the ops spec logs in with (default 'test')
 * - DATA_DIR      where analytics.db lives (default ./data) — analytics spec
 * - PW_EXEC       when set, force the preinstalled chromium binary at
 *                 /opt/pw-browsers/chromium instead of letting Playwright
 *                 resolve a browser from PLAYWRIGHT_BROWSERS_PATH. Useful
 *                 when the installed registry revision and this playwright
 *                 version disagree; leave unset everywhere else.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: '../test-results',
  fullyParallel: false,
  workers: 1, // specs share one server, one SQLite db and one per-IP rate limit
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    screenshot: 'on',
    ...(process.env.PW_EXEC
      ? { launchOptions: { executablePath: '/opt/pw-browsers/chromium' } }
      : {}),
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
})
