/**
 * GET /api/health — 200 `{ ok: true, db: true, r2: true }` when both bindings
 * answer, 503 with the failing flag(s) false otherwise (audit A44: a 200 with
 * `db:false` hid a dead database from uptime monitors).
 */
export default defineEventHandler(async (event) => {
  let db = false
  let r2 = false
  try {
    await getDb(event).prepare('SELECT 1').first()
    db = true
  } catch (err) {
    console.error('[health] D1 check failed:', (err as Error)?.message ?? err)
  }
  try {
    // head() of a key that need not exist: a null answer still proves the
    // bucket binding is reachable; a missing/misconfigured binding throws.
    await getReplayBucket(event).head('healthcheck')
    r2 = true
  } catch (err) {
    console.error('[health] R2 check failed:', (err as Error)?.message ?? err)
  }
  const ok = db && r2
  setResponseStatus(event, ok ? 200 : 503)
  setHeader(event, 'Cache-Control', 'no-store')
  return { ok, db, r2 }
})
