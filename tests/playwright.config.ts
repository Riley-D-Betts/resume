import { defineConfig, devices } from '@playwright/test'

/**
 * E2E suite. Run from the REPO ROOT with:
 *
 *   npx playwright test -c tests
 *
 * There is deliberately NO webServer block — the tests assume an already
 * running server (dev or a `wrangler dev` preview of the production build):
 *
 *   NUXT_ADMIN_PASSWORD=test \
 *   NUXT_SESSION_PASSWORD=$(openssl rand -hex 32) \
 *   npm run dev
 *
 * Coverage per project: public.spec.ts runs on BOTH projects (desktop +
 * mobile); analytics.spec.ts and ops.spec.ts are desktop-only (they skip
 * themselves on the mobile project — one pipeline / one console is asserted
 * once). analytics.spec.ts reads the local D1 SQLite file, so the server
 * under test must be the local one whose state lives under .wrangler/state.
 *
 * Environment knobs:
 * - BASE_URL      target server (default http://localhost:3000)
 * - OPS_PASSWORD  /ops password the ops spec logs in with (default 'test')
 * - D1_DB_PATH    local D1 sqlite file (default: discovered under .wrangler/state) — analytics spec
 * - PW_EXEC       absolute path to a Chromium binary to launch instead of the
 *                 browser Playwright resolves from its registry. Useful when
 *                 the installed registry revision and this playwright version
 *                 disagree. `PW_EXEC=1` keeps the legacy meaning and selects
 *                 /opt/pw-browsers/chromium (the CI image's binary). Leave it
 *                 unset everywhere else.
 */
const execPath = process.env.PW_EXEC === '1' ? '/opt/pw-browsers/chromium' : process.env.PW_EXEC

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
    // A wrong selector should fail fast, not burn the whole test timeout.
    actionTimeout: 15_000,
    screenshot: 'on',
    ...(execPath ? { launchOptions: { executablePath: execPath } } : {}),
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
