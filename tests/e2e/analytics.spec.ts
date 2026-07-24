import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test } from '@playwright/test'

/**
 * End-to-end analytics: drive a real browse session through the page, then
 * assert the pipeline landed it in SQLite — session row, section events,
 * scroll depth and (eventually) an rrweb replay chunk.
 *
 * Desktop only, and requires the server to write into DATA_DIR (default
 * ./data) relative to the playwright cwd — run from the repo root against
 * a locally running server.
 */

const SECTIONS = ['sys', 'profile', 'opslog', 'fobech', 'bays', 'comms'] as const
const DB_PATH = path.join(path.resolve(process.env.DATA_DIR || './data'), 'analytics.db')

interface SessionRow {
  sid: string
  started_at: number
  pageviews: number
  max_scroll_pct: number
}

interface CountRow {
  n: number
}

/**
 * Poll the SQLite file until `query` returns a value or the deadline hits.
 * A fresh readonly connection per attempt keeps WAL reads current and never
 * blocks the server's writer.
 */
async function pollDb<T>(timeoutMs: number, query: (db: Database.Database) => T | undefined): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let db: Database.Database | undefined
    try {
      db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
      const out = query(db)
      if (out !== undefined) return out
    } catch {
      // db file not created yet — keep polling
    } finally {
      db?.close()
    }
    if (Date.now() >= deadline) return undefined
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
}

function countEvents(db: Database.Database, sid: string, type: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM events WHERE sid = ? AND type = ?').get(sid, type) as CountRow
  return row.n
}

test.skip(({ isMobile }) => isMobile, 'analytics pipeline is asserted once, on desktop')

test('a real browse session lands in SQLite with events and a replay chunk', async ({ page, context }) => {
  test.setTimeout(180_000)

  const browseStart = Date.now()
  await page.goto('/')

  // Skip the boot animation so section observation starts right away.
  const skip = page.getByTestId('boot-skip')
  try {
    await skip.waitFor({ state: 'visible', timeout: 5_000 })
    await skip.click()
  } catch {
    // boot already gone
  }
  await page.getByTestId('boot').waitFor({ state: 'hidden', timeout: 15_000 })

  // The client plugin mints the session id into the rb_sid cookie.
  const sid = (await context.cookies()).find(c => c.name === 'rb_sid')?.value
  expect(sid, 'analytics client should set an rb_sid cookie').toBeTruthy()

  // ~20s browse: dwell in every section so section_enter/exit, scroll_depth
  // and at least one 15s active-time heartbeat all fire.
  for (const name of SECTIONS) {
    await page.locator(`section[data-section="${name}"]`).scrollIntoViewIfNeeded()
    await page.waitForTimeout(2_500)
  }

  // One internal click (top-left corner of the profile section — never an
  // outbound link). force: we only care that the click listener records it.
  const profile = page.locator('section[data-section="profile"]')
  await profile.scrollIntoViewIfNeeded()
  await profile.click({ position: { x: 8, y: 8 }, force: true })

  // Idle a little longer: lets the 5s flush interval drain the queue and
  // gives rrweb (started post-load in an idle callback, uploading every
  // 10s) time to produce its first chunk.
  await page.waitForTimeout(6_000)

  // -- session row ------------------------------------------------------
  const session = await pollDb(15_000, (db) => {
    const row = db.prepare('SELECT sid, started_at, pageviews, max_scroll_pct FROM sessions WHERE sid = ?')
      .get(sid) as SessionRow | undefined
    return row && row.pageviews >= 1 ? row : undefined
  })
  expect(session, 'sessions row with pageviews >= 1 for this sid').toBeTruthy()
  expect(session!.started_at, 'session started when this test started browsing').toBeGreaterThan(browseStart - 60_000)

  // -- events -----------------------------------------------------------
  const eventCounts = await pollDb(15_000, (db) => {
    const sections = countEvents(db, sid!, 'section_enter')
    const scrolls = countEvents(db, sid!, 'scroll_depth')
    return sections > 0 && scrolls > 0 ? { sections, scrolls } : undefined
  })
  expect(eventCounts, 'section_enter and scroll_depth events recorded').toBeTruthy()

  // -- replay chunk -----------------------------------------------------
  // The page is still open (rrweb keeps recording/uploading); poll up to 30s.
  const chunk = await pollDb(30_000, db =>
    db.prepare('SELECT seq FROM replay_chunks WHERE sid = ? LIMIT 1').get(sid) as { seq: number } | undefined)
  expect(chunk, 'at least one replay chunk stored for this session').toBeTruthy()
})
